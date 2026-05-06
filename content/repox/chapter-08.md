# 第 8 章 接入大模型 -- 基础能力

命令行是 AI 能力的天然载体。没有花哨的 UI，没有复杂的前端状态管理，输入是文本，输出也是文本——和大语言模型的交互模式完全吻合。一条 `repox explain src/core/ai.ts` 就能获得一份代码解读报告，一条 `repox commit` 就能从暂存区的 diff 中生成规范的 commit message。

本章从 LLM API 的统一抽象讲起，覆盖非流式和流式调用、prompt 设计、成本控制，最终落地到 repox 的两个 AI 命令实现。

## 8.1 CLI + AI 的化学反应

AI 应用的交互形态有很多：Web 聊天界面、IDE 插件、API 服务。CLI 作为 AI 的入口，有几个独特优势：

**零 UI 开发成本。** 不需要写前端，不需要设计对话气泡，`process.stdout.write` 就是全部的渲染引擎。流式输出天然适配终端——逐字打印到屏幕，和大模型逐 token 生成的节奏完美同步。

**管道组合能力。** CLI 输出的文本可以直接通过管道传给下一个命令。`repox explain src/utils/git.ts | pbcopy` 把 AI 的代码解读复制到剪贴板，`repox changelog --from v1.0.0 -o CHANGELOG.md` 直接写文件。这种可组合性是 GUI 应用做不到的。

**上下文精确可控。** Web 对话式 AI 需要用户手动粘贴代码。CLI 工具可以自动读取 git diff、文件内容、项目配置，精确构造 prompt。用户不需要操心"要给 AI 看什么"——工具已经知道了。

**自动化友好。** CI/CD 流水线、Git Hook、定时任务，CLI 命令可以无缝嵌入任何自动化场景。`repox review --staged` 放在 pre-commit hook 里，每次提交前自动做 code review。

## 8.2 LLM API 统一抽象

大模型服务商很多——OpenAI、Anthropic Claude、火山引擎豆包、智谱 GLM、通义千问——但几乎所有主流服务都兼容 OpenAI 的 API 协议。这意味着用一个 OpenAI SDK 客户端，只需要换 `baseURL` 和 `apiKey`，就能接入不同的模型。

repox 选择 `openai` 这个官方 npm 包作为唯一的 AI SDK 依赖：

```typescript
// src/core/ai.ts
import OpenAI from 'openai'

export function createAIClient(config: RepoxConfig): OpenAI {
  const apiKey = config.ai.apiKey
  if (!apiKey) {
    throw new UserError(
      'AI API Key 未配置',
      '请执行 repox config set ai.apiKey <your-key> 或设置环境变量 REPOX_AI_API_KEY',
    )
  }

  return new OpenAI({
    apiKey,
    baseURL: config.ai.baseUrl,
  })
}
```

配置中 `baseUrl` 的默认值是火山引擎的 API 端点：

```typescript
// src/core/config.ts — configSchema 定义
ai: z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
  model: z.string().default('doubao-1-5-pro-32k-250115'),
}).default({}),
```

切换到其他服务商只需修改配置：

```bash
# 使用 OpenAI
repox config set ai.baseUrl https://api.openai.com/v1
repox config set ai.model gpt-4o

# 使用 Claude（通过兼容层）
repox config set ai.baseUrl https://api.anthropic.com/v1
repox config set ai.model claude-sonnet-4-20250514

# 使用火山引擎豆包（默认）
repox config set ai.baseUrl https://ark.cn-beijing.volces.com/api/v3
repox config set ai.model doubao-1-5-pro-32k-250115
```

这种设计的好处不只是灵活。对于国内开发者，直接调用 OpenAI 需要翻墙，而火山引擎的豆包模型在国内有低延迟的端点。通过配置切换，同一份代码可以适配不同网络环境。

### API Key 安全

CLI 工具处理 API Key 需要格外小心。repox 支持三种配置方式，优先级从高到低：

