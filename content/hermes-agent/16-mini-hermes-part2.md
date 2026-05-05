# 第 16 章 mini-hermes(下):让它自己写 Skill

上一章我们搭起了 mini-hermes 的骨架:对话循环、三层记忆、内置工具。它能对话,能调工具,但**它还不会成长** —— 同样的任务做十次,Agent 每次都从零推理。

这一章加上让它"会成长"的机制:**skill 加载器、skill 的自动生成、极简的质量闸门、一个可以真实接入飞书的 gateway**。读完这一章,你的 mini-hermes 会是一个完整可用(虽然功能精简)的个人 Agent。

## 16.1 skill 加载器:扫描文件并注入 Prompt

回忆第 4 章:Hermes 的 skill 是 `SKILL.md` 文件,有 frontmatter 和正文。我们用一样的格式。

**一个 mini-hermes skill 的例子**:

```markdown
---
name: create-daily-note
description: 在 workspace/notes/ 下创建按日期命名的笔记文件
triggerKeywords:
  - 创建今日笔记
  - 新建日记
  - daily note
---

## 步骤

1. 用 list_directory 确认 notes/ 目录存在,不存在则创建
2. 用 write_file 创建 `notes/YYYY-MM-DD.md`
3. 文件初始内容:标题行 + 空 "## 今天的事" 段落
4. 返回文件路径给用户
```

简单粗暴:YAML frontmatter 声明元数据,正文是 Markdown 描述的步骤。

### skill 加载的实现

`src/skills.ts` 负责从 `./data/skills/` 目录扫描所有 SKILL.md,解析 frontmatter,返回 `Skill[]`:

```typescript
// src/skills.ts
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Skill } from "./types";

const SKILLS_DIR = "./data/skills";

export async function loadSkills(): Promise<Skill[]> {
  if (!existsSync(SKILLS_DIR)) {
    await mkdir(SKILLS_DIR, { recursive: true });
    return [];
  }

  const skills: Skill[] = [];
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, e.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;

    const body = await readFile(skillPath, "utf-8");
    const parsed = parseSkillMarkdown(body, skillPath);
    if (parsed) skills.push(parsed);
  }
  return skills;
}

function parseSkillMarkdown(content: string, filePath: string): Skill | null {
  // 简化的 frontmatter 解析:用 --- 做分隔符
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const fm = match[1];
  const body = match[2];

  // 从 frontmatter 里抓几个字段(不做完整 YAML 解析,保持简单)
  const name = extractField(fm, "name");
  const description = extractField(fm, "description");
  const kwLine = extractField(fm, "triggerKeywords") ?? "";
  const triggerKeywords = parseList(fm, "triggerKeywords");

  if (!name || !description) return null;

  return {
    name,
    description,
    triggerKeywords,
    body: content,
    createdAt: Date.now(),
    useCount: 0,
    successCount: 0,
    filePath,
  };
}

function extractField(fm: string, key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const m = fm.match(re);
  return m?.[1]?.trim();
}

function parseList(fm: string, key: string): string[] {
  // 支持两种格式:
  //   key:
  //     - item1
  //     - item2
  // 或
  //   key: [item1, item2]
  const blockMatch = fm.match(new RegExp(`^${key}:\\s*\\n((?:\\s+- .+\\n?)+)`, "m"));
  if (blockMatch) {
    return blockMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }
  const inlineMatch = fm.match(new RegExp(`^${key}:\\s*\\[(.+?)\\]`, "m"));
  if (inlineMatch) {
    return inlineMatch[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
  }
  return [];
}

export async function writeSkill(name: string, skillMarkdown: string): Promise<string> {
  const dir = path.join(SKILLS_DIR, name);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  await writeFile(filePath, skillMarkdown, "utf-8");
  return filePath;
}
```

几个注意点:

**注意一:我们没用 YAML 库**。正规做法是用 `js-yaml` 解析 frontmatter,但 mini-hermes 坚持零额外依赖 —— 我们只抓几个关键字段,用正则搞定。生产代码请用真的 YAML 解析器。

