# 第 10 章 错误处理与调试

第 4 章已经介绍了 `UserError`/`NetworkError` 的基本分类和退出码规范。本章在此基础上深入错误处理的工程实践：debug 模式的实现、信号处理的细节、以及 `repox doctor` 这样的自诊断工具。

## 10.1 CLI 的错误不是 stack trace

打开浏览器控制台，看到一行 `TypeError: Cannot read properties of undefined (reading 'map')` 是日常——前端工程师对此司空见惯。但同样的事发生在终端里，用户的反应完全不同。

一个刚装上你 CLI 工具的人，执行命令后看到这样的输出：

```
/usr/local/lib/node_modules/repox/dist/index.js:1247
  const items = data.map(fn)
                     ^
TypeError: Cannot read properties of undefined (reading 'map')
    at processResult (/usr/local/lib/node_modules/repox/dist/index.js:1247:22)
    at async run (/usr/local/lib/node_modules/repox/dist/index.js:892:5)
```

他会想什么？"这工具有 bug"、"我是不是装错了"，然后转身卸载。

**终端没有开发者工具，没有 source map，没有热重载。用户看到 stack trace 就意味着你的程序失控了。** 在 CLI 环境中，错误信息是你跟用户沟通的最后一道防线。

好的 CLI 错误信息长这样：

```
✖ 未找到配置文件 .repoxrc
  提示: 运行 repox init 创建默认配置
```

差的 CLI 错误信息长这样：

```
Error: ENOENT: no such file or directory, open '/Users/dev/project/.repoxrc'
    at Object.openSync (node:fs:603:3)
    at Object.readFileSync (node:fs:471:35)
    ...
```

两者传递的信息量相同，但前者告诉用户"发生了什么"和"下一步做什么"，后者只告诉 Node.js 内核开发者一个文件操作失败了。

这章的核心观点只有一个：**错误处理不是后期打补丁，而是 CLI 用户体验设计的一部分。**

## 10.2 错误分类体系

不是所有错误都一样。用户敲错了参数和网络超时是两码事，配置文件格式错误和磁盘空间不足也不该用同一种方式处理。repox 将错误分成三类。

### UserError：用户操作导致的错误

参数缺失、格式不对、配置项无效——这类错误的共同特征是**用户可以自己修复**。处理策略：给出清晰的错误描述和操作提示，不需要 stack trace。

```typescript
// src/core/error.ts
export class UserError extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message)
    this.name = 'UserError'
  }
}
```

使用时：

```typescript
if (!apiKey) {
  throw new UserError(
    '未配置 AI API Key',
    '运行 repox auth 或设置环境变量 REPOX_AI_API_KEY'
  )
}
```

`hint` 字段是关键。错误消息说"出了什么问题"，hint 说"怎么解决"。两者缺一不可。

### NetworkError：网络请求相关的错误

API 调用失败、超时、DNS 解析错误。这类错误的特征是**用户通常无法直接修复**（可能只需要等一会儿再试），但需要知道是哪个请求出了问题。

```typescript
// src/core/error.ts
export class NetworkError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public url?: string,
  ) {
    super(message)
    this.name = 'NetworkError'
  }
}
```

`statusCode` 和 `url` 是调试必需的上下文。当用户报 bug 时，你需要知道是 401（认证过期）还是 429（限流），是请求 GitHub API 还是 AI API。

实际使用可以参考 repox 的 API 客户端（`src/core/api-client.ts`）：

```typescript
if (!response.ok) {
  const errorBody = await response.text().catch(() => '')
  throw new NetworkError(
    `请求失败: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`,
    response.status,
    url,
  )
}
```

### SystemError：程序内部错误

代码逻辑 bug、运行时异常——用户完全无法修复，只能报 bug。这类错误用原生 `Error` 即可，关键是在开发模式下暴露完整信息，在生产模式下给用户一个体面的提示。

为什么不搞更多分类？因为三类足够覆盖 CLI 场景的 99%。过度分类（ConfigError、ValidationError、PermissionError……）只会让代码充斥着无意义的 `instanceof` 判断。

## 10.3 用户友好的错误信息设计

错误信息的设计原则：**一条消息 + 一个可操作的提示**。

repox 的全局错误处理器是所有错误的最终出口：