1. **环境变量** `REPOX_AI_API_KEY`——适合 CI/CD，不写入任何文件
2. **全局配置** `~/.config/repox/config.json`——用户级别，对所有项目生效
3. **项目配置** `.repoxrc`——项目级别，**不应该提交到 Git**

`createAIClient` 在 API Key 缺失时抛出 `UserError`，错误信息中直接给出配置指引。不要让用户去翻文档——在错误发生的地方告诉他怎么解决。

## 8.3 非流式调用

最简单的 AI 调用方式：发一次请求，等模型生成完毕，一次性返回完整结果。

```typescript
// src/core/ai.ts
export async function chat(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
): Promise<string> {
  logger.debug(`AI 请求: model=${model}, messages=${messages.length} 条`)
  const response = await client.chat.completions.create({
    model,
    messages,
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new UserError('AI 返回了空内容')
  }

  logger.debug(`AI 响应: ${content.length} 字符`)
  return content
}
```

几个关注点：

**返回值提取。** OpenAI 的响应结构是 `response.choices[0].message.content`。`choices` 是一个数组，因为 API 支持一次返回多个候选（`n` 参数）。CLI 场景下只需要第一个。

**空内容处理。** 模型有可能返回空字符串（比如 prompt 触发了内容安全策略）。直接抛 `UserError` 比返回空字符串再让调用方困惑要好。

**日志。** debug 级别记录请求参数和响应长度，不记录完整内容——避免泄露 prompt 和 API 响应到日志中。

非流式调用适合结果需要后处理的场景：`repox commit` 生成的 commit message 需要展示给用户确认后才执行 `git commit`，不需要逐字输出。

## 8.4 流式调用

AI 模型生成一段 500 字的文本可能需要 5-10 秒。非流式调用意味着用户在这段时间内只能盯着一个 spinner 转圈。流式调用（Streaming SSE）让模型生成的每个 token 实时推送到客户端，CLI 可以逐字打印——用户能看到"AI 正在思考"，体验截然不同。

OpenAI SDK 的流式接口基于 AsyncIterable：

```typescript
// src/core/ai.ts
export async function* chatStream(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
): AsyncGenerator<string, void, unknown> {
  logger.debug(`AI 流式请求: model=${model}, messages=${messages.length} 条`)

  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
  })

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content
    if (content) {
      yield content
    }
  }
}
```

`chatStream` 用 `async function*` 声明为异步生成器。每次 `yield` 一个文本片段，调用方通过 `for await...of` 消费。这种设计把"如何获取数据"和"如何使用数据"解耦——调用方可以打印到终端，也可以写入文件，也可以做进一步处理。

注意流式响应中的字段名变化：非流式是 `message.content`，流式是 `delta.content`。`delta` 表示增量——每个 chunk 只包含新生成的那部分文本。

### 流式输出到终端

`streamToStdout` 是最常见的流式消费方式——把 AI 输出实时打印到终端：

```typescript
// src/core/ai.ts
export async function streamToStdout(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
): Promise<string> {
  let fullContent = ''
  for await (const chunk of chatStream(client, model, messages)) {
    process.stdout.write(chunk)
    fullContent += chunk
  }
  process.stdout.write('\n')
  return fullContent
}
```

用 `process.stdout.write` 而不是 `console.log`，因为 `console.log` 每次调用都会追加换行。`process.stdout.write` 精确控制输出的每一个字符。

返回值 `fullContent` 是完整的响应文本。即使是流式输出，很多场景下仍然需要完整文本——比如写入文件、做后处理。

### 何时用流式、何时用非流式

判断标准很简单：

- **结果直接展示给用户**——用流式。`repox explain`、`repox review` 的输出直接打印到终端，流式让等待感消失。
- **结果需要后处理**——用非流式。`repox commit` 生成的 message 要展示给用户确认，需要完整文本做后续交互。
- **结果写入文件**——皆可。如果文件内容较长，可以用流式边生成边写入，减少内存占用。

repox 的命令默认使用流式，通过 `--no-stream` 选项切换到非流式：

