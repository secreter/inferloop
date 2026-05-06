# 第 2 章：命令设计的艺术

## CLI 的 UX 设计原则

"CLI 不需要设计"——这大概是最常见的误解。事实上，CLI 的设计空间虽然比 GUI 小，但设计决策的密度更高。一个 GUI 按钮放错了位置，用户还能四处找找；一个 CLI 参数命名不当，用户根本猜不到它的存在。

核心观点：**命令行是 API 的另一种形态，参数就是接口契约**。

这不是比喻。HTTP API 有 endpoint（路径）、method（动词）、query parameters（查询参数）、request body（请求体）、response format（响应格式）。CLI 一一对应：

| HTTP API | CLI |
|---|---|
| `GET /repos/:id` | `repox scan <dir>` |
| Query: `?format=json` | Option: `--format json` |
| Header: `Authorization: Bearer xxx` | 环境变量: `REPOX_API_KEY=xxx` |
| Response: JSON | stdout: 文本或 JSON |
| Status Code: 200/404/500 | Exit Code: 0/1/2 |

既然是 API，就要遵循 API 设计的基本原则：

**1. 一致性**：相同的概念用相同的参数名。如果 `scan` 用 `--format` 指定输出格式，`review` 也应该用 `--format`，不要一个叫 `--format` 一个叫 `--output`。

**2. 可预测性**：用户基于已有经验能猜到参数名。`--verbose` 表示详细输出，`--quiet` 表示静默，`--dry-run` 表示试运行——这些是整个 CLI 生态的共识，不要发明新名字。

**3. 渐进式复杂度**：最常用的功能零配置可用，次常用的通过选项开启，高级功能通过配置文件控制。`repox scan` 开箱即用，`repox scan --format json` 满足进阶需求，`repox scan --config custom.json` 支持深度定制。

**4. 容错性**：用户会犯错，好的 CLI 会纠错。输入 `repox scna`，提示"你是不是要输入 scan？"。缺少必要参数，告诉用户缺什么、怎么补。

## 命令层级解析

一个 CLI 命令由以下元素组成：

```
repox scan ./src --format json --verbose
│      │    │     │             │
│      │    │     │             └── 标志 (Flag): 布尔开关
│      │    │     └── 选项 (Option): 键值对参数
│      │    └── 参数 (Argument): 位置参数
│      └── 子命令 (Subcommand)
└── 程序名 (Program)
```

### 参数 (Arguments)

位置参数，通过位置确定含义。适合表达命令的主要操作对象：

```bash
repox scan ./src          # ./src 是要扫描的目录
repox explain ./src/app.ts  # ./src/app.ts 是要解释的文件
git checkout main           # main 是要切换的分支
```

参数的数量要克制——超过 2 个位置参数就很难记忆了。`cp source dest` 两个参数，直觉上能理解。如果 `repox translate source dest lang format` 有四个位置参数，没人记得住顺序。

### 选项 (Options)

键值对形式，通过名称确定含义：

```bash
repox scan --format json      # 长选项
repox scan -f json            # 短选项（单字母缩写）
repox scan --format=json      # 等号写法
```

命名约定：
- 长选项用 `--kebab-case`：`--output-dir`、`--max-depth`
- 短选项用单字母：`-f`、`-o`、`-d`
- 不是每个长选项都需要短选项——只给最常用的命令配短选项

### 标志 (Flags)

布尔类型的选项，存在即为 true：

```bash
repox scan --verbose    # verbose = true
repox scan              # verbose = false（默认）
repox commit --dry-run  # 只预览不执行
```

### 子命令 (Subcommands)

当工具功能较多时，用子命令组织：

```bash
repox scan              # 一级子命令
repox config set key val  # 二级子命令（config → set）
```

子命令的层级不要超过两级。`git remote add origin url` 看起来是两级子命令（remote → add），实际上 `origin` 和 `url` 是参数。真正三级以上的嵌套（如 `repox config auth token set xxx`）会让用户迷失。

## 案例拆解：三个 CLI 的设计哲学

在选择 repox 的命令设计方案之前，值得研究几个标杆项目的做法。

### git：动词优先

```bash
git clone <url>
git add <file>
git commit -m "message"
git push origin main
git log --oneline --graph
```