**注意二:parseSkillMarkdown 返回 null 时不崩溃**。格式不对的文件被静默跳过。这让"手工乱写的 skill 文件"不会破坏系统。

**注意三:skill 的 `body` 是完整的 SKILL.md 内容**。我们把整个文件存在内存里,但在 system prompt 里只注入 name + description + triggerKeywords。第 15 章讲过这个设计。

### 注入 Prompt

第 15 章的 `context.ts` 已经有一个简化的 `buildSkillsSection`。这里不需要改它,因为它已经按 name + description + triggerKeywords 拼接了。

跑起来 —— 现在 mini-hermes 能加载已有的 skill 了。但它还不能**自己写 skill**。下一节补上。

## 16.2 skill 的自动生成:mini-hermes 的学习能力

"自动生成 skill" 的含义是:**Agent 在完成一个任务后,自己判断"这件事值得沉淀",然后主动写一份 SKILL.md**。

在 Hermes 里这是一个多阶段的生命周期(第 4 章讲过五个阶段)。mini-hermes 把它简化成一个动作:**在每次任务完成后,让 LLM 自己判断是否要生成 skill,如果要就输出 SKILL.md 内容**。

### 机制:新增一个工具 `propose_skill`

我们给 mini-hermes 加一个新工具 `propose_skill`。这个工具的特别之处是:**它不直接执行副作用,而是走一个"审查流程"**。流程是:

1. LLM 调用 `propose_skill`,传入建议的 SKILL.md 内容
2. 工具把这个 proposal 交给一个独立的"审查 LLM"
3. 审查 LLM 判断 proposal 是否合格(按几个质量维度打分)
4. 合格的 proposal 被写入文件,返回"已创建"
5. 不合格的 proposal 被拒绝,返回拒绝理由(LLM 可以根据理由改进或放弃)

这个流程把第 4 章讲的"质量闸门"压缩成了一次 LLM 调用 —— 足够教学演示,但比 Hermes 的完整版简单很多。

### 工具的实现

在 `src/tools.ts` 里加一个新工具:

```typescript
// src/tools.ts (新增,不替换之前的)
import { writeSkill } from "./skills";
import { callLLM } from "./llm";

const REVIEWER_MODEL = "claude-3-5-sonnet-20241022";

const REVIEWER_SYSTEM = `你是一个 Agent skill 审查员。你的工作是评估一份新 skill 的 SKILL.md 草稿是否值得被写入系统。

你要检查:
1. 是否有清晰的 name 和 description
2. triggerKeywords 是否合理(不能太宽泛导致误触发,也不能太窄导致召回不到)
3. 正文步骤是否可执行(不能是空话)
4. 是否考虑了至少一种失败情况
5. 参数是否参数化(不能把一次性的具体值写死)

输出格式(严格遵守):
verdict: pass | fail
reason: <一句话说明原因>

如果 verdict 是 fail,reason 要具体指出问题所在,让 skill 的生成者可以改进。`;

export const proposeSkillTool: ToolDefinition = {
  name: "propose_skill",
  description:
    "当你完成一个任务并认为这个流程值得被沉淀为 skill 时调用。传入完整的 SKILL.md 内容。系统会审查并决定是否接受。",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "skill 的目录名,kebab-case" },
      skill_markdown: {
        type: "string",
        description: "完整的 SKILL.md 文件内容,包含 YAML frontmatter",
      },
    },
    required: ["name", "skill_markdown"],
  },
  async execute(input) {
    const name = input.name as string;
    const md = input.skill_markdown as string;

    // 基础格式检查
    if (!md.startsWith("---\n")) {
      return "Rejected: SKILL.md must start with YAML frontmatter";
    }
    if (!/^[a-z0-9-]+$/.test(name)) {
      return "Rejected: name must be kebab-case (lowercase letters, digits, hyphens)";
    }

    // 审查:调一次独立的 LLM
    const reviewResult = await callLLM({
      model: REVIEWER_MODEL,
      system: REVIEWER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `请审查以下 skill 草稿:\n\n\`\`\`\n${md}\n\`\`\``,
          timestamp: Date.now(),
        },
      ],
      maxTokens: 500,
    });

    const reviewText = reviewResult.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const verdictMatch = reviewText.match(/verdict:\s*(pass|fail)/i);
    const reasonMatch = reviewText.match(/reason:\s*(.+)/i);
    const verdict = verdictMatch?.[1]?.toLowerCase();
    const reason = reasonMatch?.[1]?.trim() ?? "未提供理由";

    if (verdict !== "pass") {
      return `Rejected by reviewer: ${reason}`;
    }

    // 写入文件
    const filePath = await writeSkill(name, md);
    return `Skill '${name}' accepted and written to ${filePath}. It will be available in the next conversation.`;
  },
};

