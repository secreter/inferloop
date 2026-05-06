# 第 4 章 输出的艺术

CLI 工具的产出就是终端上的文字。输出设计得好，用户一眼就能抓住关键信息；设计得烂，满屏文字反而制造噪音。这一章拆解终端输出的方方面面——颜色语义、结构化格式、多格式适配、日志分级，以及为后续 AI 功能铺垫的流式输出。

## 4.1 终端输出不是 console.log

写前端的人习惯了 Chrome DevTools。`console.log` 能输出对象、能折叠展开、能按级别过滤、甚至能直接看到 DOM 结构。但终端不是浏览器——它只有一条纵向滚动的文本流。

这个差异带来几个实际问题：

**没有结构化展示能力。** 浏览器里 `console.log({ a: 1 })` 会渲染成可交互的树形结构，终端里它只是一行 `[Object object]` 或者一坨 JSON 字符串。想让数据可读，必须自己格式化。

**没有过滤器。** DevTools 可以按 log/warn/error 过滤，终端不行。所有输出混在一起，时间线就是唯一的组织维度。如果一个命令既输出正常结果又输出调试信息，用户会被淹没。

**输出即最终产物。** 前端的 `console.log` 是调试手段，不会出现在生产环境。CLI 的输出就是产品本身——它是用户看到的全部界面。

**stdout 和 stderr 是两条流。** 这是终端的独特机制，Web 端没有对应物。正常输出走 stdout（`console.log`），错误和诊断信息走 stderr（`console.error`）。为什么要分开？因为 Unix 管道只连接 stdout：

```bash
# 正常数据通过管道传给 jq，错误信息仍然显示在终端
repox scan --format json 2>/dev/null | jq '.name'
```

如果把错误信息也写到 stdout，管道下游收到的就是混有错误文本的脏数据。所以有一条硬规则：**可被程序消费的数据走 stdout，给人看的诊断信息走 stderr。**

## 4.2 语义化颜色体系

颜色不是装饰，是信息编码。人类对颜色的反应速度远快于阅读文字——看到红色就知道出错了，看到绿色就知道成功了。建立一套一致的颜色语义，用户在使用工具时的认知负担会大幅降低。

repox 使用 chalk 库实现终端着色。chalk 的优点是 API 干净、支持颜色嵌套、能自动检测终端是否支持颜色。

```typescript
import chalk from 'chalk'

// 基础用法
chalk.red('错误信息')
chalk.bold.yellow('警告')
chalk.green.underline('链接')

// 嵌套
chalk.red(`文件 ${chalk.bold('config.json')} 不存在`)
```

repox 定义的颜色语义：

| 语义 | 颜色 | 图标 | 用途 |
|------|------|------|------|
| 错误 | 红色 | ✖ | 致命错误，必须处理 |
| 警告 | 黄色 | ⚠ | 非致命问题，可继续执行 |
| 成功 | 绿色 | ✔ | 操作完成确认 |
| 信息 | 蓝色 | ℹ | 一般提示 |
| 详情 | 灰色 | ▸ | verbose 模式下的额外信息 |
| 调试 | 品红 | 🔍 | debug 模式下的诊断数据 |

对应的 logger 实现：

```typescript
// src/core/logger.ts
export const logger = {
  info(message: string): void {
    if (shouldLog('normal')) {
      console.log(chalk.blue('ℹ'), message)
    }
  },

  success(message: string): void {
    if (shouldLog('normal')) {
      console.log(chalk.green('✔'), message)
    }
  },

  warn(message: string): void {
    if (shouldLog('normal')) {
      console.error(chalk.yellow('⚠'), message)
    }
  },

  error(message: string): void {
    // 错误始终输出
    console.error(chalk.red('✖'), message)
  },

  verbose(message: string): void {
    if (shouldLog('verbose')) {
      console.log(chalk.gray('▸'), chalk.gray(message))
    }
  },

  debug(message: string): void {
    if (shouldLog('debug')) {
      console.log(chalk.magenta('🔍'), chalk.gray(message))
    }
  },
}
```

注意几个设计决策：

1. **error 始终输出**——不受 quiet 模式影响。错误不应该被静默掉，如果用户看不到错误，他只会觉得工具"不工作"而不知道为什么。
2. **warn 走 stderr**——`console.error` 并不意味着"只能输出错误"，它的语义是"输出到 stderr"。警告是诊断信息，不应该污染 stdout。
3. **图标 + 颜色双重编码**——有些终端不支持颜色（比如管道场景下 chalk 会自动禁用颜色），图标提供了无颜色时的备用语义。
4. **文字本身不着色**——只有图标和辅助文字着色，正文保持默认色。过度着色比不着色更糟糕——满屏彩虹让人什么都看不清。