git 的设计哲学是**动词优先**——每个子命令都是一个动作。`clone`、`add`、`commit`、`push`、`pull`，全是动词。这让命令读起来像自然语言："git add this file"、"git push to origin"。

git 的问题在于历史包袱太重。`git checkout` 既能切换分支又能恢复文件，职责不清。后来 git 引入了 `git switch`（切换分支）和 `git restore`（恢复文件）来解耦，但老的 `checkout` 仍然保留。这就是向后兼容的代价——即使设计有缺陷，一旦发布就很难移除。

git 的选项风格也不统一。`-m` 在 `commit` 中是 message，在 `branch` 中是 move（重命名）。这种不一致性源于各个子命令由不同的人在不同时期开发。repox 要避免这个问题。

### gh（GitHub CLI）：名词-动词结构

```bash
gh repo clone owner/repo
gh pr create --title "feat: add scan"
gh pr list --state open
gh issue view 42
gh release create v1.0.0
```

gh 的设计更系统化，采用**名词-动词**两级结构：先指定操作的资源（repo、pr、issue、release），再指定动作（create、list、view、delete）。

这个模式的优点是高度可预测。用户知道 `gh pr create` 和 `gh pr list`，就能猜到 `gh issue create` 和 `gh issue list`。资源和动作的组合是正交的。

gh 还有一个值得学习的设计：**交互式降级**。`gh pr create` 不带参数时会启动交互式向导，引导用户填写标题、描述、reviewer。带了参数就直接执行。这样新手通过交互学习，熟手通过参数提效，同一个命令覆盖两种使用场景。第 3 章会详细实现这个模式。

### Vercel CLI：隐式上下文

```bash
vercel                    # 部署当前目录
vercel dev                # 本地开发
vercel env pull .env.local  # 拉取环境变量
vercel domains add example.com
```

Vercel CLI 最大的特点是**隐式上下文**。直接执行 `vercel`（不带任何子命令）就能部署当前项目。它会自动检测框架（Next.js/Vite/Remix）、自动配置构建命令、自动分配域名。

这种设计适合工作流明确的场景——Vercel 的核心功能就是部署，让最常用的操作最简单。但它不适合 repox 这样的多功能工具，因为"最常用的操作"不明确。

### repox 的设计选择

综合以上分析，repox 采用 **git 风格的动词优先**设计，原因如下：

1. repox 的命令都是动作：scan（扫描）、explain（解释）、review（审查）、commit（提交）。动词比名词-动词结构更简洁。
2. 命令数量有限（不超过 10 个），不需要名词-动词的正交组合来管理复杂度。
3. 开发者对 git 的动词风格最熟悉，学习成本最低。

全局选项保持一致：
- `--verbose` / `-V`：详细输出（所有命令通用）
- `--format <format>` / `-f`：输出格式（所有有输出的命令通用）
- `--debug`：调试信息（开发者用）
- `--config <path>`：配置文件路径

## Commander.js 深度使用

### 为什么选 Commander

Node.js 生态有多个命令行解析库：Commander、yargs、CAC、clipanion、oclif。repox 选择 Commander，原因如下：

**市场验证**：Commander 是 npm 上下载量最大的 CLI 框架，周下载量超过 1 亿。Claude Code 选择了它，Express 的 CLI 用它，Vue CLI 用它，create-react-app 用它。

**API 简洁**：Commander 的 API 是链式调用风格，代码读起来就是命令的声明：

```typescript
program
  .command('scan')
  .description('扫描仓库')
  .option('-f, --format <format>', '输出格式', 'table')
  .action(handler)
```

对比 yargs 的配置对象风格：

```typescript
yargs.command('scan', '扫描仓库', {
  format: { alias: 'f', describe: '输出格式', default: 'table' }
}, handler)
```

两者功能等价，但 Commander 的声明式写法更直观，IDE 自动补全也更好。

**类型安全**：Commander 的 TypeScript 支持完善。虽然不如 clipanion（TypeScript 优先设计）那么极致，但覆盖了日常使用的全部场景。

**轻量**：Commander 零依赖，打包后体积极小。CLI 工具对启动速度敏感，依赖越少启动越快。

### 基础用法

安装：

```bash
npm install commander
```

创建程序实例并定义命令：