```typescript
// src/core/error.ts
export function handleError(error: unknown): never {
  if (error instanceof UserError) {
    console.error(chalk.red('✖'), error.message)
    if (error.hint) {
      console.error(chalk.gray('  提示:'), error.hint)
    }
    process.exit(ExitCode.USAGE_ERROR)
  } else if (error instanceof NetworkError) {
    console.error(chalk.red('✖'), `网络请求失败: ${error.message}`)
    if (error.url) {
      console.error(chalk.gray('  请求地址:'), error.url)
    }
    if (error.statusCode) {
      console.error(chalk.gray('  状态码:'), error.statusCode)
    }
    process.exit(ExitCode.GENERAL_ERROR)
  } else if (error instanceof Error) {
    console.error(chalk.red('✖'), `发生意外错误: ${error.message}`)
    if (getLogLevel() === 'debug') {
      console.error(chalk.gray(error.stack ?? ''))
    } else {
      console.error(chalk.gray('  使用 --debug 查看完整错误信息'))
    }
    process.exit(ExitCode.GENERAL_ERROR)
  } else {
    console.error(chalk.red('✖'), '发生未知错误')
    process.exit(ExitCode.GENERAL_ERROR)
  }
}
```

几个设计细节值得注意：

1. **红色 ✖ 前缀**统一标识错误，用户一眼就能识别。info 用蓝色 ℹ，成功用绿色 ✔，警告用黄色 ⚠——图标 + 颜色构成一套视觉语言。

2. **hint 输出在第二行并缩进**，形成"主消息 + 补充说明"的视觉层次。

3. **未知错误不暴露 stack trace**，而是引导用户加 `--debug` 重试。这样既保护了用户体验，又为开发者保留了调试信息。

4. **所有分支都以 `process.exit()` 结束**，返回类型标注为 `never`。TypeScript 类型系统可以据此推断后续代码不可达。

错误信息的一些写法规范：

| 好的写法 | 差的写法 |
|---------|---------|
| 未找到配置文件 .repoxrc | Error: ENOENT |
| API Key 格式无效，应为 sk-开头的字符串 | Invalid API key |
| 网络请求超时 (30000ms) | Request timeout |
| Git 仓库未初始化 | Not a git repository |

规则很简单：**说中文、说具体、说怎么办。**

## 10.4 退出码规范

CLI 程序结束时返回的退出码（exit code）不是给人看的，是给脚本看的。当你的 CLI 被用在 shell 脚本或 CI/CD 流水线中，退出码决定了流程是否继续。

```bash
repox scan --format json > report.json && echo "扫描成功" || echo "扫描失败"
```

这行 shell 脚本能工作的前提是 `repox scan` 在失败时返回非零退出码。

repox 使用的退出码体系：

```typescript
// src/core/error.ts
export const ExitCode = {
  SUCCESS: 0,        // 一切正常
  GENERAL_ERROR: 1,  // 一般性错误（网络、内部异常）
  USAGE_ERROR: 2,    // 使用方式错误（参数、配置）
  NOT_FOUND: 127,    // 命令或资源未找到
  INTERRUPTED: 130,  // 用户中断（Ctrl+C）
} as const
```

这不是随意定的数字，而是遵循 POSIX/Unix 惯例：

- **0**：成功。这是唯一表示"没问题"的值。
- **1**：通用失败。大多数程序在"出错了但不知道该用什么码"时返回 1。
- **2**：使用错误。bash 本身在参数错误时返回 2，`grep` 也遵循这个惯例。
- **127**：命令未找到。shell 在找不到可执行文件时返回 127。
- **128+N**：被信号 N 终止。SIGINT 是信号 2，所以 Ctrl+C 中断返回 130（128+2）。

退出码的实际意义在 CI/CD 中尤为突出。GitHub Actions 默认在命令返回非零时标记步骤失败。如果你的 CLI 在参数错误时不返回非零退出码，CI 就会在错误状态下继续执行后续步骤——这种 bug 极难排查。

## 10.5 信号处理：优雅退出

用户按 Ctrl+C 时，操作系统会向进程发送 SIGINT 信号。Node.js 默认的行为是直接终止进程，但 CLI 工具往往需要做一些清理工作——关闭 spinner 动画、删除临时文件、保存中间状态。

repox 的入口文件（`src/index.ts`）设置了信号处理：

```typescript
#!/usr/bin/env node
import { run } from './cli.js'

// 优雅处理 Ctrl+C
process.on('SIGINT', () => {
  console.log('\n已中断')
  process.exit(130)
})

// 未捕获异常的兜底
process.on('uncaughtException', (error) => {
  console.error('发生意外错误:', error.message)
  if (process.env.DEBUG) {
    console.error(error.stack)
  }
  process.exit(1)
})

run()
```

几个要点：