```typescript
// src/commands/review.ts
if (options.stream) {
  logger.title('Code Review')
  await streamToStdout(client, config.ai.model, messages)
} else {
  const spinner = ora('AI 正在审查代码...').start()
  const result = await chat(client, config.ai.model, messages)
  spinner.stop()
  logger.title('Code Review')
  logger.plain(result)
}
```

非流式模式配合 `ora` spinner 给用户一个"正在处理"的视觉反馈。流式模式不需要 spinner——文本本身就是进度指示。

## 8.5 Prompt 工程在 CLI 场景的最佳实践

CLI 场景的 prompt 设计和对话式 AI 有本质差异。对话式 AI 的 prompt 需要应对开放性问题，而 CLI 的 prompt 目标明确、输入结构化、输出格式固定。

### 系统提示词设计

好的系统提示词有三个要素：角色定位、任务规则、输出格式。

以 `repox commit` 的系统提示词为例：

```typescript
// src/commands/commit.ts
const messages = [
  {
    role: 'system' as const,
    content: `你是一个 Git commit message 生成专家。根据用户提供的 git diff，生成一条规范的 commit message。
要求：
- 使用 Conventional Commits 格式：<type>(<scope>): <description>
- type 从以下选择：feat, fix, docs, style, refactor, perf, test, chore
- scope 是可选的，表示影响范围
- description 用英文，首字母小写，不加句号
- 如果变更较复杂，可以加 body 说明（空一行后写）
- 只输出 commit message，不要其他解释文字`,
  },
  // ...
]
```

拆解这段提示词：

- **角色定位**："Git commit message 生成专家"——简短直接，告诉模型它扮演的角色
- **任务规则**：Conventional Commits 格式、type 枚举、大小写规范——具体、无歧义
- **输出约束**："只输出 commit message，不要其他解释文字"——这一条至关重要。没有这个约束，模型倾向于输出"以下是为您生成的 commit message："这类前缀，增加后处理的复杂度

### 上下文控制

CLI 工具的优势在于能自动构建精确的上下文。不需要用户复制粘贴代码——工具直接读取 git diff、文件内容、项目配置。

```typescript
// src/commands/commit.ts
{
  role: 'user' as const,
  content: `变更文件: ${stagedFiles.join(', ')}\n\nDiff:\n${truncatedDiff}`,
}
```

user message 的结构也有讲究：先列出变更文件名（让模型快速了解变更范围），再附上完整 diff。这种"摘要 + 详情"的结构比直接扔一大段 diff 效果更好。

### 严格输出格式

CLI 的 AI 输出经常需要程序化处理（比如 commit message 要传给 `git commit -m`）。模型输出如果包含额外文字，就需要额外的解析逻辑。

几种控制输出格式的技巧：

1. **明确禁止多余内容**："只输出 X，不要其他解释"
2. **给出格式模板**：`<type>(<scope>): <description>`
3. **用 JSON 约束**：要求输出 JSON 格式，`JSON.parse` 即可提取

对于 `repox commit`，第 1 种就够了。如果需要结构化输出（比如 code review 的多个问题分类），可以要求 JSON：

```typescript
const systemPrompt = `输出格式为 JSON:
{
  "summary": "总体评价",
  "issues": [
    { "severity": "critical|warning|info", "file": "文件名", "line": 42, "message": "问题描述" }
  ]
}
不要输出其他内容。`
```

### Prompt 的迭代：从"能用"到"好用"

好的 prompt 不是一次写成的。以 `repox commit` 为例，看看 prompt 是如何迭代的：

**初版**：
```
根据以下 git diff 生成 commit message。
```
问题：AI 输出不稳定，有时给一段话，有时给一个词，格式五花八门。

**第二版**——加格式约束：
```
根据以下 git diff 生成 commit message。
使用 Conventional Commits 格式：<type>(<scope>): <description>
```
问题：AI 开始生成合规的 message，但经常过度解读，把一行 typo 修复描述成"重构核心认证模块"。

