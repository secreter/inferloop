# 一个真实的问题

## 五个人的 Code Review 战争

我之前待过一个五人前端团队。技术栈不复杂，React + TypeScript，业务也不算特别重。但 code review 这件事，一直像一颗定时炸弹。

小王是团队里最年轻的，代码写得快，但总是忘记检查 XSS。不是他不知道要检查——他知道，每次提完 PR 被打回来都要自嘲一句"又忘了"。老张是团队里的老大哥，review 别人代码特别认真，但他有个习惯：每次看到 `useEffect` 没写依赖数组，就在评论里贴同一句话——"这个 useEffect 缺依赖数组，请补全"。这句话他大概写了上百遍。

团队 leader 受不了了，花了一个周末写了份 Code Review 规范，二十几页，涵盖安全检查、Hooks 使用规范、命名约定、错误处理……写得挺好的，放在 Confluence 上，还在群里 @ 了所有人。

三个月后，新人入职问"咱们有 review 规范吗"，没人能找到那个链接。

这个场景你大概不陌生。问题的本质不是团队不专业，而是**知识在人的脑子里，无法被系统性地执行**。老张知道 `useEffect` 要写依赖数组，但这个知识只存在于老张的脑子里（和他的一百条重复评论里）。Confluence 上的文档本质上是个"写完就死"的产物——没有任何机制保证它会被执行。

## 10 行代码的转折

如果我告诉你，上面那个问题可以用 10 行文本解决呢？

在项目根目录创建一个文件 `.claude/skills/code-review/SKILL.md`：

```markdown
---
name: code-review
description: 按团队规范审查前端代码
---

# 代码审查 Skill

审查当前 PR 的变更文件，按以下规范逐项检查：

1. **安全**：所有用户输入必须经过转义，禁止直接使用 `dangerouslySetInnerHTML`，除非有明确注释说明原因
2. **Hooks 规范**：`useEffect` 必须声明依赖数组；自定义 Hook 必须以 `use` 开头
3. **错误处理**：异步调用必须有 try-catch 或 .catch()，不允许静默吞掉错误
4. **命名**：组件用 PascalCase，工具函数用 camelCase，常量用 UPPER_SNAKE_CASE
5. **类型安全**：禁止使用 `any`，必须使用明确的类型定义

对每个问题，指出具体文件和行号，给出修改建议。如果代码完全符合规范，回复"LGTM"。
```

就这么多。没有服务要部署，没有依赖要装，没有 API Key 要配。

现在团队任何人打开 Claude Code，在 PR 分支上说一句"帮我 review 一下这个 PR"，AI 就会自动加载这个 Skill，按团队规范逐条检查。

之前小王提的一个 PR，review 结果大概长这样：

**没有 Skill 时（AI 通用回复）：**

> 代码整体结构清晰，建议注意一下变量命名的一致性。另外可以考虑加一些注释提高可读性。

——说了等于没说。

**有 Skill 时：**

> `src/components/CommentBox.tsx:42` - 这里直接将 `userInput` 拼接进 DOM，存在 XSS 风险。建议使用 `DOMPurify.sanitize()` 处理后再渲染。
>
> `src/hooks/useUserData.ts:15` - `useEffect` 缺少依赖数组，当前写法会导致每次渲染都触发请求。应该声明 `[userId]` 作为依赖。
>
> `src/utils/format.ts:8` - `formatDate` 函数中的 `catch` 块为空，异常被静默吞掉。建议至少加一个 `console.error` 或上报到监控。

老张看到这个结果的时候说了一句："这不就是我每天干的事吗？"

对，就是你每天干的事。只不过现在它不会忘、不会漏、不会累，而且新人入职第一天就能用。

## 同一个需求，四种实现方式

"让 AI 帮忙做代码审查"这个需求，你其实有很多种实现方式。但不同方式之间的差距，比你想象的大得多。

### 方式一：Prompt——复制粘贴大法

最直觉的做法：每次让 AI 审查代码前，先把规则粘贴给它。

```
你是一个资深前端工程师，请按照以下规范审查代码：

1. 安全：所有用户输入必须转义，禁止 dangerouslySetInnerHTML
2. Hooks：useEffect 必须有依赖数组
3. 错误处理：异步调用必须有 catch
4. 命名：组件 PascalCase，函数 camelCase，常量 UPPER_SNAKE_CASE
5. 类型：禁止 any

以下是需要审查的代码：
<粘贴代码>
```