还有一个容易忽视的点：**颜色检测**。chalk v5 默认会检测 stdout 是否指向终端（TTY）。如果输出被管道到文件或其他程序，颜色会自动禁用。这很关键——没人想在日志文件里看到一堆 `\x1b[31m` 转义序列。如果需要强制控制颜色行为：

```bash
# 强制启用颜色（在管道场景下保留颜色）
FORCE_COLOR=1 repox scan | less -R

# 强制禁用颜色
NO_COLOR=1 repox scan
```

`NO_COLOR` 是一个社区标准（https://no-color.org/），很多终端工具都遵守。chalk 原生支持这个环境变量。

## 4.3 结构化输出

纯文本够用但不够好。当数据有明确结构时——键值对、列表、层级关系——用对应的视觉形式呈现会更清晰。

### 表格输出

表格适合展示多行多列的同构数据。repox 用 cli-table3 库渲染表格：

```typescript
import Table from 'cli-table3'

// 键值对表格（无表头，两列）
const table = new Table({
  style: { head: ['cyan'], border: ['gray'] },
})
table.push(
  [chalk.bold('项目名称'), 'repox'],
  [chalk.bold('编程语言'), 'TypeScript'],
  [chalk.bold('包管理器'), 'npm'],
)
console.log(table.toString())
```

输出效果：

```
┌──────────┬────────────┐
│ 项目名称 │ repox      │
├──────────┼────────────┤
│ 编程语言 │ TypeScript │
├──────────┼────────────┤
│ 包管理器 │ npm        │
└──────────┴────────────┘
```

cli-table3 相比早期的 cli-table 有两个重要改进：支持中文字符宽度计算（中文字符占两个字符宽），以及支持单元格合并。

### 树形输出

树形结构适合展示层级关系——文件目录、依赖树、配置结构等。repox 手写了一个简单的树形渲染函数：

```typescript
export interface TreeNode {
  label: string
  children?: TreeNode[]
}

export function formatTree(
  node: TreeNode,
  prefix = '',
  isLast = true,
): string {
  const connector = isLast ? '└── ' : '├── '
  const extension = isLast ? '    ' : '│   '
  let result = prefix + connector + node.label + '\n'

  if (node.children) {
    node.children.forEach((child, index) => {
      const childIsLast = index === node.children!.length - 1
      result += formatTree(child, prefix + extension, childIsLast)
    })
  }

  return result
}
```

这个函数用四个 Unicode 字符画出树形线条：`└──`（最后一个子节点）、`├──`（中间子节点）、`│  `（纵向连接线）、`   `（空白对齐）。

调用示例：

```typescript
const tree: TreeNode = {
  label: '文件类型分布',
  children: [
    { label: '.ts (24 个文件)' },
    { label: '.json (5 个文件)' },
    { label: '.md (3 个文件)' },
    { label: '.yml (2 个文件)' },
  ],
}
console.log(formatTree(tree))
```

输出：

```
└── 文件类型分布
    ├── .ts (24 个文件)
    ├── .json (5 个文件)
    ├── .md (3 个文件)
    └── .yml (2 个文件)
```

为什么不用现成的树形库？因为需求太简单了。CLI 工具开发有一个原则：**能用 50 行代码解决的问题不引入一个依赖**。`formatTree` 函数加上类型定义总共不到 20 行，没必要为此引入 `treeify` 或者 `archy`。

### JSON 输出

JSON 是最不需要设计的格式——`JSON.stringify(data, null, 2)` 就完事了。但 JSON 输出的意义不在于美观，在于可编程。详见下一节。

## 4.4 --format 多格式输出

一个命令输出什么格式，不应该由开发者决定，应该由使用场景决定。人坐在终端前，想看漂亮的表格；脚本里调用 CLI，想拿到 JSON 做后续处理；简单场景下，制表符分隔的纯文本方便用 awk/grep 处理。

repox 的做法是提供 `--format` 参数，支持三种格式：

```bash
# 人看的（默认）
repox scan

# 机器消费的
repox scan --format json

# 简单场景
repox scan --format plain
```

格式化函数的实现是一个简单的 switch 分发：