// 导出时加入 tools 数组
export const tools: ToolDefinition[] = [
  // ... 之前的三个 tool ...
  proposeSkillTool,
];
```

几个设计细节:

**细节一:审查用的是同一个模型**。这里简化了 —— 生产版应该用不同的模型做审查(第 6 章讲过"自己评自己会有偏差")。如果你想分开,可以用一个 env var 指定 `REVIEWER_MODEL` 不同于主模型。

**细节二:审查的 prompt 是结构化的**。要求 LLM 输出 `verdict: pass | fail` 和 `reason: ...`,用正则解析。这比让 LLM 自由发挥稳定得多。

**细节三:审查失败不是异常,是返回值**。LLM 收到 "Rejected by reviewer: ..." 之后可以选择"改进后重试"或"放弃"。这保持了 Agent 的自我恢复能力。

**细节四:新 skill 下一次对话才生效**。当前对话的 `loadSkills()` 已经跑过了,新写入的 skill 不在这次的 context 里。用户看到 "Skill 'xxx' accepted" 之后下次启动 mini-hermes 或开新 session 才能用它。更 fancy 的做法是"热加载",但这会让主循环变复杂,mini-hermes 不做。

### 引导 LLM 主动用这个工具

有了工具不代表 LLM 会主动用。要让它用,得在 system prompt 里明确引导。更新 `context.ts` 的 `buildSystemPrompt`:

```typescript
// src/context.ts (修改行为准则部分)