能用吗？能用。但问题很明显——

你每次都得粘贴这段话。小王粘贴的版本可能和老张的不一样，因为老张上周加了一条"禁止在组件内直接调用 localStorage"。三个人三个版本的 prompt，本质上跟没有规范差不多。

这就是 prompt 的局限：**它是一次性的、私有的、不可维护的**。

### 方式二：Tool——用脚本硬编码规则

工程师的直觉是写代码解决问题。于是你可能会想：写个 ESLint 自定义规则加上一个审查脚本不就行了？

```typescript
// scripts/review.ts
import { ESLint } from "eslint";

async function review(files: string[]) {
  const eslint = new ESLint({
    overrideConfigFile: ".eslintrc.review.json",
    useFlatConfig: false,
  });

  const results = await eslint.lintFiles(files);
  const formatter = await eslint.loadFormatter("stylish");
  const output = formatter.format(results);

  if (output) {
    console.log("=== 审查发现以下问题 ===");
    console.log(output);
  } else {
    console.log("LGTM - 未发现问题");
  }
}

const files = process.argv.slice(2);
review(files);
```

配合一个自定义的 ESLint 规则配置，可以检查出"用了 `any`""缺少依赖数组"之类的问题。

但这条路走下去你会发现一个根本性的瓶颈：**ESLint 只能做模式匹配，它不理解意图**。

"这个 `useEffect` 的依赖数组是不是写全了"——ESLint 能检查。

"这个组件的职责是不是太重了，应该拆分"——ESLint 做不到。

"这段代码虽然能跑，但违背了我们项目的状态管理约定"——ESLint 更做不到。

工具能覆盖的是规则性问题。但 code review 中真正有价值的部分——架构判断、业务逻辑合理性、设计意图的传达——全都超出了静态分析的能力范围。

### 方式三：Agent——搭一个审查服务

既然要用 AI 理解代码，那干脆搭个完整的 Agent 服务？监听 GitHub webhook，拉取 PR diff，调 LLM 做审查，把结果写回 PR comment。

架构大概长这样：

```
GitHub PR webhook
    │
    ▼
API Server (Express/Fastify)
    │
    ├── 拉取 PR diff (GitHub API)
    ├── 组装 prompt + diff
    ├── 调用 LLM (OpenAI / Claude API)
    └── 写回 PR comment (GitHub API)
```

核心代码：

```typescript
// agent/review-agent.ts
import { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";

async function handlePRWebhook(payload: PREvent) {
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const client = new Anthropic();

  // 1. 拉取 diff
  const { data: diff } = await octokit.pulls.get({
    owner: payload.repo.owner, repo: payload.repo.name,
    pull_number: payload.number,
    mediaType: { format: "diff" },
  });

  // 2. 调用 LLM 审查
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{ role: "user", content: REVIEW_PROMPT + diff }],
  });

  // 3. 写回评论
  await octokit.pulls.createReview({
    owner: payload.repo.owner, repo: payload.repo.name,
    pull_number: payload.number,
    body: response.content[0].text, event: "COMMENT",
  });
}
```

这个方案能工作，效果也不错。但代价呢？

你需要一个 API 服务（得部署、得监控）、一个 GitHub App（得注册、得配置权限）、要管理 API Key、要处理 rate limit、要写错误重试逻辑、webhook 挂了要有告警……

一个五人团队，为了做 code review，养了一个服务。这件事怎么想都不太对。

### 方式四：Skill——一个文件夹解决问题

回到最开始那 10 行代码。但这次我们看完整版的 Skill 文件结构：

```
.claude/skills/code-review/
├── SKILL.md              # 主指令文件
├── references/
│   └── team-conventions.md  # 团队约定的参考文档
└── scripts/
    └── check-pr-files.sh    # 获取 PR 变更文件列表
```

`SKILL.md`：

