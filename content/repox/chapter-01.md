# 第 1 章：从浏览器到终端

## 为什么 CLI 在 AI 时代再次崛起

2024 年末到 2025 年初，一个有趣的现象发生了：当所有人都在谈论 AI 将如何革新图形界面时，最先落地的 AI 编程工具却几乎都选择了命令行。

Anthropic 推出了 Claude Code——一个纯 CLI 的 AI 编程助手，没有花哨的 GUI，只有终端里的文字交互。OpenAI 跟进了 Codex CLI。Google 的 Gemini CLI 也在随后登场。这不是巧合，而是技术选型上的必然。

原因很直接：AI Agent 需要一个**可编程的执行层**。Agent 要读文件、改代码、跑测试、提交 Git，这些操作在 GUI 里需要模拟点击，在 CLI 里只需要调用命令。CLI 天生就是程序与程序之间的接口——stdin 进，stdout 出，退出码表示成功或失败。这套协议简单到任何 AI 模型都能理解。

再看工程师的日常。即使有了 VS Code 和各种 IDE 插件，终端从未真正离开过开发者的工作流。`git`、`npm`、`docker`、`kubectl`——核心工具链几乎全是 CLI。AI 的加入不是要取代这些工具，而是要在它们之上建立新的自动化层。

这本书的配套项目 repox 就是这样一个工具：一个 AI 驱动的仓库助手 CLI。它能扫描项目结构、解释代码、审查变更、生成提交信息。通过构建 repox，你会掌握从零开发一个现代 CLI 工具的全部技能。

## CLI 与 GUI/TUI/Web 的本质区别

很多前端工程师对 CLI 的印象停留在"没有界面的程序"。这个理解方向对了，但缺少关键维度。CLI 和 GUI 的根本差异不在于有没有图形，而在于**交互模型**和**组合能力**。

### 输入输出模型

GUI 程序的输入是用户事件（点击、拖拽、键盘输入），输出是屏幕上的像素变化。CLI 程序的输入是参数和 stdin 流，输出是 stdout/stderr 流加退出码。

```
GUI:  用户事件 → 程序 → 屏幕像素
CLI:  参数+stdin → 程序 → stdout/stderr + 退出码
Web:  HTTP 请求 → 服务 → HTTP 响应
TUI:  键盘事件 → 程序 → 终端字符矩阵
```

这四种交互模型各有优势，但 CLI 的输入输出都是**纯文本流**，这意味着它天然可以被其他程序消费。一个 GUI 按钮的点击结果很难被另一个程序直接使用，但一个 CLI 命令的输出可以直接通过管道传给下一个命令。

### 管道组合

Unix 哲学的核心——"做一件事并做好"——在 CLI 世界里通过管道实现：

```bash
# 找到所有 TypeScript 文件，统计行数，按行数排序
find src -name "*.ts" | xargs wc -l | sort -n

# repox 也可以参与管道
repox scan --format json | jq '.files[] | select(.complexity > 10)'
```

这种组合能力是 CLI 最强大的特性。每个命令只负责一个功能，通过管道串联成复杂的工作流。GUI 程序要实现同样的组合，需要插件系统、API 集成、Webhook——复杂度高出几个量级。

### 脚本化能力

CLI 命令可以直接写进 shell 脚本、CI/CD 配置、Makefile。这意味着任何手动操作都可以无缝转化为自动化流程：

```bash
#!/bin/bash
# CI 中自动审查代码
repox review --format json > review.json
if [ $(jq '.issues | length' review.json) -gt 0 ]; then
  echo "发现问题，阻断合并"
  exit 1
fi
```

GUI 程序要实现同样的自动化，通常需要额外开发 headless 模式或提供独立的 CLI 入口——本质上还是回到了 CLI。

## 终端基础知识

作为前端工程师，你对浏览器的 API 了如指掌，但终端的基础概念可能还比较模糊。这一节覆盖开发 CLI 工具必须掌握的核心知识。

### stdin / stdout / stderr

每个进程启动时会自动获得三个标准流：

| 流 | 文件描述符 | 用途 | Node.js 对应 |
|---|---|---|---|
| stdin | 0 | 标准输入 | `process.stdin` |
| stdout | 1 | 标准输出 | `process.stdout` |
| stderr | 2 | 标准错误 | `process.stderr` |