return `你是 mini-hermes,一个会成长的个人 AI 助手。

## 你的记忆(持久化笔记)

${memory}

## 你当前可用的技能

${skillsSection}

## 行为准则

- 优先使用已有技能完成任务,而不是从零推理
- **完成任务后,如果这个任务看起来会被再次做(有明确的重复模式),主动调用 propose_skill 工具把流程沉淀为新 skill**
- 所有文件操作都在 ./data/workspace 下,不要尝试访问其他路径
- 写文件前先检查是否需要读已有内容
- 遇到错误不要慌,分析错误信息后再尝试

## 什么时候该主动 propose_skill

- 用户明确说了"以后 X 你就这样做" → 立即 propose
- 你完成了一个有 3+ 步骤的任务,且这些步骤和参数都是可泛化的 → 考虑 propose
- 用户第二次让你做几乎相同的事 → 强烈建议 propose
- 一次性的琐碎任务(比如"帮我看看这个文件") → 不要 propose

## propose_skill 的写法

写 SKILL.md 时注意:
- frontmatter 要有 name、description、triggerKeywords(列表)
- 正文要有"步骤"段落,每一步可执行
- 不要把具体参数写死(比如具体的文件名),用占位符
- 至少考虑一种失败情况

## 输出风格

- 直接、简洁、有判断
- 不要客套话
- 不要解释你"将要"做什么,直接做(除非是危险操作需要用户确认)
`;
```

这段 system prompt 的关键是明确了"什么时候 propose、什么时候不 propose"。没有这个明确引导,LLM 要么永远不 propose(保守),要么每个任务都 propose(泛滥)。

## 16.3 试运行:看它自己写出第一个 skill

启动 mini-hermes:

```bash
bun run src/index.ts
```

输入:

```
> 帮我创建一个今日笔记:在 notes/2026-04-10.md 里写一个 H1 标题"2026-04-10 日记",然后一个"## 今天的事"的空段落。
```

观察 Agent 的行为 —— 它会:

1. list_directory 看 notes/ 目录存不存在
2. 不存在则隐含地通过 write_file 创建(write_file 会自动 mkdir)
3. write_file 写入文件

完成后,它可能会问:"我注意到'创建每日笔记'这种任务你可能会重复做。要我把它沉淀成一个 skill 吗?"

如果它直接 propose 了就更好 —— 那说明 system prompt 的引导起作用了。如果它只是完成了任务没 propose,你可以追问:

```
> 对,下次我说"创建今日笔记"就按这个流程做,沉淀成 skill
```

这次 Agent 应该会调 `propose_skill`,传入它写的 SKILL.md 内容。审查员 LLM 会评估这份草稿。如果通过,你会看到 "Skill 'create-daily-note' accepted" 之类的消息。

**切到另一个终端**查看 skill 文件:

```bash
cat data/skills/create-daily-note/SKILL.md
```

你应该看到一份 Agent 自己写的 SKILL.md。读一遍,你会发现它大致符合你预期 —— 有 frontmatter、有步骤、可能考虑了目录不存在的情况。

**退出并重启** mini-hermes。这次的 system prompt 里会包含 `create-daily-note` 这个 skill。输入:

```
> 创建今日笔记
```

观察 Agent。它应该:

1. 识别这是 `create-daily-note` 的 trigger
2. 按 skill 里的步骤执行
3. 创建今天日期的文件

**恭喜**,你刚刚看到的是 Agent 从"做任务" → "沉淀技能" → "复用技能"的完整循环。这是 Hermes 最核心的"成长机制",你已经在 mini-hermes 里实现了它。

## 16.4 极简的质量闸门:我们省了什么

上面的 `propose_skill` 已经有一个"审查"步骤,但这个闸门比 Hermes 的完整版简单很多。让我们清点一下"省了什么",这样你知道 mini-hermes 的边界在哪。

**Hermes 质量闸门有的 / mini-hermes 没的**:

| 维度 | Hermes 完整版 | mini-hermes |
|---|---|---|
| 多维度评分 | 6 个维度分别打分 | 单一 pass/fail |
| 审查模型独立 | 可配置独立模型 | 默认同一个模型 |
| 去重检查 | 扫描已有 skill 找功能重复 | 无 |
| 参数校验 | 检查是否写死了具体值 | 依赖 reviewer LLM 的判断 |
| 风险标签一致性 | 自动修正 | 无风险标签 |
| 修订历史 | 有完整 version log | 无 |
| A/B 测试 | 新旧版本对比 | 无 |
| 失败统计 | 连续失败自动废弃 | 无 |
| 用户确认 | 可配置严格度 | 默认全自动 |

为什么这些我们省了?每一个功能都会让代码量翻倍,而且大多数对"教学版"的教学价值很低 —— 读者已经在第 4、6 章读过了这些机制的完整描述,mini-hermes 的目的是让你看到**最小可用的闭环**,而不是重新实现一遍 Hermes。

**如果你想扩展 mini-hermes 到"半生产"状态**,最值得优先加的三个:

1. **去重检查**:在 `propose_skill` 里先 load 所有已有 skill,和 proposal 做语义相似度(即使只是关键词对比),相似度高的拒绝
2. **审查模型独立**:用一个不同的 `REVIEWER_MODEL` env var
3. **使用统计**:每次 skill 被调用时递增 `useCount` / `successCount`,持久化到某个文件

这三个改动加起来大概 100 行代码。做完后你的 mini-hermes 就从"教学玩具"升级到了"个人可用"。

## 16.5 接入飞书:把 mini-hermes 变成真正的助手

到这里 mini-hermes 已经能"自己成长",但它还只能在 CLI 里用。第四步是让它接入飞书,成为一个真正的"24 小时个人助手"。

飞书接入的全套流程在第 8.3 节讲过(创建应用、配置事件订阅、verify 签名)。mini-hermes 的 gateway 更简单 —— 我们只做最小可用:接收私聊消息,处理,回复。

### 新增依赖:一个极简的 HTTP server

Bun 有内置 `Bun.serve`,不需要 express / fastify。

### gateway 代码

新建 `src/feishu-gateway.ts`:

```typescript
// src/feishu-gateway.ts
import crypto from "node:crypto";
import { Agent } from "./agent";
import { initMemory } from "./memory";