```markdown
---
name: code-review
description: 按团队规范审查前端代码
---

# 代码审查 Skill

审查当前分支相对于 base 分支的所有变更。

## 审查流程

1. 运行 `bash .claude/skills/code-review/scripts/check-pr-files.sh` 获取变更文件列表
2. 逐个读取变更文件，按照 `references/team-knowledge/naming-conventions.md` 中的规范进行审查
3. 输出审查报告，格式为：`文件路径:行号 - 问题描述 + 修改建议`

## 审查重点

- 安全漏洞（XSS、注入、敏感信息泄露）
- React Hooks 使用规范
- 错误处理完整性
- TypeScript 类型安全
- 命名规范一致性

如果无问题，回复 "LGTM"。
```

`scripts/check-pr-files.sh`：

```bash
#!/bin/bash
BASE_BRANCH=${1:-master}
git diff --name-only "$BASE_BRANCH"...HEAD -- '*.ts' '*.tsx'
```

完了。

这个方案有什么？

- **可复用**：任何团队成员 clone 了仓库就自动拥有这个 Skill
- **可维护**：规范变了？改 `team-conventions.md`，提个 PR，review 通过就生效
- **零部署**：不需要服务器、不需要 API Key、不需要 webhook 配置
- **版本控制**：Skill 本身就是代码仓库的一部分，改了什么、谁改的、为什么改，`git log` 一目了然
- **跨平台**：遵循 Agent Skills 开放规范，Claude Code、Cursor、GitHub Copilot 等 30 多个平台都能识别

四种方式做个对比：

| | Prompt | Tool | Agent | Skill |
|---|---|---|---|---|
| 能理解业务逻辑 | 能 | 不能 | 能 | 能 |
| 团队可共享 | 不能 | 能 | 能 | 能 |
| 需要部署 | 不需要 | 不需要 | 需要 | 不需要 |
| 可版本管理 | 不能 | 能 | 能 | 能 |
| 开发成本 | 几乎为零 | 中等 | 高 | 低 |
| 可维护性 | 差 | 中 | 中 | 好 |

Prompt 太轻，Agent 太重，Tool 不够智能。Skill 刚好在那个甜蜜点上。

## Skill 到底是什么

到这里有必要说清楚 Skill 的定义，因为这个词被用滥了。

Skill 不是插件——它不需要运行时加载机制。Skill 不是 SDK——它不需要你写代码去调用。Skill 不是 API——它没有网络端点。

**Skill 是给 AI 的标准化知识包。**

具体来说，一个 Skill 由四部分组成：

- **指令（SKILL.md）**：告诉 AI "做什么"和"怎么做"
- **参考知识（references/）**：AI 执行时需要查阅的上下文——团队规范、API 文档、设计稿说明
- **脚本（scripts/）**：AI 可以调用的辅助工具——获取文件列表、跑测试、调用外部 API
- **评测用例（evals/）**：验证 Skill 是否按预期工作的测试集

它遵循 Agent Skills 开放规范。这意味着同一个 Skill 可以在 Claude Code 里被加载，也可以在 Cursor、GitHub Copilot、Windsurf 等 30 多个支持该规范的平台上被识别和执行。你写一次，到处能用。

而且它天然存在于代码仓库中。新人 clone 了项目，Skill 就在那里。不需要额外安装，不需要翻 Confluence 找链接，不需要问老张"那个规范文档在哪"。

回到开头那个场景：老张脑子里关于 `useEffect` 的知识，现在变成了 `references/team-knowledge/naming-conventions.md` 里的一行字。小王再也不会忘记检查 XSS，因为 Skill 每次都会替他检查。而那份消失在 Confluence 里的规范文档，现在就在 `.claude/skills/` 目录下，跟业务代码住在一起，一起被 review、一起被维护。

**知识从人的脑子里，搬到了可执行、可共享、可版本化的文件里。**

这才是 Skill 真正解决的问题。

## 这本书要做什么

这本书不会停在"写一个 SKILL.md"这个层面。10 行文本能解决的问题终究有限。

后面的章节会带你经历一个完整的过程：从理解 Skill 的工程结构，到掌握指令编写的技巧，到用脚本扩展 AI 的能力边界，到为 Skill 写评测用例保证质量，再到在团队中建立 Skill 的研发流程。

代码审查这个案例会贯穿全书。你会看到它从最初的 10 行，逐步演化成一个包含多种审查策略、能适应不同项目类型、有完善评测体系的工程级 Skill。

每一章都有可运行的代码，每一个实践都来自真实项目。翻完这本书，你应该能独立构建和维护生产级的 AI Skill。

开始吧。