关键原则：**正常输出写 stdout，错误和日志写 stderr**。这不是约定俗成的"建议"，而是管道能正常工作的前提。

```typescript
// 正确做法
console.log('扫描结果: 42 个文件')     // → stdout，可以被管道消费
console.error('警告: 跳过了 node_modules')  // → stderr，不进入管道

// 错误做法
console.log('错误: 文件不存在')  // 错误信息混入 stdout，会污染管道数据
```

当用户执行 `repox scan | grep "src"` 时，只有 stdout 会进入管道传给 grep。stderr 会直接显示在终端上。如果把错误信息写到 stdout，管道里的下游命令会把错误信息当作正常数据处理，产生混乱。

### 退出码

进程结束时会返回一个 0-255 的整数作为退出码。规则很简单：

- `0` = 成功
- 非零 = 失败

```typescript
// 成功完成
process.exit(0)

// 一般性错误
process.exit(1)

// 参数错误（常用约定）
process.exit(2)

// 被 SIGINT 中断（128 + 信号编号）
process.exit(130)  // 128 + 2(SIGINT)
```

退出码是 CLI 程序之间通信的重要手段。shell 的 `&&` 操作符依赖退出码决定是否继续执行：

```bash
repox scan && repox review   # scan 失败（退出码非零）时，review 不会执行
```

### 管道

管道（`|`）把前一个命令的 stdout 连接到后一个命令的 stdin：

```bash
echo "hello" | tr 'a-z' 'A-Z'   # 输出 HELLO
```

在 Node.js 中，当程序的 stdout 连接到管道时，`process.stdout` 的行为会发生变化——它不再是一个 TTY 设备，而是一个普通的可写流。这会影响到颜色输出和交互式功能，后面的 TTY 检测部分会详细展开。

### 信号：SIGINT 和 SIGTERM

信号是操作系统向进程发送的异步通知。CLI 开发中最常遇到的两个：

- **SIGINT**（信号编号 2）：用户按 Ctrl+C 时发送。含义是"用户想中断当前操作"。
- **SIGTERM**（信号编号 15）：`kill` 命令默认发送的信号。含义是"请优雅地退出"。

```typescript
// 处理 Ctrl+C
process.on('SIGINT', () => {
  // 清理临时文件、关闭数据库连接等
  console.error('\n操作已中断')
  process.exit(130)
})

// 处理 kill 信号
process.on('SIGTERM', () => {
  console.error('收到终止信号，正在清理...')
  cleanup()
  process.exit(143)  // 128 + 15
})
```

如果不处理 SIGINT，Node.js 默认会直接终止进程。对于简单程序这没问题，但如果程序正在写文件或执行网络请求，粗暴终止可能导致数据不一致。repox 在调用 AI 接口时会处理 SIGINT，确保中断时能给出友好提示。

### TTY 检测

TTY（Teletypewriter）是终端设备的抽象。当程序直接在终端中运行时，stdin/stdout 都是 TTY；当通过管道连接时，被管道连接的那一端就不再是 TTY。

```typescript
if (process.stdin.isTTY) {
  // 在终端中直接运行，可以显示交互式 UI
  const answer = await prompt('请输入项目名称: ')
} else {
  // 通过管道或重定向运行，不能弹出交互式提示
  const input = await readStdin()
}

if (process.stdout.isTTY) {
  // 输出到终端，可以用颜色和 spinner
  console.log('\x1b[32m✓ 扫描完成\x1b[0m')
} else {
  // 输出到管道或文件，不要加颜色转义码
  console.log('扫描完成')
}
```

Claude Code 在这方面做得很好：直接运行时有丰富的彩色输出和交互式界面，通过管道使用时自动降级为纯文本。repox 也会遵循这个模式。

## 前端思维 vs CLI 思维

如果你有前端背景，以下对照表能帮你快速建立 CLI 的心智模型：