```typescript
// src/cli.ts
import { Command } from 'commander'

export function createProgram(): Command {
  const program = new Command()

  program
    .name('repox')
    .description('AI 驱动的仓库助手')
    .version('0.1.0', '-v, --version', '显示版本号')

  return program
}
```

`version()` 方法自动注册 `-v` 和 `--version` 选项。执行 `repox --version` 输出 `0.1.0` 并退出。

### 选项定义

Commander 支持多种选项类型：

```typescript
program
  // 布尔标志
  .option('--verbose', '详细输出')
  .option('--no-color', '禁用颜色输出')  // 自动生成 color=false

  // 带值的选项
  .option('-f, --format <format>', '输出格式', 'table')  // 必填值+默认值
  .option('-o, --output [path]', '输出到文件')  // 可选值

  // 可重复选项
  .option('-e, --exclude <pattern...>', '排除的文件模式')
  // repox scan --exclude node_modules --exclude dist
  // → options.exclude = ['node_modules', 'dist']

  // 类型转换
  .option('-d, --depth <number>', '最大深度', parseInt, 10)
  // parseInt 作为处理函数，10 是默认值
```

`<format>` 和 `[path]` 的区别：尖括号表示必填（不提供会报错），方括号表示可选（不提供值时选项值为 true）。

`--no-` 前缀是 Commander 的特殊语法。定义 `--no-color` 后，Commander 自动将 `options.color` 的默认值设为 `true`，使用 `--no-color` 时设为 `false`。这比 `--color false` 更符合 Unix 惯例。

### 子命令定义

```typescript
// 方式一：action handler
program
  .command('scan')
  .description('扫描仓库，生成项目画像')
  .argument('[dir]', '目标目录', '.')
  .option('-f, --format <format>', '输出格式', 'table')
  .option('--max-depth <n>', '最大扫描深度', parseInt)
  .action(async (dir: string, options: { format: string; maxDepth?: number }) => {
    // dir 是位置参数，options 是选项集合
    await performScan(dir, options)
  })

// 方式二：独立命令文件（适合复杂命令）
// Commander 会 fork 一个子进程执行 repox-scan
program
  .command('scan', '扫描仓库', { executableFile: 'repox-scan' })
```

方式一适合 repox 这样的中等规模工具——所有命令在同一个进程内，共享配置和工具函数。方式二适合 `git` 这样的巨型工具，每个子命令是独立的可执行文件，可以用不同的语言编写。

### 钩子

Commander 提供 `hook` 方法，在命令执行前后插入逻辑：

```typescript
program.hook('preAction', (thisCommand, actionCommand) => {
  const options = thisCommand.opts()
  if (options.verbose) {
    console.error(`[verbose] 执行命令: ${actionCommand.name()}`)
  }
  if (options.debug) {
    console.error(`[debug] 参数:`, actionCommand.args)
    console.error(`[debug] 选项:`, actionCommand.opts())
  }
})

program.hook('postAction', () => {
  // 清理资源、上报耗时等
})
```

`preAction` 钩子是实现 `--verbose` 和 `--debug` 全局选项的理想位置。不需要在每个命令的 action 里重复判断。

### 自定义帮助

默认的帮助输出已经不错，但可以定制：

```typescript
program.addHelpText('after', `
示例:
  $ repox scan                     扫描当前目录
  $ repox scan ./src --format json  扫描 src 目录并输出 JSON
  $ repox explain ./src/app.ts     解释指定文件
  $ repox review                   审查当前变更
  $ repox commit                   生成并执行提交

文档: https://github.com/user/repox
`)
```

帮助信息中的示例（Examples）极其重要。很多用户不看参数说明，只看示例然后修改。确保每个命令的帮助信息都包含 2-3 个典型用法示例。

### 错误处理

Commander 默认在参数错误时输出错误信息并退出。可以自定义这个行为：