**SIGINT (Ctrl+C)**：用户主动中断，退出码 130。`console.log('\n已中断')` 中的 `\n` 是为了跟 `^C` 换行——按 Ctrl+C 时终端会先打印 `^C`，不换行直接输出会导致文字粘连。

**SIGTERM**：进程管理器（如 Docker、systemd）发来的终止请求。处理方式与 SIGINT 类似，但通常需要更严肃的清理逻辑：

```typescript
process.on('SIGTERM', () => {
  // 关闭数据库连接、保存状态等
  cleanup()
  process.exit(0) // SIGTERM 是正常终止请求，返回 0
})
```

**uncaughtException**：最后的兜底。任何未被 try-catch 捕获的异常都会触发这个事件。这里的处理逻辑很简单——打印错误信息，非 debug 模式下隐藏 stack trace，然后以错误码退出。

需要注意：`uncaughtException` 处理器只是一道保险，不要依赖它做正常的错误处理。Node.js 官方文档明确说明，触发 `uncaughtException` 后应该尽快退出进程，因为程序状态可能已经不一致。

对于有长时间运行操作的 CLI（比如 `repox commit` 调用 AI API 可能需要几秒），清理逻辑可以更精细：

```typescript
let cleanupFns: (() => void)[] = []

export function onCleanup(fn: () => void) {
  cleanupFns.push(fn)
}

process.on('SIGINT', () => {
  cleanupFns.forEach(fn => {
    try { fn() } catch { /* 清理时不抛错 */ }
  })
  console.log('\n已中断')
  process.exit(130)
})
```

命令内部可以注册清理函数：

```typescript
const spinner = ora('正在分析...').start()
onCleanup(() => spinner.stop()) // 确保 Ctrl+C 时 spinner 停止
```

## 10.6 DEBUG 模式

生产环境的错误信息要简洁，但开发和排障时需要完整上下文。repox 通过两种方式进入调试模式。

### --debug 命令行标志

repox 的全局选项中包含 `--debug`，通过 Commander 的 `preAction` 钩子在命令执行前设置日志级别：

```typescript
// src/cli.ts
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

日志模块（`src/core/logger.ts`）按级别过滤输出：

```typescript
export type LogLevel = 'quiet' | 'normal' | 'verbose' | 'debug'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  quiet: 0,
  normal: 1,
  verbose: 2,
  debug: 3,
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[currentLevel] >= LEVEL_PRIORITY[level]
}
```

`logger.debug()` 只在 debug 级别输出，`logger.verbose()` 在 verbose 和 debug 输出，`logger.info()` 在 quiet 以外的级别都输出。这套分级机制让同一段代码在不同场景下有不同的输出详细度。

### DEBUG 环境变量

另一种方式是通过环境变量。入口文件已经检查了 `process.env.DEBUG`：

```typescript
process.on('uncaughtException', (error) => {
  console.error('发生意外错误:', error.message)
  if (process.env.DEBUG) {
    console.error(error.stack)
  }
  process.exit(1)
})
```

进一步的做法是支持 `DEBUG=repox:*` 这样的 namespace 式调试——这是 Node.js 社区的通用约定，npm 的 `debug` 包就是这么做的。不过对于 repox 这种规模的项目，`--debug` 标志已经够用。

调试模式的输出示例：

```bash
$ repox scan --debug
🔍 日志级别: debug
🔍 工作目录: /Users/dev/my-project
🔍 配置来源: /Users/dev/my-project/.repoxrc
🔍 扫描路径: /Users/dev/my-project
🔍 检测到 package.json
🔍 包管理器: pnpm (pnpm-lock.yaml)
🔍 检测到框架: react, next
ℹ 正在扫描...
✔ 扫描完成
```

### CLI 程序的调试技巧

前端工程师习惯了 Chrome DevTools 的断点调试。CLI 程序同样可以用断点，只是姿势不同。

**方式一：VS Code launch.json**

在 `.vscode/launch.json` 中配置：

```json
{
  "version": "0.2.0",
  "configurations": [{
    "name": "Debug repox",
    "type": "node",
    "request": "launch",
    "runtimeExecutable": "npx",
    "runtimeArgs": ["tsx", "src/index.ts", "scan", "--format", "json"],
    "console": "integratedTerminal",
    "skipFiles": ["<node_internals>/**"]
  }]
}
```
按 F5 即可启动调试，在源码中设断点和前端调试完全一样。

**方式二：node --inspect**

```bash
node --inspect -r tsx/esm src/index.ts doctor
```
打开 Chrome 的 `chrome://inspect`，就能用 DevTools 调试 Node.js 进程。