const APP_ID = process.env.FEISHU_APP_ID!;
const APP_SECRET = process.env.FEISHU_APP_SECRET!;
const VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN!;
const ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY; // 可选
const ALLOWED_USER_IDS = (process.env.FEISHU_ALLOWED_USERS ?? "").split(",").filter(Boolean);
const PORT = Number(process.env.PORT ?? 8080);

// 会话管理:同一个 user_id 共享一个 Agent 实例
const agents = new Map<string, Agent>();

async function getOrCreateAgent(userId: string): Promise<Agent> {
  if (!agents.has(userId)) {
    agents.set(userId, new Agent());
  }
  return agents.get(userId)!;
}

// 飞书 tenant token 获取
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getTenantToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const res = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
    }
  );
  const data = (await res.json()) as any;
  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire - 300) * 1000,
  };
  return cachedToken.token;
}

async function sendReply(chatId: string, text: string) {
  const token = await getTenantToken();
  await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });
}

async function handleEvent(body: any) {
  // URL 验证(飞书在配置时会先发一次)
  if (body.type === "url_verification") {
    return { challenge: body.challenge };
  }

  const event = body.event;
  if (!event || body.header?.event_type !== "im.message.receive_v1") {
    return { code: 0 };
  }

  const sender = event.sender?.sender_id?.open_id;
  if (!sender) return { code: 0 };
  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(sender)) {
    console.log(`[gateway] ignoring message from non-allowed user: ${sender}`);
    return { code: 0 };
  }

  const messageType = event.message?.message_type;
  if (messageType !== "text") return { code: 0 };

  const contentJson = JSON.parse(event.message.content);
  const text = (contentJson.text ?? "").trim();
  if (!text) return { code: 0 };

  const chatId = event.message.chat_id;
  console.log(`[gateway] received from ${sender}: ${text}`);

  // 异步处理,立即返回 200 避免 webhook 超时
  (async () => {
    try {
      const agent = await getOrCreateAgent(sender);
      const result = await agent.run(text);
      await sendReply(chatId, result.response);
      console.log(`[gateway] replied (steps=${result.steps}, tokens=${result.inputTokensTotal}+${result.outputTokensTotal})`);
    } catch (err: any) {
      await sendReply(chatId, `出错了: ${err?.message ?? err}`);
    }
  })();

  return { code: 0 };
}

async function main() {
  await initMemory();

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/feishu/webhook") {
        return new Response("Not found", { status: 404 });
      }
      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const body = await req.json();
      // 简化:省略了签名验证。生产代码必须加,见第 11 章
      const result = await handleEvent(body);
      return Response.json(result);
    },
  });

  console.log(`mini-hermes feishu gateway listening on :${PORT}`);
}

main();
```

约 120 行。关键点:

**点 1:每个飞书用户一个 Agent 实例**。通过 `agents` Map 管理。这保证了不同用户之间记忆和技能不串。对于真正的多用户部署,这个 Map 应该换成持久化存储,但 mini-hermes 只假设单用户或极少用户。

**点 2:异步处理 + 立即返回 200**。第 8.3 节讲过:飞书 webhook 超时很快,必须立即响应。Agent 的处理放在后台 Promise 里,完成后主动发送回复。

**点 3:`ALLOWED_USER_IDS` 白名单**。第 11 章讲过:不做白名单 = 把 Agent 触发权交给整个互联网。mini-hermes 默认启用白名单。

**点 4:签名验证被省略了**。这里必须说清楚 —— **生产环境绝不能省**。我省的原因是教学版要保持简洁。完整的签名验证代码在本书配套仓库的 `mini-hermes/src/feishu-gateway.ts` 里有(用 HMAC-SHA256,20 行左右)。

### 启动和配置

添加一个 script 到 `package.json`:

```json
"scripts": {
  "start": "bun run src/index.ts",
  "gateway": "bun run src/feishu-gateway.ts",
  "eval": "bun run src/eval-runner.ts"
}
```

设置环境变量,启动:

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=xxx
export FEISHU_VERIFICATION_TOKEN=xxx
export FEISHU_ALLOWED_USERS=ou_your_open_id
bun run gateway
```