```typescript
program.exitOverride() // 抛异常而不是直接 process.exit
program.configureOutput({
  writeOut: (str) => process.stdout.write(str),
  writeErr: (str) => process.stderr.write(str),
  outputError: (str, write) => {
    write(`\x1b[31m${str}\x1b[0m`) // 红色显示错误
  },
})
```

## 参数校验：Zod 驱动的类型安全

Commander 的参数解析是弱类型的——`--depth` 拿到的是字符串，需要手动 parseInt。对于简单工具这够用了，但当参数变复杂时（嵌套对象、枚举值、正则约束），手写校验代码会很痛苦。

Zod 是一个 TypeScript 优先的 schema 校验库，可以同时完成**类型定义**和**运行时校验**：

```typescript
// src/schemas/scan-options.ts
import { z } from 'zod'

export const ScanOptionsSchema = z.object({
  format: z.enum(['table', 'json', 'markdown']).default('table'),
  maxDepth: z.number().int().positive().optional(),
  exclude: z.array(z.string()).default([]),
  verbose: z.boolean().default(false),
})

// 自动推导 TypeScript 类型
export type ScanOptions = z.infer<typeof ScanOptionsSchema>
// 等价于:
// type ScanOptions = {
//   format: 'table' | 'json' | 'markdown'
//   maxDepth?: number
//   exclude: string[]
//   verbose: boolean
// }
```

在命令的 action 中使用：

```typescript
import { ScanOptionsSchema } from '../schemas/scan-options.js'

program
  .command('scan')
  .argument('[dir]', '目标目录', '.')
  .option('-f, --format <format>', '输出格式', 'table')
  .option('--max-depth <n>', '最大扫描深度')
  .option('-e, --exclude <pattern...>', '排除模式')
  .action((dir: string, rawOptions: Record<string, unknown>) => {
    // Zod 校验 + 类型转换
    const result = ScanOptionsSchema.safeParse({
      ...rawOptions,
      maxDepth: rawOptions.maxDepth ? Number(rawOptions.maxDepth) : undefined,
    })

    if (!result.success) {
      const errors = result.error.issues
        .map(issue => `  ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')
      console.error(`参数校验失败:\n${errors}`)
      process.exit(2)  // 退出码 2 表示参数错误
    }

    const options = result.data  // 类型安全的 ScanOptions
    performScan(dir, options)
  })
```

封装一个通用的校验函数，避免在每个命令里重复这段逻辑：

```typescript
// src/utils/validate.ts
import { z, ZodSchema } from 'zod'

export function validateOptions<T>(
  schema: ZodSchema<T>,
  raw: Record<string, unknown>,
): T {
  const result = schema.safeParse(raw)
  if (result.success) return result.data

  const errors = result.error.issues
    .map(issue => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  console.error(`参数错误:\n${errors}`)
  process.exit(2)
}
```

使用时一行搞定：

```typescript
.action((dir, rawOptions) => {
  const options = validateOptions(ScanOptionsSchema, rawOptions)
  // options 自动获得正确的类型
})
```

这个模式的价值在于：**schema 就是文档**。新加入项目的开发者看 `ScanOptionsSchema` 就知道 scan 命令接受哪些参数、什么类型、什么约束，不需要翻阅其他代码。

## 命令组织模式

当子命令数量增长到 5 个以上，如何组织代码就变得重要了。常见的三种模式：

### 模式一：单文件

所有命令定义在一个文件里：

```typescript
// src/cli.ts
program.command('scan').action(scanHandler)
program.command('explain').action(explainHandler)
program.command('review').action(reviewHandler)
program.command('commit').action(commitHandler)
program.command('init').action(initHandler)
```

适合命令数量 ≤ 3 的小工具。超过这个数量，文件会膨胀到难以维护。

### 模式二：目录约定式

按文件系统结构自动发现命令：

```
src/commands/
├── scan.ts       → repox scan
├── explain.ts    → repox explain
├── review.ts     → repox review
└── config/
    ├── set.ts    → repox config set
    └── get.ts    → repox config get
```

框架扫描 `commands/` 目录，根据文件名自动注册命令。oclif 和 clipanion 用这种模式。

优点是零配置——加文件就加命令。缺点是隐式约定多，调试困难（"为什么我的命令没注册？"——可能是文件名拼错了、导出格式不对、目录层级不对），且测试时需要文件系统支持。

### 模式三：注册式

每个命令导出一个注册函数，在入口文件显式注册：

```typescript
// src/commands/scan.ts
export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('扫描仓库，生成项目画像')
    .action(scanHandler)
}
```

```typescript
// src/cli.ts
import { registerScanCommand } from './commands/scan.js'
import { registerExplainCommand } from './commands/explain.js'
import { registerReviewCommand } from './commands/review.js'
import { registerCommitCommand } from './commands/commit.js'
import { registerInitCommand } from './commands/init.js'