**方式三：最简单的 --debug 模式**

大多数时候，`repox --debug` + `console.error` 就够了。CLI 工具的调试不像前端那样需要频繁观察 UI 状态变化，更多是跟踪数据流和 API 调用——日志打印反而比断点更高效。

## 10.7 案例拆解：fallback-channel 错误上报机制

来看一个生产级别的错误处理案例。下面的代码来自一个飞书机器人的 Supervisor 模块，实现了一个备用通信通道。这段代码的错误处理策略值得仔细分析。

核心架构是这样的：主 Worker 进程通过 WebSocket 连接飞书服务端。当 Worker 挂掉时，Supervisor 启用 fallback channel 接管消息接收。

```typescript
// fallback-channel.ts（简化版）
async connect() {
  if (isConnected) return;  // 幂等：重复调用不会出错

  const eventDispatcher = new lark.EventDispatcher({});
  eventDispatcher.register({
    "im.message.receive_v1": async (eventData: unknown) => {
      try {
        await handleEvent(eventData, options, client);
      } catch (err) {
        log("ERROR", "fallback_message_error", { error: String(err) });
      }
    },
  });

  wsClient = new lark.WSClient({ /* ... */ });
  await wsClient.start({ eventDispatcher });
  isConnected = true;
  log("INFO", "Fallback channel connected");
},
```

值得注意的处理方式：

**1. 事件处理器内部的 try-catch**。WebSocket 的事件回调如果抛出未捕获异常，可能导致整个连接断开。所以每个事件处理器都有独立的 try-catch，错误只记录不传播。

**2. 结构化日志**。`log("ERROR", "fallback_message_error", { error: String(err) })` 不是简单的 `console.error(err)`。结构化的日志格式（时间戳 + 级别 + 事件名 + 元数据）便于后续用日志系统检索和告警。

```typescript
function log(level: string, msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const extra = meta ? " " + JSON.stringify(meta) : "";
  console.log(`[SUPERVISOR] ${ts} ${level} ${msg}${extra}`);
}
```

**3. 断开连接时的防御性处理**。

```typescript
disconnect() {
  if (!isConnected) return;  // 幂等
  isConnected = false;       // 先改状态，再做清理
  if (wsClient) {
    try {
      wsClient.close({ force: true });
    } catch (err) {
      log("WARN", "fallback_ws_close_error", { error: String(err) });
    }
    wsClient = null;
  }
}
```

`close()` 本身也可能抛错（比如连接已经断了），所以用 try-catch 包起来。关闭操作失败不应该阻止后续流程——这是一个"尽力而为"的清理操作。

**4. 消息解析的防御性编程**。

```typescript
let text = "";
try {
  const content = JSON.parse(String(message.content ?? "{}"));
  text = String(content.text ?? "").trim();
} catch {
  return; // JSON 解析失败直接跳过这条消息，不报错
}
```

来自外部系统的数据永远不可信。`message.content` 可能是 `undefined`、可能不是合法 JSON、`text` 字段可能不存在。每一步都有兜底：`?? "{}"`、`?? ""`、`try-catch` 跳过。

这段代码给 CLI 开发的启示：**错误处理的目标不是"不出错"，而是"出错后系统仍然可控"。**

## 10.8 实战：统一错误处理中间件 + doctor 命令

### 统一错误处理

repox 的 CLI 主程序（`src/cli.ts`）在最顶层用 try-catch 包裹整个 Commander 解析过程：

```typescript
// src/cli.ts
export async function run(argv?: string[]): Promise<void> {
  const program = createProgram()

  try {
    await program.parseAsync(argv ?? process.argv)
  } catch (error) {
    handleError(error)
  }
}
```

这意味着任何命令内部抛出的异常都会被 `handleError` 捕获。命令实现者不需要自己处理错误输出，只需要抛出正确类型的 Error：

```typescript
// 命令实现中
import { UserError, NetworkError } from '../core/error.js'

// 用户错误 → 给提示
throw new UserError('未找到 package.json', '请在项目根目录下运行此命令')

// 网络错误 → 带上下文
throw new NetworkError('API 限流', 429, 'https://api.github.com/repos')

// 其他错误 → 直接 throw，handleError 会兜底
throw new Error('不应该走到这里')
```

这就是"统一错误处理中间件"的含义：错误的产生和错误的呈现彻底解耦。

### doctor 健康检查命令