```typescript
export type OutputFormat = 'table' | 'json' | 'plain'

export function formatKeyValue(
  data: Record<string, unknown>,
  format: OutputFormat = 'table',
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2)

    case 'plain':
      return Object.entries(data)
        .map(([key, value]) => `${key}: ${formatValue(value)}`)
        .join('\n')

    case 'table': {
      const table = new Table({
        style: { head: ['cyan'], border: ['gray'] },
      })
      for (const [key, value] of Object.entries(data)) {
        table.push([chalk.bold(key), formatValue(value)])
      }
      return table.toString()
    }
  }
}
```

这个设计的关键约束：**JSON 格式下不应该有任何非 JSON 内容输出到 stdout**。否则 `repox scan --format json | jq '.'` 会报 parse error。具体来说：

- 标题、分隔线、空行这些装饰性输出，在 JSON 模式下应全部跳过
- 只输出一个合法的 JSON 对象或数组

repox scan 命令里的处理方式：

```typescript
.action((options) => {
  const format = options.format as OutputFormat
  const result = scanProject(options.path)

  if (format === 'json') {
    // JSON 模式：只输出纯 JSON，不加任何修饰
    logger.plain(JSON.stringify(result, null, 2))
    return
  }

  // 非 JSON 模式：加标题、分区显示
  logger.title(`项目画像: ${result.name}`)
  logger.plain(formatKeyValue(basicInfo, format))
  // ...
})
```

关于管道场景的进阶思考：Unix 哲学鼓励"做一件事并做好，通过管道组合"。一个设计良好的 CLI 在管道链中应该是一个好公民：

```bash
# 获取所有依赖数大于 10 的项目
find ~/projects -maxdepth 1 -type d | while read dir; do
  repox scan --path "$dir" --format json 2>/dev/null
done | jq -s '.[] | select(.dependencies > 10) | .name'
```

如果 `--format json` 的输出混入了颜色代码或标题文字，这条管道链就会断掉。

## 4.5 日志分级

开发者调试时想看所有细节，普通用户只想看结果，CI 环境只关心有没有报错。同一个命令在不同场景下需要不同的输出详细度。

repox 设计了四档日志级别：

```typescript
export type LogLevel = 'quiet' | 'normal' | 'verbose' | 'debug'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  quiet: 0,
  normal: 1,
  verbose: 2,
  debug: 3,
}

let currentLevel: LogLevel = 'normal'

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[currentLevel] >= LEVEL_PRIORITY[level]
}
```

这是一个递进包含的模型：debug 包含 verbose，verbose 包含 normal，normal 包含 quiet。设置为某个级别，就能看到该级别及以下所有输出。

对应的 CLI 全局选项：

```typescript
program
  .option('--verbose', '输出详细日志')
  .option('--debug', '输出调试日志')
  .option('--quiet', '静默模式，只输出必要信息')

program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts()
  if (opts.debug) {
    setLogLevel('debug')
  } else if (opts.verbose) {
    setLogLevel('verbose')
  } else if (opts.quiet) {
    setLogLevel('quiet')
  }
})
```

每一档的定位：

| 级别 | 标志 | 适合场景 | 输出内容 |
|------|------|----------|----------|
| quiet | `--quiet` | CI/脚本 | 只有错误和最终结果 |
| normal | (默认) | 日常使用 | 结果 + 状态提示 |
| verbose | `--verbose` | 排查问题 | 每一步的操作细节 |
| debug | `--debug` | 开发调试 | 内部变量值、API 请求/响应 |

一个好的经验法则：如果用户反馈"没有任何输出就退出了"，说明你的 normal 级别信息不够；如果用户反馈"输出太多看不到重点"，说明你把该放 verbose 的信息放到了 normal。

还有一个设计点：`--quiet` 和 `--format json` 的关系。实践中这两者经常同时使用——脚本想静默获取 JSON 数据。repox 的处理是 quiet 模式下 `logger.plain()` 仍然输出（因为那是结果数据），但 `logger.info()`、`logger.success()` 等状态信息被静默。

## 4.6 流式输出基础

传统的 CLI 输出模式是"计算完毕后一次性打印结果"。但在 AI 时代，大语言模型的响应是流式的——token 一个一个蹦出来，等全部生成完可能要几十秒。如果让用户盯着空白屏幕等 30 秒，体验极差。

流式输出的核心 API 是 `process.stdout.write()`——它不会自动换行，可以连续写入，实现"逐字打印"效果：