| 前端概念 | CLI 对应概念 | 说明 |
|---|---|---|
| DOM 树 | stdout 文本流 | 前端操作 DOM 渲染界面，CLI 向 stdout 写文本 |
| 事件监听 (addEventListener) | 信号处理 (process.on) | 前端监听用户事件，CLI 监听系统信号 |
| HTTP 状态码 | 退出码 | 200=成功 → 0=成功，4xx/5xx → 1/2/... |
| 路由 (React Router) | 子命令 (commander) | `/scan` → `repox scan` |
| 组件 props | 命令参数/选项 | `<Button size="lg">` → `repox scan --format json` |
| 状态管理 (useState) | 环境变量 + 配置文件 | CLI 程序通常是无状态的，配置外置 |
| localStorage | 配置文件 (~/.repoxrc) | 持久化用户偏好 |
| fetch API | child_process.exec | 调用外部服务/命令 |
| npm start (dev server) | tsx src/index.ts | 开发模式运行 |
| npm run build (webpack) | esbuild bundle | 构建产物 |
| npm publish | npm publish | 发布到 npm（这个一样） |

有几个思维转变需要特别注意：

**1. 无状态思维**：前端应用是长时间运行的，有复杂的状态管理。CLI 程序是短暂的——启动、执行、退出。每次执行都是独立的，不需要 Redux 或 Zustand。需要持久化的状态（如用户配置）写入文件系统。

**2. 文本即界面**：前端花大量时间在 CSS 布局上。CLI 的"界面"是文本行。对齐用空格和制表符，强调用颜色和粗体，布局用表格和缩进。看起来简陋，但信息密度极高——`git status` 的输出比任何 GUI 的 Git 面板都更紧凑。

**3. 错误处理要激进**：前端代码出错时，通常显示一个 error boundary 或 toast 提示，应用继续运行。CLI 程序出错时，应该直接退出并返回非零退出码。不要试图"恢复"——让用户看到错误信息，修正后重新运行。

**4. 向后兼容是铁律**：前端发版时用户自动获取最新版。CLI 工具安装后可能很久不更新，且用户的脚本和 CI 配置依赖特定的参数格式。一旦发布的参数名、输出格式就是公开的 API 契约，改动需要极其谨慎。

## 环境搭建：Node.js + TypeScript + tsx + esbuild

### 为什么是 Node.js 而不是 Bun/Deno

Bun 很快，Deno 安全模型很优雅，但 CLI 工具开发有一个残酷的现实：**你的用户不一定装了 Bun 或 Deno，但几乎一定装了 Node.js**。

npm 是最成熟的分发渠道。`npm install -g repox` 对任何 Node.js 用户都零摩擦。如果要求用户先装 Bun 再装你的工具，转化率会断崖式下降。

此外，Node.js 的生态成熟度仍然远超 Bun。`child_process`、`fs`、`path`、`readline` 这些标准库久经考验，边界情况的处理经过了十几年的打磨。CLI 工具经常需要深入操作系统交互——生成子进程、操作文件系统、处理信号——这些场景下 Node.js 的稳定性优势明显。

### 为什么用 tsx 开发 + esbuild 打包

TypeScript 的类型系统对 CLI 开发的价值不需要论证——命令参数校验、配置文件解析、API 响应处理，到处需要类型安全。问题是 TypeScript 的编译工具链选哪个。

开发阶段用 **tsx**（TypeScript Execute）。它基于 esbuild，启动速度极快，支持 ESM 和 CJS，不需要任何配置：

```bash
# 直接运行 TypeScript，无需编译步骤
npx tsx src/index.ts scan --format json
```

打包阶段用 **esbuild**。它能把所有 TypeScript 源码打包成单个 JavaScript 文件，启动速度比 tsc 编译的散装文件快得多：

```bash
# 打包成单文件
esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js
```

不用 tsc 的原因：tsc 的输出是一堆 `.js` 文件，保留了原始的目录结构和模块引用。这对库开发合适，但对 CLI 工具来说，单文件分发更简洁，启动也更快（Node.js 不需要解析大量 import 语句和查找模块）。

不用 tsup/unbuild 的原因：它们是 esbuild 的封装，增加了配置复杂度但对 CLI 场景没有额外价值。直接用 esbuild 就够了。

### 工具链安装

```bash
# 创建项目
mkdir repox && cd repox
npm init -y

# 安装开发依赖
npm install -D typescript tsx esbuild @types/node

# 初始化 TypeScript 配置
npx tsc --init
```

