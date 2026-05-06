# 第 15 章 用 TypeScript 从零构造 mini-hermes(上):骨架与记忆

前面 14 章都在讲"别人写的 Agent"—— 看代码、读源码、跑案例。这一章和下一章要做一件根本不同的事:**亲手写一个**。

这不是简单的练习。亲手写 Agent 的价值在于:当你"只看不写"时,很多机制你觉得自己懂了,直到你自己实现时才会发现"哦原来这里有个坑"。前 14 章里讲过的抽象会在写代码时变得具体,你对"Agent 到底是什么"会有一个远比读书更扎实的认识。

这一章和第 16 章一起,完成一个叫 **mini-hermes** 的最小可用 Agent。目标不是"做一个能替代 Hermes 的东西",而是"用最少的代码复刻 Hermes 的核心 mental model":一个对话循环、一个文件化的三层记忆、一个 skill 加载器、一个让 Agent 能自己写 skill 的机制。

完整代码在本书配套仓库的 `mini-hermes/` 目录。你可以一边读本章一边 clone 仓库对照着看,或者读完本章后自己从零敲一遍(后者收获更大)。

## 15.1 为什么要"复刻"

在开始之前,先说服你:这个工作值得做。

**理由一:你会明白哪些东西是本质的,哪些是装饰**。Hermes 有几万行代码,其中大量是错误处理、性能优化、特殊场景的兼容。这些当然重要,但它们会掩盖"核心是什么"。mini-hermes 把 Hermes 的核心压缩到几百行,你可以一眼看出哪些东西是"不能省"的。

**理由二:你会拥有一个可以改的东西**。Hermes 很完整,但你不太可能为了一个想法改它的源码。mini-hermes 是你自己的,你可以任意改 —— 试试不同的记忆策略、试试不同的 skill matching、试试接入不同的模型。它是一个活的 playground。

**理由三:你会在"Hermes 的设计决策"上有发言权**。当你自己实现过一遍,你会知道"为什么 Hermes 这里选 SQLite"、"为什么那里用 Markdown"。这些选择背后的权衡,只有实现过的人才真正理解。

## 15.2 技术选型

### 运行时:Bun

mini-hermes 用 **Bun** 作为 JavaScript/TypeScript 运行时。原因:

- **内置 SQLite**,不需要装额外依赖(对标 Hermes 的 SQLite)
- **原生 TypeScript 支持**,不需要配 tsconfig、不需要 build 步骤
- **启动快**,`bun run` 几乎是立即的,适合快速迭代
- **包管理和执行一体**,`bun install` 和 `bun run` 就是全部命令

如果你坚持用 Node.js 也可以,但要自己装 `better-sqlite3` 和配 TypeScript 编译。Deno 也能用,但 SQLite 的集成要用 FFI,麻烦一些。

### LLM SDK:@anthropic-ai/sdk 原生

用 **Anthropic 原生 SDK**,不用 Vercel AI SDK、不用 LangChain.js、不用任何封装。

第 4 章讲过 Hermes 的设计原则之一是"解剖式透明"。mini-hermes 继承这个原则 —— 我们要让你看到每一次 LLM 调用的完整 tool_use / tool_result 结构,而不是被 `generateText({ tools })` 这种高级 API 屏蔽掉。这会让你对 LLM 工具调用的内部结构有一个直接的手感,这个手感在以后写其他 Agent 时会一直有用。

代价是代码会稍长一点 —— 大概多 100 行左右。但那 100 行就是 Agent 执行循环的本质,不是废话。

如果你想用 OpenAI 或别的模型,最后 16.x 会给一个"换模型"的附录,但主线代码以 Anthropic 为准。

### 目录结构

```
mini-hermes/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # 入口
│   ├── agent.ts          # 主循环
│   ├── llm.ts            # LLM 调用封装
│   ├── memory.ts         # 三层记忆
│   ├── skills.ts         # skill 加载 + 生成
│   ├── tools.ts          # 内置工具
│   ├── context.ts        # Prompt 构造
│   └── types.ts          # 类型定义
├── data/
│   ├── sessions.db       # SQLite(运行时创建)
│   ├── memory/           # 持久化笔记(运行时创建)
│   └── skills/           # 技能(运行时创建)
└── eval/
    └── basic.yaml        # 基础评估集(第 12 章提到过)
```

200 行左右的 `agent.ts` 是核心。其他文件都是为它服务的。

## 15.3 package.json 和项目初始化