**第三版**——加行为约束：
```
你是 Git commit message 生成专家。根据 diff 生成一条规范的 commit message。
要求：
- Conventional Commits 格式
- type 从 feat/fix/docs/style/refactor/perf/test/chore 中选择
- description 用英文，首字母小写，不加句号
- 只输出 commit message，不要解释
```
这版已经能用了。关键改进是 **"只输出 commit message，不要解释"** 这句——没有它，AI 会在 message 前后加一大段说明文字，导致解析困难。

`repox review` 的 prompt 也经历了类似的迭代。最初 AI 会输出一大段散文式的评论，加了 "按严重程度分类：🔴 严重 / 🟡 建议 / 🟢 亮点" 的格式约束后，输出才变得结构化、可扫描。

总结几条 CLI 场景下的 prompt 原则：

1. **明确输出格式**——CLI 工具往往需要解析 AI 的输出，自由格式 = 解析噩梦
2. **"只输出 X，不要 Y"**——AI 默认会加解释和上下文，CLI 场景下这些是噪音
3. **给 few-shot 示例**——如果格式复杂，直接在 prompt 里给一个输出示例比描述规则更有效
4. **控制输出长度**——code review 如果不限制，AI 可能输出 3000 字。加一句"每个问题用 1-2 句话描述"能有效控制

## 8.6 成本控制

调用大模型不是免费的。一个不小心就会因为 token 用量过大产生意外开支。CLI 工具需要在设计层面控制成本。

### Token 计数与预算

大模型按 token 计费，输入和输出分别计算。一个粗略的估算：英文 1 token 约等于 4 个字符，中文 1 token 约等于 1.5 个字符。

repox 不做精确的 token 计数（需要 tiktoken 等库，增加依赖），而是用字符数做粗略限制：

```typescript
// src/commands/commit.ts
const maxDiffLength = 8000
const truncatedDiff = diff.length > maxDiffLength
  ? diff.slice(0, maxDiffLength) + '\n\n... (diff 过长，已截断)'
  : diff
```

8000 字符的 diff 大约对应 2000-4000 token。加上系统提示词和文件列表，单次请求的输入 token 控制在 5000 以内。

`repox review` 的截断阈值更大（12000 字符），因为 code review 需要更多上下文才能给出有价值的建议。

### Diff 截断策略

简单的 `slice` 截断可能会在代码中间断开，导致模型看到不完整的代码块。更好的做法是按文件分割，优先保留重要文件：

```typescript
function truncateDiff(diff: string, maxLength: number): string {
  if (diff.length <= maxLength) return diff

  // 按文件分割 diff
  const fileDiffs = diff.split(/^diff --git/m).filter(Boolean)

  let result = ''
  let remaining = maxLength

  for (const fileDiff of fileDiffs) {
    const chunk = 'diff --git' + fileDiff
    if (chunk.length <= remaining) {
      result += chunk
      remaining -= chunk.length
    } else {
      result += `\n\n... (${fileDiffs.length - result.split('diff --git').length + 1} 个文件的 diff 已省略)`
      break
    }
  }

  return result
}
```

这样截断后每个文件的 diff 是完整的，模型能理解完整的代码上下文。

### 模型降级

不是所有任务都需要最强的模型。commit message 生成是相对简单的任务，用轻量模型（如 GPT-4o-mini 或豆包 lite）就够了；code review 需要深度理解代码，适合用强模型。

repox 目前用统一的 `config.ai.model` 配置。一个进阶做法是按命令指定模型：

```typescript
// 概念性示例
const MODEL_MAP = {
  commit: 'doubao-lite-128k',    // 轻量模型，生成 commit message 足够
  explain: 'doubao-1-5-pro-32k-250115', // 标准模型，代码解读
  review: 'doubao-1-5-pro-32k-250115',  // 标准模型，code review 需要深度理解
}
```

用户也可以通过 `--model` 参数临时指定模型，覆盖默认选择。

## 8.7 实战：repox explain