export function createProgram(): Command {
  const program = new Command()
  program.name('repox').description('AI 驱动的仓库助手').version('0.1.0')

  registerScanCommand(program)
  registerExplainCommand(program)
  registerReviewCommand(program)
  registerCommitCommand(program)
  registerInitCommand(program)

  return program
}
```

repox 采用这种模式。原因：

1. **显式优于隐式**。`cli.ts` 一目了然地列出所有命令，新成员看这一个文件就知道工具有哪些功能。
2. **类型安全**。导入路径错误时 TypeScript 编译器会报错，不会出现运行时才发现命令缺失的情况。
3. **灵活**。可以根据条件注册命令（比如某些命令只在 debug 模式下可用），也可以在测试中只注册需要测试的命令。
4. **启动速度可控**。命令的 action handler 可以用动态 import 延迟加载，减少启动时的模块解析开销。

延迟加载的技巧：

```typescript
export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('扫描仓库，生成项目画像')
    .action(async (...args) => {
      // 只在命令实际执行时才加载 handler 模块
      const { handleScan } = await import('./scan-handler.js')
      await handleScan(...args)
    })
}
```

当 repox 有 10+ 个命令时，每个命令的 handler 可能依赖不同的重量级模块（AI SDK、Git 操作库等）。延迟加载确保 `repox scan` 不会加载 `review` 命令的依赖，保持启动速度。

## 实战：搭建 repox 完整命令体系

基于前面的设计决策，开始实现 repox 的完整命令结构。

### 命令清单

| 命令 | 描述 | 典型用法 |
|---|---|---|
| `scan` | 扫描仓库生成项目画像 | `repox scan --format json` |
| `explain` | 解释代码文件或目录 | `repox explain ./src/cli.ts` |
| `review` | 审查代码变更 | `repox review --diff HEAD~1` |
| `commit` | AI 生成提交信息并提交 | `repox commit --dry-run` |
| `init` | 初始化 repox 配置 | `repox init` |
| `config` | 管理配置 | `repox config set model gpt-4o` |

### 项目结构

```
src/
├── index.ts              # 入口：信号处理 + 启动
├── cli.ts                # CLI 定义 + 命令注册
├── commands/
│   ├── scan.ts           # scan 命令
│   ├── explain.ts        # explain 命令
│   ├── review.ts         # review 命令
│   ├── commit.ts         # commit 命令
│   ├── init.ts           # init 命令
│   └── config.ts         # config 命令（含 set/get 子命令）
├── schemas/
│   ├── scan-options.ts   # scan 参数 schema
│   ├── commit-options.ts # commit 参数 schema
│   └── common.ts         # 公共 schema（format、verbosity 等）
└── utils/
    ├── validate.ts       # Zod 校验工具
    ├── output.ts         # 输出格式化（table/json/markdown）
    └── logger.ts         # 日志工具（verbose/debug 支持）
```

### cli.ts 完整实现

```typescript
// src/cli.ts
import { Command } from 'commander'
import { registerScanCommand } from './commands/scan.js'
import { registerExplainCommand } from './commands/explain.js'
import { registerReviewCommand } from './commands/review.js'
import { registerCommitCommand } from './commands/commit.js'
import { registerInitCommand } from './commands/init.js'
import { registerConfigCommand } from './commands/config.js'

export function run(argv: string[]): void {
  const program = createProgram()

  if (argv.length <= 2) {
    program.help()
  }

  program.parse(argv)
}