```json
{
  "name": "mini-hermes",
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "bun-types": "latest"
  },
  "scripts": {
    "start": "bun run src/index.ts",
    "eval": "bun run src/eval-runner.ts"
  }
}
```

```bash
cd mini-hermes
bun install
export ANTHROPIC_API_KEY=sk-ant-xxx  # 或者写到 .env
bun run start
```

没了。不用 tsconfig(Bun 有默认的),不用 webpack,不用 babel。

## 15.4 类型定义:定好地基

先定义所有会用到的类型。好的类型定义是一个项目的"地基",写在前面可以避免后续改来改去。

```typescript
// src/types.ts

export type Role = "user" | "assistant" | "tool_result";

export interface Message {
  role: Role;
  content: string | ContentBlock[];
  timestamp: number;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export interface Skill {
  name: string;
  description: string;
  triggerKeywords: string[];
  body: string;              // 完整的 SKILL.md 正文
  createdAt: number;
  lastUsedAt?: number;
  useCount: number;
  successCount: number;
  filePath: string;
}

export interface MemoryNote {
  path: string;              // 相对 memory/ 的路径
  content: string;
  tags: string[];
  updatedAt: number;
}

export interface Session {
  id: string;
  createdAt: number;
  messages: Message[];
}
```

这些类型直接映射了 Hermes 的核心概念:Message 对应会话历史,Skill 对应技能文件,MemoryNote 对应持久化笔记,Session 是把它们串起来的容器。

## 15.5 LLM 封装:200 行对话循环的基础

`src/llm.ts` 封装 Anthropic SDK 的调用。这一层的目的是:

- 把"拿到一个 response 可能是文本也可能是 tool_use"这个分支处理干净
- 统一记录 token 消耗和延迟(为后续观测做准备)
- 支持模型切换(虽然 mini-hermes 主要用 Claude)

```typescript
// src/llm.ts
import Anthropic from "@anthropic-ai/sdk";
import type { Message, ContentBlock, ToolDefinition } from "./types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface LLMCallOptions {
  model: string;              // e.g. "claude-3-5-sonnet-20241022"
  system: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
}

export interface LLMCallResult {
  content: ContentBlock[];
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function callLLM(opts: LLMCallOptions): Promise<LLMCallResult> {
  const start = Date.now();

  // 把我们的内部 Message 格式转换成 Anthropic SDK 需要的格式
  const apiMessages = opts.messages.map((m) => ({
    role: m.role === "tool_result" ? "user" : m.role,
    content: m.content as any,  // 简化:生产代码要做更严谨的类型转换
  }));

  // tools 转换成 Anthropic 需要的格式
  const apiTools = opts.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: apiMessages as any,
    tools: apiTools,
  });

  const latencyMs = Date.now() - start;

  // 把 response 的 content blocks 转成我们内部的格式
  const content: ContentBlock[] = response.content.map((block: any) => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    } else if (block.type === "tool_use") {
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    }
    throw new Error(`Unknown content block type: ${block.type}`);
  });

  return {
    content,
    stopReason: response.stop_reason ?? "end_turn",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}
```

这一段代码的关键点:

- **原生 SDK 暴露了完整的 content blocks**,我们不做隐藏 —— 你能看到 `tool_use`、`tool_result` 这些结构
- **usage 直接传给调用方**,方便后续统计成本
- **role 的映射**:我们内部有 `tool_result` 这个 role,但 Anthropic API 里 tool_result 走 "user" role 的 content blocks,这里做一次转换

## 15.6 三层记忆:复刻 Hermes 的目录结构

`src/memory.ts` 实现 Hermes 讲过的三层记忆。我们不完全复现(那样需要几千行),而是抓住本质:

- **第一层(会话历史)**:用 Bun 的内置 SQLite
- **第二层(持久化笔记)**:用 `data/memory/` 目录下的 Markdown 文件
- **第三层(技能)**:在 skills.ts 里实现,本节不涉及