`repox explain <file>` 读取指定文件，调用 AI 生成代码解读。完整实现在 `src/commands/explain.ts`。

命令注册和参数定义：

```typescript
// src/commands/explain.ts
program
  .command('explain <file>')
  .description('AI 解读指定文件的代码')
  .option('--no-stream', '关闭流式输出')
  .option('-l, --language <lang>', '输出语言', 'zh')
```

`<file>` 是必选参数（尖括号表示必选），`--no-stream` 和 `-l` 是可选项。

前置校验——文件是否存在、是否过大：

```typescript
// src/commands/explain.ts
const filePath = path.resolve(file)

if (!fs.existsSync(filePath)) {
  throw new UserError(`文件不存在: ${filePath}`)
}

const stat = fs.statSync(filePath)
if (stat.size > 100 * 1024) {
  throw new UserError('文件过大（超过 100KB），请指定一个更小的文件')
}
```

100KB 的限制是成本考虑。一个 100KB 的源文件大约 25000 token，加上系统提示词和输出，单次请求可能消耗 50000+ token。对于更大的文件，建议用户拆分或指定要解读的函数。

Prompt 构造：

```typescript
// src/commands/explain.ts
const messages = [
  {
    role: 'system' as const,
    content: `你是一个资深的代码审查专家。用户会给你一段代码，请你解读这段代码的功能、设计思路和关键实现细节。${langInstruction}
要求：
- 先用一句话总结这段代码的核心作用
- 再逐段分析关键逻辑
- 指出值得关注的设计模式或技巧
- 如果有潜在问题或改进空间，也一并指出
保持简洁，不要重复代码。`,
  },
  {
    role: 'user' as const,
    content: `请解读以下代码：\n\n文件: ${file}\n\n\`\`\`${ext.replace('.', '')}\n${content}\n\`\`\``,
  },
]
```

user message 中包含文件名和语言标记（从扩展名推导）。文件名帮助模型理解文件在项目中的角色（比如 `api-client.ts` 显然是 HTTP 客户端），语言标记帮助模型正确识别代码语法。

实际运行效果：

```bash
$ repox explain src/core/api-client.ts

代码解读: src/core/api-client.ts

这是一个基于中间件模式的 HTTP 客户端，支持认证注入、自动重试和请求日志。

核心设计采用了中间件链（Middleware Chain）模式。Middleware 类型定义了
(url, options, next) => Promise<Response> 的签名，每个中间件可以在
调用 next 前后插入自定义逻辑...
```

## 8.8 实战：repox commit

`repox commit` 是 repox 使用频率最高的 AI 命令。它的流程是：读取暂存区 → 调用 AI 生成 commit message → 用户确认 → 执行 git commit。

完整代码在 `src/commands/commit.ts`，这里拆解关键流程。

**第一步：检查暂存区。** 没有 staged 文件就直接报错。这一步通过 `git diff --cached --name-only` 实现：

```typescript
// src/commands/commit.ts
const stagedFiles = getStagedFiles()
if (stagedFiles.length === 0) {
  throw new UserError(
    '暂存区没有文件',
    '请先使用 git add 添加要提交的文件',
  )
}
```

**第二步：获取 diff 并截断。**

```typescript
// src/commands/commit.ts
const diff = getStagedDiff()
const maxDiffLength = 8000
const truncatedDiff = diff.length > maxDiffLength
  ? diff.slice(0, maxDiffLength) + '\n\n... (diff 过长，已截断)'
  : diff
```

**第三步：调用 AI。** commit message 生成用非流式调用，因为结果需要后续交互（确认 / 编辑）。等待期间用 `ora` 显示 spinner：

```typescript
// src/commands/commit.ts
const spinner = ora('AI 正在分析变更...').start()
const commitMessage = await chat(client, config.ai.model, messages)
spinner.stop()
```

**第四步：用户确认。** 展示生成的 message，用 `@inquirer/prompts` 的 `confirm` 和 `input` 组件让用户确认或编辑：

```typescript
// src/commands/commit.ts
const action = await confirm({
  message: '使用这条 commit message 提交？',
  default: true,
})