配好 ngrok 或直接部署到 VPS,把 webhook URL 填到飞书应用配置里。在飞书里发消息给机器人 —— mini-hermes 应该会回复。

### 跑一周的观察(作者实测)

我把上面这个 mini-hermes 部署到一个 $5 的 Vultr VPS,接入一个测试飞书,跑了一周。观察:

**第 1 天**:基础对话正常。让它创建文件、读文件、写笔记,都 OK。触发了两次 propose_skill,一次通过、一次被拒(因为 trigger keywords 太宽泛)。

**第 2–3 天**:发现了一个 bug —— 我在手机上发了一条很长的消息(带换行),Agent 偶尔会"理解偏"。原因是 Agent 把换行里的某一行当成了独立指令。修复:在 gateway 里把 user text 做 trim 和去掉多余换行。

**第 4–5 天**:skills 目录下积累了 4 个自动生成的 skill。其中一个是"每天创建 daily note",一个是"整理 workspace 下所有 md 文件的列表",另外两个是实验性的。前两个被复用了至少 3 次,明显有用。

**第 6 天**:触发了一次 MAX_STEPS。用户让它"帮我整理 workspace 所有文件的内容到一个文档里",它在处理到第 15 步时遇到一个大文件读不完整(被 20K 截断),LLM 试图"重新读几次"陷入反复,最终达到 20 步上限。这说明 MAX_STEPS 保护起作用了。

**第 7 天**:一周总 LLM 成本约 $0.8。其中 60% 是主对话,20% 是 skill 审查,20% 是工具调用产生的回合。对一个真·个人使用,这是极低的成本。

## 16.6 砍掉了什么:mini-hermes 和 Hermes 的对照表

这是全章、也是全书最重要的一节。我们用一张表清点 mini-hermes 相对 Hermes 省了什么、为什么能省、以及想要哪些功能时应该回去读哪一章。

| 能力 | mini-hermes | Hermes | 省的原因 | 相关章节 |
|---|---|---|---|---|
| 对话循环 | 有(130 行) | 有(几千行) | 核心逻辑一样,mini 省去了错误重试、限流、trace | 第 7 章 |
| 工具调用 | 3 个工具 | 40+ 个工具 | 原理一样,多的是覆盖面 | 第 7 章 |
| 会话历史 | SQLite + FTS5 | SQLite + FTS5 | 这一层几乎一样 | 第 3 章 |
| 持久化笔记 | 文件系统直接读写 | memory_manager 管理 | mini 省了反思、去重、漂移检测 | 第 3 章 |
| 记忆检索 | 关键词(FTS5) | 关键词 + 向量 + 时间加权 | mini 对个人场景够用 | 第 3 章 |
| 技能格式 | Markdown + frontmatter | 一样 | 一致 | 第 4 章 |
| 技能生成 | 单次 LLM 提议 | 多阶段生命周期 | mini 保留了本质 | 第 4 章 |
| 质量闸门 | 单次 LLM 审查 | 多维度 rubric | mini 够用但不严格 | 第 4 章 |
| 技能修订 | 无 | 自动修订流程 | 学习闭环的一部分 | 第 6 章 |
| 技能废弃 | 无 | 自动废弃 | 同上 | 第 6 章 |
| 学习信号 | 无 | 三个来源(用户 + 完成 + 自评) | 没有这个 mini 不会真的"学习" | 第 6 章 |
| 离线反思 | 无 | 夜间批处理 | 省了,但留了口子 | 第 6 章 |
| 执行模式 | 只有 ReAct | ReAct + Plan + Reflexion | 简单任务 ReAct 够 | 第 7 章 |
| 模型路由 | 单模型 | 分级路由 | mini 可以手工改 | 第 7 章 |
| 预算和熔断 | MAX_STEPS | 多层预算 + 熔断 | 教学版只要一层 | 第 7 章 |
| 断点续跑 | 无 | trajectory checkpoint | 短任务不需要 | 第 7 章 |
| 子 Agent 并发 | 无 | 有 | 单 Agent 够教学 | 第 7 章 |
| MCP | 无 | 原生支持 | 加 MCP 要写一个 client | 第 8 章 |
| 消息网关 | 飞书(单一) | 6+ 种 | 其他平台结构相似 | 第 8 章 |
| Cron 定时 | 无 | 有 | 系统级 cron 加配置可以替代 | 第 8 章 |
| 多设备共享 | 通过飞书 | 通过所有 gateway | 对个人够用 | 第 9 章 |
| 可观测性 | console.log | OTel + 仪表盘 | 演示用 log 够 | 第 10 章 |
| 沙箱 | 路径限制 | 进程级沙箱 | 教学版轻量 | 第 11 章 |
| 敏感信息脱敏 | 无 | 有 | mini 用户只有你自己 | 第 11 章 |
| 评估框架 | 有(第 12 章的 basic.yaml) | 有 | mini 用一样的思路 | 第 12 章 |