function createProgram(): Command {
  const program = new Command()

  program
    .name('repox')
    .description('AI 驱动的仓库助手')
    .version('0.1.0', '-v, --version', '显示版本号')
    .option('--verbose', '输出详细日志')
    .option('--debug', '输出调试信息')
    .option('--no-color', '禁用颜色输出')

  // preAction 钩子：全局选项处理
  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts()

    if (opts.debug) {
      process.env.REPOX_DEBUG = '1'
    }

    if (opts.verbose || opts.debug) {
      process.env.REPOX_VERBOSE = '1'
    }

    // 通过环境变量传递全局选项，避免在每个命令中显式传递
    if (opts.color === false) {
      process.env.NO_COLOR = '1'
    }
  })

  // 注册命令
  registerScanCommand(program)
  registerExplainCommand(program)
  registerReviewCommand(program)
  registerCommitCommand(program)
  registerInitCommand(program)
  registerConfigCommand(program)

  // 帮助信息增强
  program.addHelpText('after', `
示例:
  $ repox scan                       扫描当前目录
  $ repox explain src/cli.ts         解释指定文件
  $ repox review                     审查未提交的变更
  $ repox commit                     AI 生成提交信息
  $ repox init                       初始化项目配置

环境变量:
  REPOX_API_KEY     AI 服务的 API Key
  REPOX_MODEL       默认使用的模型
  REPOX_DEBUG       启用调试输出 (等同 --debug)
`)

  // 未知命令处理
  program.on('command:*', (operands) => {
    console.error(`错误: 未知命令 '${operands[0]}'`)

    const availableCommands = program.commands.map(cmd => cmd.name())
    const suggestion = findClosestCommand(operands[0], availableCommands)
    if (suggestion) {
      console.error(`你是不是要输入: repox ${suggestion}`)
    }

    console.error(`执行 'repox --help' 查看所有可用命令`)
    process.exit(1)
  })

  return program
}

// 简单的编辑距离匹配，用于命令纠错
function findClosestCommand(input: string, commands: string[]): string | null {
  let minDistance = Infinity
  let closest: string | null = null

  for (const cmd of commands) {
    const distance = levenshteinDistance(input, cmd)
    if (distance < minDistance && distance <= 2) {
      minDistance = distance
      closest = cmd
    }
  }

  return closest
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }

  return matrix[b.length][a.length]
}
```

几个设计要点：

**全局选项通过环境变量传递**。`--verbose` 设置 `process.env.REPOX_VERBOSE`，这样深层的工具函数不需要逐层传递 verbose 参数，直接读环境变量即可。这是很多 CLI 工具的通用做法——环境变量充当了全局状态，但因为 CLI 进程是短暂的，不存在 GUI 应用中全局状态难以管理的问题。

**未知命令纠错**。用编辑距离（Levenshtein Distance）计算用户输入和已有命令的相似度。`repox scna` 会提示"你是不是要输入 scan"。git 和 gh 都有这个功能，是 CLI UX 的加分项。

**NO_COLOR 约定**。`NO_COLOR` 是一个跨工具的标准环境变量（参见 https://no-color.org/）。设置后，所有支持该标准的工具都会禁用颜色输出。repox 通过 `--no-color` 标志设置它。

### explain 命令

```typescript
// src/commands/explain.ts
import { Command } from 'commander'
import { readFileSync, statSync } from 'node:fs'

export function registerExplainCommand(program: Command): void {
  program
    .command('explain')
    .description('解释代码文件或函数')
    .argument('<target>', '目标文件路径')
    .option('-d, --detail <level>', '详细程度 (brief|normal|deep)', 'normal')
    .option('-f, --format <format>', '输出格式 (text|json|markdown)', 'text')
    .option('--no-context', '不包含项目上下文')
    .action(async (target: string, options) => {
      // 检查文件是否存在
      try {
        const stat = statSync(target)
        if (stat.isDirectory()) {
          console.error(`"${target}" 是目录。explain 命令目前只支持单个文件。`)
          console.error('提示: 用 repox scan 查看整个项目的概况')
          process.exit(1)
        }
      } catch {
        console.error(`文件不存在: ${target}`)
        process.exit(1)
      }

      const content = readFileSync(target, 'utf-8')

      // 这里后续会接入 AI 服务
      // 目前输出文件基本信息作为占位
      const lines = content.split('\n')
      console.log(`文件: ${target}`)
      console.log(`行数: ${lines.length}`)
      console.log(`大小: ${Buffer.byteLength(content)} bytes`)
      console.log('')
      console.log('（AI 解释功能将在后续章节实现）')
    })
}
```

### review 命令

```typescript
// src/commands/review.ts
import { Command } from 'commander'
import { execSync } from 'node:child_process'