```typescript
// src/memory.ts
import { Database } from "bun:sqlite";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Message, Session, MemoryNote } from "./types";

const DB_PATH = "./data/sessions.db";
const MEMORY_DIR = "./data/memory";

let db: Database;

export async function initMemory() {
  await mkdir("./data", { recursive: true });
  await mkdir(MEMORY_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
      USING fts5(content, content='messages', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);
}

// ---------- 第一层:会话历史 ----------

export function createSession(): Session {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare("INSERT INTO sessions (id, created_at) VALUES (?, ?)").run(id, createdAt);
  return { id, createdAt, messages: [] };
}

export function appendMessage(sessionId: string, msg: Message) {
  const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  db.prepare(
    "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)"
  ).run(sessionId, msg.role, contentStr, msg.timestamp);
}

export function getSessionMessages(sessionId: string): Message[] {
  const rows = db
    .prepare("SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY id")
    .all(sessionId) as any[];
  return rows.map((r) => ({
    role: r.role,
    content: tryParseJson(r.content),
    timestamp: r.timestamp,
  }));
}

function tryParseJson(s: string): any {
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
    return s;
  } catch {
    return s;
  }
}

// 跨会话检索:用 FTS5 做关键词搜索
export function searchAcrossSessions(query: string, limit = 10): Message[] {
  const rows = db
    .prepare(
      `SELECT m.role, m.content, m.timestamp
       FROM messages_fts fts
       JOIN messages m ON m.id = fts.rowid
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(query, limit) as any[];
  return rows.map((r) => ({
    role: r.role,
    content: tryParseJson(r.content),
    timestamp: r.timestamp,
  }));
}

// ---------- 第二层:持久化笔记 ----------

export async function listMemoryNotes(): Promise<MemoryNote[]> {
  const notes: MemoryNote[] = [];
  async function walk(dir: string, prefix: string) {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.join(prefix, e.name);
      if (e.isDirectory()) {
        await walk(full, rel);
      } else if (e.name.endsWith(".md")) {
        const content = await readFile(full, "utf-8");
        const tags = extractTags(content);
        const stat = await Bun.file(full).stat?.();
        notes.push({
          path: rel,
          content,
          tags,
          updatedAt: stat?.mtimeMs ?? Date.now(),
        });
      }
    }
  }
  await walk(MEMORY_DIR, "");
  return notes;
}

export async function readMemoryNote(relPath: string): Promise<string | null> {
  const full = path.join(MEMORY_DIR, relPath);
  if (!existsSync(full)) return null;
  return readFile(full, "utf-8");
}

export async function writeMemoryNote(relPath: string, content: string) {
  const full = path.join(MEMORY_DIR, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf-8");
}

function extractTags(content: string): string[] {
  // 简化:从 frontmatter 或 content 里抓 #tag 模式
  const matches = content.match(/#[\w-]+/g) ?? [];
  return [...new Set(matches.map((t) => t.slice(1)))];
}

// ---------- 辅助:生成记忆的"快照"供 Prompt 使用 ----------

export async function buildMemorySnapshot(): Promise<string> {
  const notes = await listMemoryNotes();
  if (notes.length === 0) return "(当前无持久化笔记)";

  // 简化策略:把所有笔记的第一段(或前 200 字)拼起来
  const summaries = notes.map((n) => {
    const first = n.content.slice(0, 200).replace(/\n+/g, " ");
    return `- ${n.path}: ${first}...`;
  });
  return summaries.join("\n");
}
```

几个要点:

**要点一:SQLite 的 FTS5 自动维护**。通过 trigger,每条新消息插入时自动同步到 FTS 索引。这样关键词检索是"零延迟"的。

**要点二:记忆快照(buildMemorySnapshot)的极简实现**。在 Hermes 里这是一个复杂的流程(选相关、按权重排序、压缩);在 mini-hermes 里我们就直接把所有笔记的第一段拼起来。这个简化有代价 —— 当笔记超过 50 条时 Prompt 会撑不住 —— 但对演示足够。第 16 章会把它升级成更聪明的版本。

**要点三:没做语义检索**。只用关键词(FTS5)。原因在第 3 章讲过:个人 Agent 的记忆量不大,关键词检索很多时候够用。如果你想加语义,可以集成 embedding API,但会增加代码量。MVP 先不加。

## 15.7 内置工具:最小可用的三个

`src/tools.ts` 实现三个最基础的工具。生产 Agent 会有几十个工具,但 mini-hermes 只给三个,目的是让你看清"工具调用的完整结构",而不是被工具的多样性淹没。

```typescript
// src/tools.ts
import type { ToolDefinition } from "./types";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const WORK_ROOT = "./data/workspace";

export const tools: ToolDefinition[] = [
  {
    name: "read_file",
    description: "读取 workspace 内某个文件的内容。只能读 ./data/workspace 下的文件。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对 workspace 的路径" },
      },
      required: ["path"],
    },
    async execute(input) {
      const rel = input.path as string;
      const full = path.resolve(WORK_ROOT, rel);
      if (!full.startsWith(path.resolve(WORK_ROOT))) {
        return "Error: path escapes workspace";
      }
      if (!existsSync(full)) {
        return `Error: file not found: ${rel}`;
      }
      const content = await readFile(full, "utf-8");
      return content.length > 20000 ? content.slice(0, 20000) + "\n...(truncated)" : content;
    },
  },
  {
    name: "write_file",
    description: "写入文件到 workspace。会创建必要的父目录。只能写 ./data/workspace 下的文件。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    async execute(input) {
      const rel = input.path as string;
      const content = input.content as string;
      const full = path.resolve(WORK_ROOT, rel);
      if (!full.startsWith(path.resolve(WORK_ROOT))) {
        return "Error: path escapes workspace";
      }
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content, "utf-8");
      return `OK: wrote ${content.length} bytes to ${rel}`;
    },
  },
  {
    name: "list_directory",
    description: "列出 workspace 内某个目录的内容",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对 workspace 的路径,默认根目录" },
      },
    },
    async execute(input) {
      const rel = (input.path as string) ?? ".";
      const full = path.resolve(WORK_ROOT, rel);
      if (!full.startsWith(path.resolve(WORK_ROOT))) {
        return "Error: path escapes workspace";
      }
      if (!existsSync(full)) return "Error: directory not found";
      const entries = await readdir(full, { withFileTypes: true });
      return entries
        .map((e) => (e.isDirectory() ? `[dir] ${e.name}` : `      ${e.name}`))
        .join("\n");
    },
  },
];
```

这三个工具加起来约 80 行。注意几个安全细节:

- **所有路径都被限制在 `./data/workspace` 下**。`path.resolve` + `startsWith` 防止用户(或 LLM)用 `../` 逃出 workspace。这是第 11 章讲的"沙箱"在最简形式 —— 不是完整的沙箱,但对教学版足够
- **读文件有长度上限**(20K 字符)。防止 LLM 因为读了一个巨大文件而 context 爆掉
- **错误以文本返回**,不是抛异常。Agent 在看到 "Error: file not found" 时会自己决定怎么处理(通常是尝试创建或换路径)

## 15.8 Context 构造:Prompt 是 Agent 的"当前状态"

`src/context.ts` 负责把"当前对话状态 + 记忆快照 + 可用工具 + 可用技能"组装成发给 LLM 的 Prompt。

```typescript
// src/context.ts
import type { Skill } from "./types";
import { buildMemorySnapshot } from "./memory";