`tsconfig.json` 的关键配置：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

几个关键选择的解释：

- `target: "ES2022"`——Node.js 18+ 完全支持 ES2022，包括 top-level await、Array.at() 等。不需要降级到更低版本。
- `module: "ESNext"` + `moduleResolution: "bundler"`——因为我们用 esbuild 打包，不需要 Node.js 原生的模块解析策略。bundler 模式允许省略文件扩展名，更符合开发习惯。
- `strict: true`——CLI 工具处理用户输入和文件系统操作，类型安全能避免大量运行时错误。

## 实战：创建 repox 项目骨架

理论讲完了，开始写代码。

### 项目结构

```
repox/
├── src/
│   ├── index.ts          # 入口文件
│   ├── cli.ts            # CLI 定义和命令注册
│   └── commands/         # 子命令目录
│       └── scan.ts       # scan 命令（占位）
├── dist/                 # 构建输出
├── package.json
├── tsconfig.json
└── build.ts              # 构建脚本
```

### package.json

```json
{
  "name": "repox",
  "version": "0.1.0",
  "description": "AI 驱动的仓库助手",
  "type": "module",
  "bin": {
    "repox": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "node build.ts",
    "start": "node dist/index.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

`bin` 字段是 CLI 工具的核心配置。它告诉 npm：当用户 `npm install -g repox` 时，创建一个名为 `repox` 的全局命令，指向 `./dist/index.js`。npm 会在系统的 PATH 目录下创建一个符号链接（symlink），让用户可以在任何位置执行 `repox` 命令。

`"type": "module"` 声明项目使用 ESM 模块系统。虽然 esbuild 打包后这个字段对产物没有影响，但它决定了开发阶段 tsx 如何解析模块。

### 入口文件

```typescript
// src/index.ts
#!/usr/bin/env node

import { run } from './cli.js'

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('致命错误:', error.message)
  if (process.env.REPOX_DEBUG) {
    console.error(error.stack)
  }
  process.exit(1)
})

// 处理未处理的 Promise 拒绝
process.on('unhandledRejection', (reason) => {
  console.error('未处理的异步错误:', reason)
  process.exit(1)
})

// 处理 Ctrl+C
process.on('SIGINT', () => {
  console.error('\n已中断')
  process.exit(130)
})

// 处理 kill 信号
process.on('SIGTERM', () => {
  console.error('收到终止信号')
  process.exit(143)
})

run(process.argv)
```

注意这里 import 路径写的是 `.js` 而不是 `.ts`。在 ESM 模式下，TypeScript 要求 import 路径使用编译后的扩展名。虽然源文件是 `.ts`，但 Node.js 运行时加载的是 `.js`。这是 ESM + TypeScript 的一个常见困惑点，习惯之后就自然了。

第一行 `#!/usr/bin/env node` 叫做 **shebang**（sharp + bang）。在 Unix 系统中，当一个文件被当作可执行文件运行时，内核会读取第一行来确定用哪个解释器执行它。

`#!/usr/bin/env node` 的含义是"在 PATH 中找到 node 并用它执行这个文件"。为什么不直接写 `#!/usr/bin/node`？因为不同系统上 node 的安装路径不同——macOS 上可能在 `/usr/local/bin/node`，Linux 上可能在 `/usr/bin/node`，nvm 用户可能在 `~/.nvm/versions/...`。`env` 命令会自动在 PATH 中搜索，兼容所有安装方式。

Windows 用户不需要担心 shebang——npm 在 Windows 上会生成 `.cmd` 包装脚本来处理这个问题。

注意入口文件的职责：它只做两件事——注册全局错误处理和启动 CLI。业务逻辑不应该出现在这里。

`uncaughtException` 和 `unhandledRejection` 的处理是防御性编程。正常情况下不应该触发它们（每个 async 函数都应该有 try-catch），但万一遗漏了，至少给用户一个可读的错误信息，而不是 Node.js 默认的堆栈跟踪。`REPOX_DEBUG` 环境变量控制是否显示完整堆栈——这是 CLI 工具的常见做法，Claude Code 也用了类似的 `--debug` 标志。

### CLI 定义