export function registerReviewCommand(program: Command): void {
  program
    .command('review')
    .description('审查代码变更')
    .option('--diff <ref>', '对比的 Git 引用', 'HEAD')
    .option('--staged', '只审查暂存区的变更')
    .option('-f, --format <format>', '输出格式', 'text')
    .action(async (options) => {
      // 检查是否在 Git 仓库中
      try {
        execSync('git rev-parse --git-dir', { stdio: 'pipe' })
      } catch {
        console.error('错误: 当前目录不是 Git 仓库')
        process.exit(1)
      }

      // 获取 diff
      const diffCmd = options.staged
        ? 'git diff --staged'
        : `git diff ${options.diff}`

      let diff: string
      try {
        diff = execSync(diffCmd, { encoding: 'utf-8' })
      } catch (error) {
        console.error(`获取 diff 失败: ${(error as Error).message}`)
        process.exit(1)
      }

      if (!diff.trim()) {
        console.log('没有检测到变更')
        process.exit(0)
      }

      const stats = parseDiffStats(diff)
      console.log(`变更统计:`)
      console.log(`  文件数: ${stats.files}`)
      console.log(`  新增行: +${stats.additions}`)
      console.log(`  删除行: -${stats.deletions}`)
      console.log('')
      console.log('（AI 审查功能将在后续章节实现）')
    })
}

function parseDiffStats(diff: string): { files: number; additions: number; deletions: number } {
  const files = new Set<string>()
  let additions = 0
  let deletions = 0

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/b\/(.+)$/)
      if (match) files.add(match[1])
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++
    }
  }

  return { files: files.size, additions, deletions }
}
```

### commit 命令

```typescript
// src/commands/commit.ts
import { Command } from 'commander'
import { execSync } from 'node:child_process'

export function registerCommitCommand(program: Command): void {
  program
    .command('commit')
    .description('AI 生成提交信息并提交')
    .option('--dry-run', '只生成提交信息，不执行提交')
    .option('-f, --format <format>', '提交信息风格 (conventional|simple)', 'conventional')
    .option('--no-verify', '跳过 Git hooks')
    .action(async (options) => {
      // 检查是否在 Git 仓库中
      try {
        execSync('git rev-parse --git-dir', { stdio: 'pipe' })
      } catch {
        console.error('错误: 当前目录不是 Git 仓库')
        process.exit(1)
      }

      // 检查是否有暂存的变更
      const staged = execSync('git diff --staged --stat', { encoding: 'utf-8' })
      if (!staged.trim()) {
        console.error('没有暂存的变更。请先使用 git add 暂存要提交的文件。')
        process.exit(1)
      }

      console.log('暂存的变更:')
      console.log(staged)

      if (options.dryRun) {
        console.log('（dry-run 模式，AI 提交信息生成将在后续章节实现）')
        process.exit(0)
      }

      console.log('（AI 提交功能将在后续章节实现）')
    })
}
```

### config 命令（二级子命令示例）

```typescript
// src/commands/config.ts
import { Command } from 'commander'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR = join(homedir(), '.repox')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

function loadConfig(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveConfig(config: Record<string, string>): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('管理 repox 配置')

  // repox config set <key> <value>
  configCmd
    .command('set')
    .description('设置配置项')
    .argument('<key>', '配置键')
    .argument('<value>', '配置值')
    .action((key: string, value: string) => {
      const config = loadConfig()
      config[key] = value
      saveConfig(config)
      console.log(`已设置 ${key} = ${value}`)
    })

  // repox config get <key>
  configCmd
    .command('get')
    .description('获取配置项')
    .argument('<key>', '配置键')
    .action((key: string) => {
      const config = loadConfig()
      if (key in config) {
        console.log(config[key])
      } else {
        console.error(`配置项 "${key}" 未设置`)
        process.exit(1)
      }
    })

  // repox config list
  configCmd
    .command('list')
    .description('列出所有配置')
    .action(() => {
      const config = loadConfig()
      const entries = Object.entries(config)
      if (entries.length === 0) {
        console.log('（无配置）')
        return
      }
      for (const [key, value] of entries) {
        console.log(`${key} = ${value}`)
      }
    })

  // repox config delete <key>
  configCmd
    .command('delete')
    .description('删除配置项')
    .argument('<key>', '配置键')
    .action((key: string) => {
      const config = loadConfig()
      if (key in config) {
        delete config[key]
        saveConfig(config)
        console.log(`已删除 ${key}`)
      } else {
        console.error(`配置项 "${key}" 不存在`)
        process.exit(1)
      }
    })
}
```

config 命令展示了二级子命令的实现方式。`program.command('config')` 返回一个 Command 实例，可以继续在上面注册子命令。最终用户通过 `repox config set model gpt-4o` 使用。

配置文件路径 `~/.repox/config.json` 遵循 Unix 惯例——用户级配置放在 home 目录下的隐藏文件夹中。`gh` 用 `~/.config/gh/`，`npm` 用 `~/.npmrc`，都是类似的模式。

### init 命令

```typescript
// src/commands/init.ts
import { Command } from 'commander'
import { existsSync, writeFileSync } from 'node:fs'