export async function buildSystemPrompt(skills: Skill[]): Promise<string> {
  const memory = await buildMemorySnapshot();
  const skillsSection = buildSkillsSection(skills);

  return `你是 mini-hermes,一个会成长的个人 AI 助手。

## 你的记忆(持久化笔记)

${memory}

## 你当前可用的技能

${skillsSection}

## 行为准则

- 优先使用已有技能完成任务,而不是从零推理
- 如果用户的请求涉及重复性的多步操作,完成后可以建议把流程沉淀为新 skill
- 所有文件操作都在 ./data/workspace 下,不要尝试访问其他路径
- 写文件前先检查是否需要读已有内容
- 遇到错误不要慌,分析错误信息后再尝试

## 输出风格

- 直接、简洁、有判断
- 不要客套话
- 不要解释你"将要"做什么,直接做(除非是危险操作需要用户确认)
`;
}

function buildSkillsSection(skills: Skill[]): string {
  if (skills.length === 0) {
    return "(暂无自定义技能)";
  }
  return skills
    .map((s) => `### ${s.name}\n${s.description}\n\n触发关键词: ${s.triggerKeywords.join(", ")}\n\n(调用时请参考完整 SKILL.md,位于 ${s.filePath})`)
    .join("\n\n");
}
```

这个 `buildSystemPrompt` 非常直观 —— 它就是把三块东西(记忆、技能、行为准则)拼成一段。这和 Hermes 的 `prompt_builder.py` 做的事本质是一样的,只是 Hermes 的版本多了很多分支和优化。

**一个重要细节**:技能的 `body`(完整 SKILL.md 正文)**没有被放进 system prompt**。只有 name + description + triggerKeywords 被放进去。完整 body 通过 `filePath` 间接引用,当 Agent 真的要调用某个 skill 时,再通过工具调用去读文件。

这个选择的原因是 **token 效率**。如果把所有 skill 的 body 都塞进 system,10 个 skill 就可能占几千 token,每次对话都付这个成本。"按需加载"让成本只在真正使用 skill 时产生。

## 15.9 主循环:Agent 的心脏

`src/agent.ts` 是整个项目最重要的文件。一共大约 130 行。

```typescript
// src/agent.ts
import { callLLM } from "./llm";
import { buildSystemPrompt } from "./context";
import { tools } from "./tools";
import { loadSkills } from "./skills";
import { createSession, appendMessage, getSessionMessages } from "./memory";
import type { Message, ContentBlock, Session } from "./types";