```typescript
// src/cli.ts
import { Command } from 'commander'
import { registerScanCommand } from './commands/scan.js'

export function run(argv: string[]): void {
  const program = new Command()

  program
    .name('repox')
    .description('AI 驱动的仓库助手')
    .version('0.1.0', '-v, --version')
    .option('--verbose', '输出详细日志')
    .option('--debug', '输出调试信息')

  // 注册子命令
  registerScanCommand(program)

  // 无参数时显示帮助
  if (argv.length <= 2) {
    program.help()
  }

  program.parse(argv)
}
```

Commander.js 是 Node.js 生态中使用最广泛的命令行解析库，Claude Code 也选择了它。关于 Commander 的深入用法，第 2 章会详细展开。

这里有一个设计决策值得注意：`argv.length <= 2` 时显示帮助信息。`process.argv` 的前两个元素分别是 `node` 的路径和脚本文件的路径，后面才是用户传入的参数。所以 `argv.length <= 2` 意味着用户没有传入任何参数。

很多 CLI 工具在没有参数时什么都不输出，这是不好的体验。直接显示帮助信息能让用户快速了解可用命令。

### 第一个子命令

```typescript
// src/commands/scan.ts
import { Command } from 'commander'
import { readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

interface ScanResult {
  totalFiles: number
  byExtension: Record<string, number>
  totalSize: number
}

function scanDirectory(dir: string, result: ScanResult): void {
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    // 跳过常见的非项目目录
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.next'].includes(entry.name)) {
        continue
      }
      scanDirectory(fullPath, result)
    } else if (entry.isFile()) {
      const ext = extname(entry.name) || '(无扩展名)'
      result.byExtension[ext] = (result.byExtension[ext] || 0) + 1
      result.totalFiles++
      result.totalSize += statSync(fullPath).size
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('扫描仓库，生成项目画像')
    .argument('[dir]', '目标目录', '.')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action((dir: string, options: { format: string }) => {
      const result: ScanResult = {
        totalFiles: 0,
        byExtension: {},
        totalSize: 0,
      }

      try {
        scanDirectory(dir, result)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(`错误: 目录 "${dir}" 不存在`)
          process.exit(1)
        }
        throw error
      }

      if (options.format === 'json') {
        // JSON 格式：适合管道处理
        console.log(JSON.stringify(result, null, 2))
      } else {
        // 表格格式：适合人眼阅读
        console.log(`\n项目扫描结果`)
        console.log(`${'─'.repeat(40)}`)
        console.log(`文件总数: ${result.totalFiles}`)
        console.log(`总大小:   ${formatBytes(result.totalSize)}`)
        console.log(`\n文件类型分布:`)

        const sorted = Object.entries(result.byExtension)
          .sort((a, b) => b[1] - a[1])

        for (const [ext, count] of sorted) {
          const bar = '█'.repeat(Math.min(count, 30))
          console.log(`  ${ext.padEnd(12)} ${String(count).padStart(5)}  ${bar}`)
        }
      }
    })
}
```

这个 scan 命令展示了几个 CLI 开发的基本模式：

**1. 可选参数带默认值**：`argument('[dir]', '目标目录', '.')` 中方括号表示可选，第三个参数是默认值。用户可以 `repox scan` 扫描当前目录，也可以 `repox scan ./my-project` 指定目录。

**2. 双格式输出**：`--format table` 给人看，`--format json` 给程序用。这是 CLI 工具的标准做法——`kubectl get pods -o json`、`gh pr list --json`、`docker inspect` 都是这个模式。人类友好和机器友好不冲突，用一个选项切换就行。

**3. 错误处理精确到错误类型**：不是笼统地 `catch (e) { console.error(e) }`，而是检查具体的错误码（`ENOENT` 表示文件/目录不存在）。已知的错误给出清晰的提示，未知的错误重新抛出让顶层处理器捕获。

### 构建脚本

```typescript
// build.ts
import { build } from 'esbuild'
import { chmod } from 'node:fs/promises'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/index.js',
  format: 'esm',
  banner: {
    js: '#!/usr/bin/env node',
  },
  // 不打包 Node.js 内置模块
  external: ['node:*'],
})

// 给产物添加可执行权限
await chmod('dist/index.js', 0o755)

console.log('构建完成: dist/index.js')
```