if (!action) {
  const edited = await input({
    message: '输入你的 commit message（留空取消）',
    default: commitMessage,
  })
  if (!edited) {
    logger.info('已取消')
    return
  }
  finalMessage = edited
}
```

这个交互设计体现了 AI 辅助的正确姿态：AI 生成建议，人类做最终决策。`--yes` 选项可以跳过确认，适合自动化场景，但默认行为始终是让用户确认。

**第五步：执行 commit。**

```typescript
// src/commands/commit.ts
createCommit(finalMessage)
logger.success('提交成功')
```

`createCommit` 封装了 `git commit -m`（见 `src/utils/git.ts`）。

### --dry-run 模式

`--dry-run` 只生成 message 不提交——方便调试 prompt 效果：

```bash
$ repox commit --dry-run
暂存区有 3 个文件待提交:
  + src/core/api-client.ts
  + src/core/error.ts
  + src/commands/deps.ts

生成的 commit message:

  feat(core): add middleware-based API client with retry and auth support

(dry-run 模式，不会执行 commit)
```

这是 CLI 工具设计的一个通用原则：任何有副作用的命令（写文件、执行 git 操作、调用外部 API）都应该提供 dry-run 选项。

## 8.9 流式输出的终端兼容性

流式输出在大多数终端下工作正常，但有几个边缘情况需要注意：

**管道场景。** 当 CLI 的 stdout 被重定向到文件或管道时，流式的逐字输出没有意义（用户看不到）。可以检测 stdout 是否是 TTY 来决定是否使用流式：

```typescript
const useStream = options.stream && process.stdout.isTTY
```

`process.stdout.isTTY` 在终端直接运行时为 `true`，在管道或重定向时为 `undefined`。

**Markdown 渲染。** AI 输出的文本经常包含 Markdown 格式。在终端中直接打印 Markdown 可读性尚可，但如果想要更好的排版（加粗、代码块高亮），可以用 `marked` + `marked-terminal` 做终端 Markdown 渲染。不过这会增加依赖——repox 暂时选择原样输出。

**中断处理。** 用户在流式输出过程中按 Ctrl+C，需要优雅处理。OpenAI SDK 在连接断开时会抛出异常，需要在 `for await` 循环外层 catch：

```typescript
try {
  for await (const chunk of chatStream(client, model, messages)) {
    process.stdout.write(chunk)
  }
} catch (error) {
  if (error.name === 'AbortError') {
    process.stdout.write('\n')
    // 用户中断，静默退出
    return
  }
  throw error
}
```

## 8.10 小结

本章建立了 CLI 接入大模型的基础能力：

- **统一抽象**：一个 OpenAI SDK 客户端 + 可配置的 baseURL，覆盖所有兼容 OpenAI 协议的模型服务
- **双模式调用**：非流式适合需要后处理的场景，流式适合直接展示给用户
- **Prompt 设计**：角色定位 + 任务规则 + 输出约束，三要素缺一不可
- **成本控制**：diff 截断、模型降级、避免不必要的大上下文
- **repox explain** 和 **repox commit** 展示了"读取本地上下文 → 构造 prompt → 调用 AI → 处理输出"的完整模式

这些是单次调用的能力。下一章进入 Agent 模式——AI 不再是被动回答问题，而是主动驱动多步操作。

## 动手试一试

1. 修改 `repox explain` 的 prompt，加入 few-shot 示例：在 system prompt 中给出一段示例代码和对应的解读模板，观察 AI 输出是否更稳定
2. 给 `repox commit` 添加 `--lang` 选项：`--lang zh` 时 commit message 用中文，`--lang en` 时用英文。思考一下 prompt 怎么改
3. 实现 token 消耗统计：在每次 AI 调用后，从 response 中提取 `usage.prompt_tokens` 和 `usage.completion_tokens`，打印消耗量。估算一下执行一次 `repox review` 大概花多少钱（doubao-pro 约 ¥0.0008/千 token）