const MODEL = "claude-3-5-sonnet-20241022";
const MAX_STEPS = 20;

export interface RunResult {
  response: string;
  steps: number;
  inputTokensTotal: number;
  outputTokensTotal: number;
  errored: boolean;
}

export class Agent {
  private session: Session;

  constructor(session?: Session) {
    this.session = session ?? createSession();
  }

  get sessionId(): string {
    return this.session.id;
  }

  async run(userInput: string): Promise<RunResult> {
    // 1. 记录用户输入
    const userMsg: Message = {
      role: "user",
      content: userInput,
      timestamp: Date.now(),
    };
    appendMessage(this.session.id, userMsg);
    this.session.messages.push(userMsg);

    // 2. 准备 system prompt 和 tools
    const skills = await loadSkills();
    const system = await buildSystemPrompt(skills);

    let inputTokensTotal = 0;
    let outputTokensTotal = 0;
    let steps = 0;

    // 3. 主循环
    while (steps < MAX_STEPS) {
      steps++;

      // 3a. 调 LLM
      const result = await callLLM({
        model: MODEL,
        system,
        messages: this.session.messages,
        tools,
      });
      inputTokensTotal += result.inputTokens;
      outputTokensTotal += result.outputTokens;

      // 3b. 记录 assistant 消息
      const assistantMsg: Message = {
        role: "assistant",
        content: result.content,
        timestamp: Date.now(),
      };
      appendMessage(this.session.id, assistantMsg);
      this.session.messages.push(assistantMsg);

      // 3c. 检查是否包含 tool_use
      const toolUses = result.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use"
      );

      if (toolUses.length === 0) {
        // 没有工具调用,说明 LLM 认为任务完成了
        const textBlocks = result.content.filter(
          (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text"
        );
        const response = textBlocks.map((b) => b.text).join("\n");
        return {
          response,
          steps,
          inputTokensTotal,
          outputTokensTotal,
          errored: false,
        };
      }

      // 3d. 执行所有 tool_use
      const toolResults: ContentBlock[] = [];
      for (const tu of toolUses) {
        const tool = tools.find((t) => t.name === tu.name);
        if (!tool) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Error: unknown tool ${tu.name}`,
            is_error: true,
          });
          continue;
        }
        try {
          const output = await tool.execute(tu.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: output,
          });
        } catch (err: any) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Error: ${err?.message ?? String(err)}`,
            is_error: true,
          });
        }
      }

      // 3e. 把 tool_result 作为下一轮的输入
      const toolResultMsg: Message = {
        role: "tool_result",
        content: toolResults,
        timestamp: Date.now(),
      };
      appendMessage(this.session.id, toolResultMsg);
      this.session.messages.push(toolResultMsg);

      // 继续下一轮
    }

    // 4. MAX_STEPS 超出
    return {
      response: "(任务未完成:超出最大步数)",
      steps,
      inputTokensTotal,
      outputTokensTotal,
      errored: true,
    };
  }
}
```

这 130 行就是 Agent 的主循环。读三遍,把它记在心里 —— **这是所有 Agent 的本质**。无论 Hermes、LangChain、Claude Code 多么复杂,它们的核心都是这个循环:**用户输入 → LLM → 判断(有没有 tool_use)→ 执行工具 → 把结果塞回 LLM → 直到 LLM 说"不调工具了,我有最终答案"**。

几个细节要注意:

**点 1:`toolUses.length === 0` 是终止条件**。Claude 的行为是:当它认为任务完成时,只输出 text blocks 不输出 tool_use。我们检测到这个状态就退出循环。

**点 2:多个 tool_use 可能并行**。Claude 在单次响应里可以输出多个 tool_use 块,我们要对它们都执行,然后一起把 tool_result 喂回去。这个"并发调用多个工具"的能力在 Hermes 里也有,第 7 章讲过。

**点 3:错误不直接抛出**。工具执行失败时,我们把 "Error: ..." 作为 tool_result 的 content 塞回去,让 LLM 看到错误并自己决定怎么处理。直接抛异常会中断循环,Agent 就失去了"自我恢复"的能力。

**点 4:MAX_STEPS 的硬上限**。第 7 章讲过,没有上限的 Agent 可能烧钱烧到天亮。

## 15.10 入口:一个极简的 REPL

`src/index.ts` 是入口。我们做一个极简的 REPL(read-eval-print loop),让你能在命令行和 mini-hermes 对话。

```typescript
// src/index.ts
import { initMemory } from "./memory";
import { Agent } from "./agent";