注意 `banner` 配置——esbuild 打包后 shebang 注释会丢失，需要通过 banner 重新注入。`chmod` 设置可执行权限，这样在 Unix 系统上可以直接 `./dist/index.js` 运行。

`await build(...)` 使用了 top-level await，这是 ES2022 引入的特性。在 `"type": "module"` 的项目中，`.js` 文件可以直接在顶层使用 await，不需要包裹在 async 函数中。

### 验证

```bash
# 开发模式运行
npx tsx src/index.ts
# 输出帮助信息

npx tsx src/index.ts scan
# 扫描当前目录并输出结果

npx tsx src/index.ts scan --format json
# 输出 JSON 格式

npx tsx src/index.ts scan --format json | jq '.totalFiles'
# 通过管道提取文件总数

# 构建并验证
npx tsx build.ts
node dist/index.js scan
```

到这里，一个功能完整的 CLI 工具骨架就搭好了。它能接收命令和参数，处理信号，支持多种输出格式，可以参与管道。在后续章节中，repox 会在这个骨架上持续生长。

**本书代码组织方式**

仓库根目录的 `src/` 是 repox 的最终完整版代码。`examples/chapter-XX/` 目录包含每章的阶段性代码快照——只有该章节引入的关键文件。跟着本书练习时，建议从 `examples/chapter-01/` 开始，逐章构建；遇到困惑时参考 `src/` 中的完整实现。

## ESM 与 CJS：前端工程师绕不开的话题

repox 选择纯 ESM（`"type": "module"`），原因有三：

- chalk v5、ora v8 等主流 CLI 库已经是纯 ESM，用 CJS 反而要做兼容处理
- ESM 是 Node.js 的未来方向，新项目没有理由选 CJS
- top-level await、import.meta.url 等特性只在 ESM 中可用

可能遇到的坑：

- **import 路径必须带扩展名**：`import { run } from './cli.js'`，不能省略 `.js`
- **没有 __dirname**：ESM 中用 `import.meta.url` + `fileURLToPath` 替代
- **CJS 依赖怎么办**：大部分 CJS 包可以通过 `import` 直接引入（Node.js 会自动转换），少数需要用 `createRequire` 手动加载
- **cosmiconfig 注意事项**：cosmiconfig v9+ 默认支持 ESM，如果遇到 `require is not defined` 错误，检查是否安装了正确版本

如果你的公司项目还在用 CJS，不用紧张。repox 的所有核心逻辑（commander、zod、API 调用）在两种模式下都能正常工作。ESM/CJS 的差异主要在构建和模块加载层面，不影响业务代码。

## 小结

这一章完成了从前端到 CLI 的认知切换，覆盖了以下核心内容：

- **CLI 在 AI 时代的角色**：不是过时的交互方式，而是 AI Agent 最天然的执行层。可编程、可组合、可脚本化——这些特性让 CLI 成为自动化的基础设施。
- **终端核心概念**：stdin/stdout/stderr 三个标准流、退出码、管道、信号处理、TTY 检测。这些概念看似基础，但决定了你的 CLI 工具能否在 Unix 生态中良好运作。
- **思维转换**：从 GUI 的事件驱动、长生命周期、状态丰富的模型，切换到 CLI 的参数驱动、短生命周期、无状态模型。
- **技术选型**：Node.js 保证分发兼容性，tsx 加速开发循环，esbuild 生成高效的单文件产物。
- **项目骨架**：完成了 repox 的初始结构，实现了 scan 命令作为第一个功能点。

下一章将深入命令设计——如何设计出直觉、一致、可扩展的命令体系。

## 动手试一试

1. 修改 `src/index.ts`，让 repox 在没有任何参数时输出一条友好的欢迎信息（而不是帮助文档）
2. 试试管道：运行 `echo "hello" | npx tsx src/index.ts`，观察 stdin 是否被读取。如果没有，思考一下 CLI 工具应该在什么时候读取 stdin
3. 在终端中运行 `npx tsx src/index.ts &`（后台运行），然后用 `kill -SIGTERM <pid>` 发送信号，验证信号处理是否正常工作