```typescript
async function streamPrint(text: string, speed = 30): Promise<void> {
  for (const char of text) {
    process.stdout.write(char)
    await new Promise(resolve => setTimeout(resolve, speed))
  }
  process.stdout.write('\n')
}
```

不过实际的 AI 流式输出不是逐字符模拟打字，而是处理 SSE（Server-Sent Events）流。基本模式：

```typescript
async function streamAIResponse(prompt: string): Promise<void> {
  const response = await fetch('https://api.example.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'some-model',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n').filter(line => line.startsWith('data: '))

    for (const line of lines) {
      const data = line.slice(6) // 去掉 "data: " 前缀
      if (data === '[DONE]') return

      const parsed = JSON.parse(data)
      const content = parsed.choices?.[0]?.delta?.content
      if (content) {
        process.stdout.write(content)
      }
    }
  }

  process.stdout.write('\n')
}
```

这里有几个终端特有的问题需要处理：

**光标管理。** 流式输出时如果用户按 Ctrl+C 中断，光标可能停在行中间。需要注册 SIGINT 处理器确保光标归位：

```typescript
process.on('SIGINT', () => {
  process.stdout.write('\n')
  process.exit(130)
})
```

**行缓冲 vs 无缓冲。** 默认情况下 `process.stdout.write()` 在 TTY 模式下是无缓冲的（每次调用立即刷新），但在管道模式下可能是行缓冲的。对于流式输出，这意味着管道场景下用户可能看不到实时更新。

**ANSI 转义序列。** 如果流式输出中需要覆盖已有内容（比如更新进度百分比），需要用 ANSI 转义码：

```typescript
// \r 回到行首，覆盖当前行
process.stdout.write(`\r生成中... ${progress}%`)

// \x1b[2K 清除当前行
process.stdout.write('\x1b[2K\r')
```

## 4.7 案例拆解：Claude Code 的流式输出

Claude Code 是 Anthropic 官方的 CLI 工具，它的流式输出设计值得研究。核心思路是 **StreamingText** 模式——将 AI 的流式响应实时渲染到终端，同时处理 Markdown 格式化。

关键设计点：

**分块处理而非逐字符。** LLM 的 SSE 流每次推送的不是单个字符，而是一个 token（可能是几个字符或一个词）。Claude Code 的策略是收到一个 chunk 就立即写出，不做额外缓冲：

```typescript
// 伪代码：描述 Claude Code 的流式输出思路
class StreamingRenderer {
  private buffer = ''

  onChunk(text: string): void {
    this.buffer += text
    // 直接写出收到的内容
    process.stdout.write(text)
  }

  onComplete(): void {
    process.stdout.write('\n')
    // 最终可以对完整文本做格式化后处理
  }
}
```

**终端宽度自适应。** Claude Code 会检测终端宽度，对长行做自动换行处理。这在流式场景下比较棘手——你不知道当前行还会不会继续变长。Claude Code 的做法是让终端自己处理换行（终端会在到达宽度上限时自动折行），不主动插入 `\n`。

**代码块的特殊处理。** 当 AI 输出包含代码块（`` ```typescript ... ``` ``）时，Claude Code 会切换到不同的渲染模式——添加背景色或边框，并对代码做语法高亮。这是在流式过程中完成的，需要维护一个简单的状态机来追踪当前是否在代码块内。

**思考过程的折叠。** Claude Code 支持"extended thinking"，会先输出推理过程再输出最终回答。推理过程用灰色折叠显示，最终回答用正常样式。这是通过 ANSI 转义序列实现的——用暗灰色渲染思考内容，到最终回答时切回正常颜色。

这些技巧在第 9 章实现 `repox explain` 和 `repox commit` 的 AI 功能时会用到。这里先建立基础认知：流式输出不是玩具效果，而是 AI CLI 工具的刚需。

## 4.8 实战：repox scan 的多格式输出

把前面所有概念串起来，看 `repox scan` 命令的完整实现。这个命令扫描项目目录，生成包含技术栈、依赖、Git 状态、文件统计的项目画像，并支持 table/json/plain 三种输出格式。

先看 scan 命令的注册和参数定义：