async function main() {
  await initMemory();
  const agent = new Agent();

  console.log("mini-hermes 启动。输入 exit 退出。");
  console.log(`session id: ${agent.sessionId}\n`);

  for await (const line of console) {
    const input = line.trim();
    if (input === "exit") break;
    if (!input) continue;

    try {
      const result = await agent.run(input);
      console.log(`\n${result.response}`);
      console.log(`\n[steps=${result.steps} in=${result.inputTokensTotal} out=${result.outputTokensTotal}]\n`);
    } catch (err: any) {
      console.error(`\nError: ${err?.message ?? err}\n`);
    }
  }

  console.log("bye");
}

main();
```

运行:

```bash
bun run src/index.ts
```

你会看到提示符,输入一句话,Agent 开始工作,返回答案。试一下:

```
> 在 workspace 下创建一个 hello.txt 文件,写入 "hello from mini-hermes"
```

Agent 应该会调用 `write_file` 工具,然后回复 "OK,已创建"。然后:

```
> 读一下 hello.txt 看看
```

Agent 应该会调 `read_file`,返回内容。

到这里你已经有了一个**能对话、能调工具、能访问文件系统、有三层记忆雏形**的 Agent。它不会自己写 skill(下一章做),但骨架已经齐了。

## 15.11 当前状态:我们做到了什么,还缺什么

盘点一下。**做到了的**:

- 对话循环(agent.ts)
- 工具调用(tools.ts,三个基础工具)
- 会话历史持久化(memory.ts,SQLite + FTS5)
- 持久化笔记的读写(memory.ts,文件系统)
- Prompt 组装(context.ts)
- LLM 调用抽象(llm.ts)
- REPL 入口(index.ts)

**还缺的**(第 16 章会补齐):

- skill 加载器(skills.ts 我们还没写实质内容)
- skill 的自动生成
- skill 的质量闸门
- 学习闭环的极简版
- 对接飞书机器人

**根本做不到的(mini-hermes 的边界)**:

- 多模型路由(只用一个 Claude 模型)
- 向量检索(只有 FTS5)
- 智能的记忆反思(memory_manager 的完整版)
- 复杂的 skill 生命周期(版本、修订、废弃)
- 多 Agent 并发
- Plan-and-Execute 和 Reflexion 模式

这些缺失是**有意的**,不是忘了。mini-hermes 的目标是让你看清"核心是什么",把能省的都省掉。第 16 章会讲"为什么省掉这些对教学版 OK,但对生产版不 OK"。

## 15.12 实践:用现有骨架跑一个小任务

在进入第 16 章之前,用现在的骨架做一个小实验。启动 mini-hermes,输入:

> 我在写一本书,主题是 Agent 设计。请在 workspace 下创建一个 `book/outline.md`,列一个初步目录(5-7 章),每章只写标题。

观察发生的事:

1. Agent 会思考几步(可能先 list_directory 看目录结构)
2. 然后调 write_file 创建文件
3. 返回一个简短的确认

然后输入:

> 读一下 book/outline.md,告诉我第 3 章是什么

它应该调 read_file,然后返回第 3 章的标题。

再试一个:

> 在 book/chapters/ 下创建 3 个空的章节文件:chapter-01.md, chapter-02.md, chapter-03.md

它应该调 write_file 三次(或者通过 list_directory 先检查),创建三个文件。

这些交互里你可以看到 Agent 的"多步工具调用"在起作用 —— 单次用户输入触发了多次 tool_use。每次 tool_use 的结果会回到 LLM,LLM 决定下一步。

如果你想看到每一步的详细信息,可以在 `agent.ts` 的循环里加一些 `console.log`:

```typescript
console.log(`[step ${steps}] ${toolUses.length} tool use(s)`);
for (const tu of toolUses) {
  console.log(`  - ${tu.name}(${JSON.stringify(tu.input).slice(0, 80)})`);
}
```

加上这些日志之后,每次运行你都能看到 Agent 的"思考步骤",这是理解它行为的关键。

第 16 章我们给这个骨架加上灵魂 —— **让它自己写 skill**。