`repox doctor` 是一个诊断命令，逐项检查运行环境是否正常。这是 CLI 工具中非常实用的功能——当用户报告问题时，第一步就是让他跑一遍 `doctor`。

来看 `src/commands/doctor.ts` 的实现：

```typescript
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('检查项目和 repox 环境的健康状态')
    .action(async () => {
      logger.title('repox 健康检查')

      const checks: CheckResult[] = []

      // 1. Node.js 版本
      const nodeVersion = process.version
      const major = parseInt(nodeVersion.slice(1).split('.')[0], 10)
      checks.push({
        name: 'Node.js 版本',
        status: major >= 18 ? 'pass' : 'fail',
        message: major >= 18 ? nodeVersion : `${nodeVersion}（需要 >= 18.0.0）`,
      })

      // 2. Git 是否可用
      checks.push(checkCommand('Git', 'git --version'))

      // 3. 是否在 Git 仓库中
      checks.push({
        name: 'Git 仓库',
        status: isGitRepo() ? 'pass' : 'warn',
        message: isGitRepo() ? '当前目录是 Git 仓库' : '当前目录不是 Git 仓库',
      })

      // ... 更多检查项

      // 打印汇总
      if (failCount > 0) {
        logger.error(`${failCount} 项检查未通过，请修复后再试`)
      } else if (warnCount > 0) {
        logger.warn(`所有必要检查通过，${warnCount} 项警告`)
      } else {
        logger.success('所有检查通过，环境正常')
      }
    })
}
```

`CheckResult` 的三态设计是关键：

```typescript
interface CheckResult {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}
```

- **pass**：绿色 ✔，一切正常
- **warn**：黄色 ⚠，有问题但不影响核心功能（比如没配 GitHub Token）
- **fail**：红色 ✖，必须修复（比如 Node.js 版本太低）

`checkCommand` 辅助函数封装了"检查某个命令是否可用"的逻辑：

```typescript
function checkCommand(name: string, command: string): CheckResult {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return { name, status: 'pass', message: output }
  } catch {
    return { name, status: 'fail', message: '未安装或不可用' }
  }
}
```

`stdio: ['pipe', 'pipe', 'pipe']` 很重要——不设这个的话，子进程的 stderr 会直接打印到终端，干扰 doctor 的输出格式。

运行效果：

```
repox 健康检查
────────────────────
  ✔ Node.js 版本: v20.11.0
  ✔ Git: git version 2.43.0
  ✔ Git 仓库: 当前目录是 Git 仓库
  ✔ package.json: 已找到
  ✔ TypeScript: tsconfig.json 已找到
  ⚠ GitHub 认证: 未配置（部分功能不可用）
  ⚠ AI API Key: 未配置（AI 功能不可用）
  ✔ npm: 10.2.4

所有必要检查通过，2 项警告
```

一个好的 doctor 命令应该覆盖：运行时版本、必要的外部工具、配置文件完整性、认证状态、网络连通性。repox 目前的实现覆盖了前四项，网络连通性检查（ping API endpoint）可以作为后续扩展。

## 10.9 小结

本章的核心内容：

1. **错误分类**是第一步。UserError、NetworkError、系统错误三分法覆盖绝大多数场景。分类的目的不是学术上的优雅，而是为不同错误提供不同的处理策略。

2. **错误信息 = 发生了什么 + 怎么修复**。一个没有 hint 的错误信息是不完整的。

3. **退出码是 CLI 与外部系统的契约**。0 成功，非零失败，遵循 POSIX 惯例。

4. **信号处理**保证程序在被中断时不留烂摊子。SIGINT 处理器是 CLI 的基本素养。

5. **DEBUG 模式**在简洁和详细之间找到平衡。默认给用户看该看的，`--debug` 给开发者看需要的。

6. **doctor 命令**是 CLI 工具的自诊断能力，大幅降低用户排障的门槛。

错误处理的质量往往决定了用户对一个 CLI 工具的第一印象。一个能在出错时给出清晰指引的工具，比一个功能齐全但报错含糊的工具更容易赢得信任。

## 动手试一试

1. 配置 VS Code launch.json，用断点调试 `repox scan` 命令，在 scanner.ts 的 `walk` 函数中设断点观察递归过程
2. 给 `repox doctor` 添加一项检查：检测当前目录下是否有 `.repoxrc` 配置文件，如果没有则提示"建议运行 repox init"
3. 实现一个 `--timing` 全局选项，在命令执行完毕后打印耗时（如"执行耗时: 1.2s"）。提示：用 Commander 的 `hook('preAction')` 和 `hook('postAction')`