```typescript
// src/commands/scan.ts
import { Command } from 'commander'
import chalk from 'chalk'
import { scanProject } from '../core/scanner.js'
import { logger } from '../core/logger.js'
import { formatKeyValue, formatTree, extensionStatsToTree } from '../utils/format.js'
import type { OutputFormat } from '../utils/format.js'

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('扫描仓库，生成项目画像')
    .option('-f, --format <format>', '输出格式: table / json / plain', 'table')
    .option('--path <path>', '指定扫描目录', process.cwd())
    .action((options) => {
      const format = options.format as OutputFormat
      const result = scanProject(options.path)

      // JSON 模式：纯数据输出，不加任何装饰
      if (format === 'json') {
        logger.plain(JSON.stringify(result, null, 2))
        return
      }

      // 非 JSON 模式：带标题和分区
      logger.title(`项目画像: ${result.name}`)

      // 基本信息区
      const basicInfo: Record<string, unknown> = {
        '项目名称': result.name,
        '项目路径': result.root,
        '包管理器': result.packageManager,
        '编程语言': result.language,
        '框架': result.frameworks.length > 0 ? result.frameworks : '(未检测到)',
        'TypeScript': result.hasTypeScript,
        '测试框架': result.hasTests,
        'Lint 配置': result.hasLint,
        'CI/CD': result.hasCi,
        '生产依赖': result.dependencies,
        '开发依赖': result.devDependencies,
      }

      logger.plain(formatKeyValue(basicInfo, format))

      // Git 信息区
      if (result.git) {
        logger.newline()
        logger.plain(chalk.bold('Git 信息'))
        const gitInfo: Record<string, unknown> = {
          '当前分支': result.git.branch,
          '远程地址': result.git.remote || '(无)',
          '总提交数': result.git.totalCommits,
          '最近提交': result.git.lastCommit,
          '工作区状态': result.git.isDirty
            ? chalk.yellow('有未提交变更')
            : chalk.green('干净'),
          '未追踪文件': result.git.untracked,
        }
        logger.plain(formatKeyValue(gitInfo, format))
      }

      // 文件统计区（树形）
      logger.newline()
      logger.plain(chalk.bold(`文件统计: ${result.fileStats.totalFiles} 个文件`))
      const tree = extensionStatsToTree(result.fileStats.byExtension)
      logger.plain(formatTree(tree))
    })
}
```

几个值得展开的设计细节：

### JSON 的早期返回模式

```typescript
if (format === 'json') {
  logger.plain(JSON.stringify(result, null, 2))
  return
}
```

JSON 模式用 `return` 提前退出，而不是在每一段输出代码里都 `if (format !== 'json')`。这更简洁，也不容易遗漏——只要 JSON 分支返回了完整数据，后面的代码怎么改都不影响 JSON 输出的纯净性。

### 数据转换层

注意 `basicInfo` 对象——它不是 `scanProject()` 的原始返回值，而是一个面向展示的转换层。原始数据里 `frameworks` 是 `string[]`，展示时空数组要变成 `'(未检测到)'`；`isDirty` 是 `boolean`，展示时要变成带颜色的中文文案。

这种"数据 → 展示模型"的转换，和前端 React 组件里的 props 映射是同一个思路。把转换逻辑集中在命令层，而不是散落在 formatter 里，保持了 formatter 的通用性。

### extensionStatsToTree 的数据桥接

文件扩展名统计数据从 `Record<string, number>` 格式（如 `{ '.ts': 24, '.json': 5 }`）转成 `TreeNode` 格式，靠的是一个专门的桥接函数：

```typescript
export function extensionStatsToTree(stats: Record<string, number>): TreeNode {
  const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1])
  return {
    label: chalk.bold('文件类型分布'),
    children: sorted.slice(0, 15).map(([ext, count]) => ({
      label: `${ext} ${chalk.gray(`(${count} 个文件)`)}`,
    })),
  }
}
```

它做了两件事：按文件数降序排序（最重要的类型排前面），以及截取前 15 项（避免输出过长）。这种"聚合 + 截断 + 排序"的策略在 CLI 输出中很常见——用户不需要看到所有数据，只需要看到最有意义的部分。

### 三种格式的实际效果对比

运行 `repox scan` 在 repox 项目自身上的效果：

**table 格式（默认）：**

```
项目画像: repox
────────────────────────

┌──────────┬────────────────────────────────────┐
│ 项目名称 │ repox                              │
│ 项目路径 │ /Users/dev/projects/repox           │
│ 包管理器 │ npm                                │
│ 编程语言 │ TypeScript, JavaScript             │
│ 框架     │ (未检测到)                         │
│ TS       │ ✔                                  │
│ 测试框架 │ ✔                                  │
│ 生产依赖 │ 9                                  │
│ 开发依赖 │ 6                                  │
└──────────┴────────────────────────────────────┘

└── 文件类型分布
    ├── .ts (22 个文件)
    ├── .json (5 个文件)
    ├── .md (3 个文件)
    └── .yml (1 个文件)
```