**看这张表的正确方式**:它不是 "mini 差了这么多"。它是 "**mini 保留了 Hermes 能力的核心一半,用不到全部代码的 5%**"。这是"解剖学习"的价值 —— 你用很少的代码抓住了大部分概念,剩下的增量是"工程完善度"而不是"根本思想"。

当你用 mini-hermes 足够久,开始遇到瓶颈时,你会知道应该去 Hermes 或其他生产框架找什么 —— 因为你已经知道"那个缺失的部分叫什么名字、对应哪一章"。这比"从一个高度封装的框架开始"学得更快更深。

## 16.7 读者的下一步

到这里这本书的内容正式结束。合上书之前,问几个问题:

**问题一:下一步我应该用 mini-hermes 还是 Hermes?**

- 如果你只是个人用,需求简单(几个 skill、一个飞书机器人),**mini-hermes 足够**,你还可以随时改
- 如果你需要多设备、复杂任务、主动 cron 汇报、生产级可靠性,**用 Hermes**
- 如果你是企业场景,需要合规、多用户、严格流程,**既不是 mini-hermes 也不是 Hermes**,选 LangGraph 或 OpenClaw

**问题二:我应该贡献给谁?**

- 如果你在 mini-hermes 的基础上做了有价值的增强,可以把它作为一个独立的开源项目发布,作为"教学 Agent"的一个样本。这本书欢迎读者 fork 并在自己的方向上扩展
- 如果你发现了 Hermes 的 bug 或想加新功能,直接去 Hermes 的 GitHub 提 issue 或 PR,上游社区活跃

**问题三:下一个里程碑是什么?**

如果你要继续深入 Agent 领域,我建议三件事:

1. **给 mini-hermes 加一个新 feature**。任何你能想到的 —— 语义检索、A/B 评估、另一个 gateway。做完后你对 Agent 工程的理解会再上一个台阶
2. **用 Hermes 跑一个真的 long-term 项目**。至少三个月。只有长时间使用才能发现"自学习"的真实价值和问题
3. **读 Hermes 和 Letta 的源码**。这本书讲了设计原则和案例,但没有代入每一行代码。源码能教你的细节远比书多

**一个诚实的预测**:Agent 领域两年后会和今天很不一样。本书讲的某些技术可能会过时(模型变了、协议变了、工具链变了)。但**记忆 / 技能 / 学习 / 执行 / 可观测性 / 安全 / 评估**这七个 pillar 不会过时 —— 它们是任何"会成长的 AI 系统"都必须面对的问题。这本书围绕这七个 pillar 展开,所以它应该还能读很多年。

---

这本书到这里结束。谢谢你读完。

如果这 16 章和两章 mini-hermes 的实现,让你对 "Agent 到底是什么" 有了一个比读书前更扎实的认识,这本书就成功了。

如果你觉得某些地方讲得不够好、或者哪里的判断有偏差,欢迎在配套 GitHub 仓库提 issue。这本书和它讲的 Agent 一样 —— 它也会"成长"。