const DEFAULT_CONFIG = {
  model: 'doubao-1-5-pro-32k-250115',
  format: 'conventional',
  exclude: ['node_modules', 'dist', '.git'],
  language: 'zh-CN',
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('初始化 repox 项目配置')
    .option('--force', '覆盖已有配置')
    .action(async (options) => {
      const configPath = '.repox.json'

      if (existsSync(configPath) && !options.force) {
        console.error(`配置文件 ${configPath} 已存在。使用 --force 覆盖。`)
        process.exit(1)
      }

      // 交互式配置（第 3 章实现），这里先用默认值
      const config = { ...DEFAULT_CONFIG }

      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
      console.log(`已创建 ${configPath}`)
      console.log('')
      console.log('配置内容:')
      for (const [key, value] of Object.entries(config)) {
        console.log(`  ${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      }
    })
}
```

init 命令目前是非交互式的，直接使用默认配置。第 3 章会改造成交互式向导，让用户选择模型、语言等偏好。

### 日志工具

```typescript
// src/utils/logger.ts
export const logger = {
  debug(...args: unknown[]): void {
    if (process.env.REPOX_DEBUG) {
      console.error('[debug]', ...args)
    }
  },

  verbose(...args: unknown[]): void {
    if (process.env.REPOX_VERBOSE) {
      console.error('[verbose]', ...args)
    }
  },

  info(...args: unknown[]): void {
    console.error(...args)
  },

  error(...args: unknown[]): void {
    console.error(...args)
  },
}
```

注意 logger 的所有方法都写到 **stderr**。这是一个重要的设计决策：日志是给人看的，不应该混入 stdout 的数据流。这样 `repox scan --format json 2>/dev/null` 可以得到纯净的 JSON 输出，`repox scan --format json --verbose` 的日志信息显示在终端但不影响管道。

## 小结

这一章完成了 repox 命令体系的设计和实现，核心内容：

- **CLI 是 API**。参数命名、选项设计、输出格式都是接口契约，要像设计 REST API 一样认真对待。一致性、可预测性、渐进式复杂度是三个关键原则。
- **命令解剖学**。程序名、子命令、参数、选项、标志——每个元素有其适用场景。位置参数不超过 2 个，长选项用 kebab-case，标志用 `--no-` 前缀表示否定。
- **Commander.js**。链式声明、钩子机制、自定义帮助、错误处理——覆盖了 CLI 开发的核心需求，且零依赖、打包体积小。
- **Zod 校验**。schema 同时充当类型定义和运行时校验，消除了 Commander 弱类型参数的痛点。schema 本身就是最好的文档。
- **注册式命令组织**。每个命令一个文件、一个注册函数，在 `cli.ts` 显式注册。比目录约定式更透明，比单文件更可维护，支持延迟加载优化启动速度。
- **标杆对比**。git 的动词优先、gh 的名词-动词结构、Vercel 的隐式上下文——理解不同设计哲学才能做出适合自己工具的选择。

下一章将为这些命令加上交互式体验——当用户没提供必要参数时，通过交互式提示引导完成，同时保持管道兼容性。

## 动手试一试

1. 给 `repox scan` 命令添加一个 `--ignore <dirs>` 选项，接受逗号分隔的目录名，在扫描时跳过这些目录
2. 实现一个 `repox hello <name>` 命令，接受一个必选参数 `name`，输出 `你好, <name>！`。如果不传参数，Commander 应该自动报错
3. 运行 `repox --help`，观察所有子命令是否按字母序排列。如果不是，研究一下 Commander 是否支持排序