**json 格式：**

```json
{
  "name": "repox",
  "root": "/Users/dev/projects/repox",
  "packageManager": "npm",
  "language": ["TypeScript", "JavaScript"],
  "frameworks": [],
  "hasTypeScript": true,
  "hasTests": true,
  "dependencies": 9,
  "devDependencies": 6,
  "fileStats": {
    "totalFiles": 31,
    "byExtension": { ".ts": 22, ".json": 5 }
  }
}
```

**plain 格式：**

```
项目名称: repox
项目路径: /Users/dev/projects/repox
包管理器: npm
编程语言: TypeScript, JavaScript
框架: (未检测到)
TypeScript: ✔
测试框架: ✔
生产依赖: 9
开发依赖: 6
```

三种格式面向三种场景：table 给人看，json 给程序消费，plain 给简单脚本用 `grep`/`awk` 处理。一套数据，三种视图。

### 格式化值的边界处理

`formatValue` 辅助函数处理了各种类型的显示：

```typescript
function formatValue(value: unknown): string {
  if (value === true) return chalk.green('✔')
  if (value === false) return chalk.red('✖')
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : chalk.gray('(无)')
  }
  if (value === null || value === undefined) return chalk.gray('(未设置)')
  return String(value)
}
```

布尔值用图标而非文字表示（比 `true`/`false` 更直观），空数组和 null 给出明确的占位提示而非留空。这些细节决定了输出的可读性。

## 提前规划：错误输出也是输出

日志模块解决了"正常信息怎么输出"的问题，但还有一类输出同样重要——错误信息。

前端工程师习惯了 `try/catch` + `console.error`，但 CLI 工具的错误输出有更高的要求：用户看到 `TypeError: Cannot read properties of undefined` 会直接关掉终端。好的 CLI 错误应该告诉用户**出了什么问题**和**怎么解决**。

repox 将错误分为三类：

```typescript
// src/core/error.ts
// 用户错误：参数不对、配置缺失，不需要 stack trace
export class UserError extends Error {
  constructor(message: string, public hint?: string) {
    super(message); this.name = 'UserError'
  }
}

// 网络错误：API 调用失败
export class NetworkError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message); this.name = 'NetworkError'
  }
}

// 退出码规范
export const ExitCode = { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, INTERRUPTED: 130 } as const
```

这套分类会在后续每个命令中使用。第 10 章会展开讲错误处理的完整策略，包括 debug 模式、信号处理和健康检查。现在只需要记住一个原则：**用户错误给提示，系统错误给退出码**。

## 小结

终端输出是 CLI 的用户界面。这一章覆盖了四个层面：

- **颜色语义**——用色彩编码信息类型，建立用户的肌肉记忆（红=错误、绿=成功、黄=警告）。但克制使用，不要把终端变成圣诞树。
- **结构化输出**——表格、树形、JSON，根据数据特点选择视觉形式。`formatKeyValue`、`formatTree`、`formatList` 三个函数覆盖了绝大多数场景。
- **多格式适配**——`--format` 参数让同一份数据服务于人（table）和机器（json）。JSON 模式下确保 stdout 的纯净。
- **日志分级**——`quiet < normal < verbose < debug` 四档，不同场景下自动调节信息密度。
- **流式输出**——`process.stdout.write()` 实现实时打印，为后续 AI 功能打基础。

一个好的输出系统，用户在默认模式下就能快速获取关键信息，遇到问题时 `--verbose` 能看到上下文，自动化场景下 `--format json --quiet` 能拿到干净数据。这三个场景都覆盖到了，输出系统就算合格。

## 动手试一试

1. 给 logger 添加一个 `box(title, content)` 方法，用 `─` `│` `┌` `┐` `└` `┘` 字符画一个方框来突出显示重要信息
2. 修改 `repox scan`，当使用 `--format json` 时，确保输出是纯 JSON（没有任何前缀图标或颜色码），可以直接通过 `| jq '.'` 解析
3. 实现一个简单的流式输出函数：接受一个字符串，以 30ms 间隔逐字打印到终端，模拟打字机效果
