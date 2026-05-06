# 第 12 章 插件系统设计

## 12.1 为什么需要插件

repox 的核心功能是仓库扫描、AI 辅助 commit、代码审查。但每个团队的工作流不同：有人用飞书、有人用钉钉；有人部署在 GitHub，有人在 GitLab 自建实例；有人要生成周报，有人要同步 Jira。

如果把这些需求全塞进 repox 核心，会怎样？

代码膨胀。`package.json` 的依赖列表无限增长——飞书 SDK、钉钉 SDK、GitLab API 客户端、Jira REST client……用户只需要飞书集成，却被迫下载所有 SDK。

维护失控。每个集成都有自己的 API 版本更新节奏，飞书改了接口你得跟着改，GitLab 发了新版本你得适配。核心团队（甚至可能就你一个人）根本忙不过来。

Unix 哲学早就给出了答案：**做好一件事，通过组合来完成复杂任务**。repox 的一件事是"仓库分析和 AI 辅助开发"，其他都应该交给插件。

插件系统的目标：
- 核心足够精简，只包含仓库分析和 AI 交互
- 第三方集成通过插件实现
- 插件可以注册新命令、挂载生命周期钩子
- 安装和管理通过 CLI 命令完成

## 12.2 三种插件架构

在动手写之前，值得看看业界主流的三种插件架构，各有优劣。

### 约定式：eslint 模式

eslint 的插件是 npm 包，包名必须是 `eslint-plugin-xxx`。eslint 在配置文件中看到 `plugins: ['xxx']` 后，自动拼接出 `eslint-plugin-xxx` 去 `require`。

```
npm install eslint-plugin-react
```

优点：npm 生态现成可用，包管理、版本管理、发现机制都不需要重新发明。缺点：命名约定是隐性的，新手经常搞混 `eslint-plugin-react` 和 `@typescript-eslint/eslint-plugin` 这类 scope 包。

**repox 采用这种方式**。插件包名约定为 `repox-plugin-<name>`，用户输入 `repox plugin install feishu`，系统自动补全为 `repox-plugin-feishu` 并 npm install。

### 注册式：vite 模式

vite 的插件在配置文件中显式注册：

```javascript
// vite.config.ts
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
})
```

插件是一个函数调用的返回值，可以传参定制行为。优点：类型安全、IDE 自动补全、可以在注册时配置参数。缺点：需要用户手动编辑配置文件，对 CLI 工具来说交互体验不够好。

### 命令式：git 模式

git 的"插件"是 PATH 中以 `git-` 为前缀的可执行文件。安装了 `git-lfs` 后，`git lfs` 就能用了——git 在 PATH 中搜索 `git-lfs` 可执行文件并调用。

优点：语言无关，插件可以用 Python、Rust、Shell 任意语言编写。缺点：只能扩展命令，无法挂载钩子（git 的 hooks 是另一套机制）；依赖 PATH 环境变量，安装和发现不如 npm 规范。

前端工程师对这三种模式其实很熟悉：约定式就是 ESLint 的 `eslint-plugin-xxx` 自动发现；注册式就是 Vite 的 `plugins: [react()]`；命令式就是 Git 的 PATH 发现机制。如果你用过 Webpack 的 tapable hooks，那 repox 的 `beforeCommand`/`afterCommand` 本质上是同一套设计——在关键节点触发回调，让外部代码介入流程。

### 选择理由

repox 选择约定式，原因很直接：

1. repox 本身是 Node.js/TypeScript 项目，插件也用 TypeScript 写，语言一致性好。
2. npm 的包管理基础设施直接复用，不需要自建插件仓库。
3. 插件不仅需要扩展命令，还需要挂载生命周期钩子（如 `beforeCommit`），这要求插件以模块形式加载，可执行文件模式做不到。

## 12.3 插件接口设计

插件的 TypeScript 接口定义在 `src/core/plugin-manager.ts`：

```typescript
// src/core/plugin-manager.ts
export interface RepoxPlugin {
  name: string
  version: string
  description?: string
  // 注册命令
  registerCommands?: (program: Command) => void
  // 生命周期钩子
  hooks?: {
    beforeCommand?: (commandName: string) => Promise<void> | void
    afterCommand?: (commandName: string) => Promise<void> | void
    beforeScan?: () => Promise<void> | void
    afterScan?: (result: unknown) => Promise<void> | void
    beforeCommit?: (message: string) => Promise<string> | string
    afterCommit?: () => Promise<void> | void
  }
}
```

设计决策逐条说明：

**`name` 和 `version` 是必须字段**。用于日志输出、冲突检测、版本兼容性检查。其他字段全部可选——一个只注册命令的插件不需要 hooks，一个只挂钩子的插件不需要 registerCommands。

**`registerCommands` 接收 Commander 的 `Command` 实例**。插件拿到顶层 program 对象后，可以用 `.command()` 注册任意子命令。这跟 repox 自身注册命令的方式完全一致——插件代码和核心代码使用同一套 API。

**hooks 的返回类型支持同步和异步**。`Promise<void> | void` 让简单的钩子不需要 async，复杂的钩子可以用 await。`beforeCommit` 的返回值是 `Promise<string> | string`，因为它可以修改 commit message——这是唯一一个有转换能力的钩子。

为什么不设计成 EventEmitter 模式（`plugin.on('beforeCommit', handler)`）？因为 EventEmitter 的注册和触发是分离的，类型安全很难保证。接口模式让 TypeScript 直接推断每个钩子的参数和返回类型。

## 12.4 生命周期钩子设计

六个钩子覆盖了 repox 的核心操作节点：

| 钩子 | 触发时机 | 参数 | 返回值 | 典型用途 |
|------|---------|------|--------|---------|
| `beforeCommand` | 任意命令执行前 | 命令名 | void | 权限检查、审计日志 |
| `afterCommand` | 任意命令执行后 | 命令名 | void | 统计上报、通知 |
| `beforeScan` | scan 命令扫描前 | 无 | void | 添加自定义扫描规则 |
| `afterScan` | scan 命令扫描后 | 扫描结果 | void | 上传扫描报告 |
| `beforeCommit` | commit 前 | commit message | string | 修改/校验 commit 消息 |
| `afterCommit` | commit 后 | 无 | void | 通知飞书/钉钉、触发 CI |

钩子的执行引擎很简单——遍历所有插件，按注册顺序依次执行：

```typescript
// src/core/plugin-manager.ts
export async function executeHook(
  plugins: RepoxPlugin[],
  hookName: keyof NonNullable<RepoxPlugin['hooks']>,
  ...args: unknown[]
): Promise<void> {
  for (const plugin of plugins) {
    const hook = plugin.hooks?.[hookName]
    if (typeof hook === 'function') {
      try {
        logger.debug(`执行 Hook: ${plugin.name}.${hookName}`)
        await (hook as (...a: unknown[]) => unknown)(...args)
      } catch (error) {
        logger.warn(
          `插件 ${plugin.name} 的 ${hookName} Hook 执行失败: ${error instanceof Error ? error.message : ''}`
        )
      }
    }
  }
}
```

几个关键设计：

**串行执行，不是并行**。`for...of` + `await` 保证钩子按顺序执行。并行执行（`Promise.all`）虽然快，但无法控制执行顺序，也无法让后一个钩子读取前一个钩子的修改结果。

**错误不传播**。单个插件的钩子出错只打 warn 日志，不影响其他插件和主流程。这是插件系统的基本原则——插件不应该有能力搞挂宿主程序。

**`logger.debug` 记录每次钩子执行**。`--debug` 模式下可以看到哪些钩子被触发了、执行了哪些插件的钩子，排查插件问题时非常有用。

`beforeCommit` 是唯一一个可以修改参数的钩子。实际使用时，命令实现者需要特殊处理它的返回值：

```typescript
// 在 commit 命令中
let message = generatedMessage
for (const plugin of plugins) {
  if (plugin.hooks?.beforeCommit) {
    message = await plugin.hooks.beforeCommit(message)
  }
}
// message 现在可能已经被插件修改过了
```

这形成了一条处理链——每个插件拿到上一个插件的输出作为输入，类似中间件模式。

## 12.5 插件安装与发现机制

### 安装目录

repox 的插件安装在全局配置目录下的 `plugins` 子目录中：

```typescript
// src/core/plugin-manager.ts
function getPluginDir(): string {
  return path.join(getGlobalConfigDir(), 'plugins')
}
```

最终路径类似 `~/.config/repox/plugins/`。这个目录本质上是一个独立的 npm 项目——有自己的 `node_modules` 和 `package.json`。

### 安装流程

```typescript
export function installPlugin(name: string): void {
  const fullName = name.startsWith('repox-plugin-') ? name : `repox-plugin-${name}`
  const pluginDir = getPluginDir()
  fs.mkdirSync(pluginDir, { recursive: true })

  logger.info(`安装插件 ${fullName}...`)

  try {
    execSync(`npm install ${fullName} --prefix "${pluginDir}"`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    })
  } catch (error) {
    throw new Error(`插件 ${fullName} 安装失败。请确认包名是否正确。`)
  }

  const installed = getInstalledPluginNames()
  if (!installed.includes(fullName)) {
    installed.push(fullName)
    updateManifest(installed)
  }

  logger.success(`插件 ${fullName} 安装成功`)
}
```

`--prefix` 参数让 npm 将包安装到指定目录而非当前目录。安装成功后更新 `manifest.json`——这是一个简单的 JSON 文件，记录已安装的插件列表：

```json
{
  "plugins": [
    "repox-plugin-feishu",
    "repox-plugin-gitlab"
  ]
}
```

为什么要单独维护 manifest，而不是直接读 `node_modules` 目录？因为 `node_modules` 里还有插件的依赖包，无法区分"用户主动安装的插件"和"插件的依赖"。manifest 只记录用户显式安装的顶层插件。

### 加载流程

CLI 启动时，`loadPlugins` 读取 manifest、逐个加载：

```typescript
export async function loadPlugins(): Promise<RepoxPlugin[]> {
  const installed = getInstalledPluginNames()
  const pluginDir = getPluginDir()
  const plugins: RepoxPlugin[] = []

  for (const name of installed) {
    try {
      const pluginPath = path.join(pluginDir, 'node_modules', name)
      const pkg = JSON.parse(
        fs.readFileSync(path.join(pluginPath, 'package.json'), 'utf-8')
      )
      const mainFile = pkg.main || 'index.js'
      const mainPath = path.join(pluginPath, mainFile)

      if (!fs.existsSync(mainPath)) {
        logger.warn(`插件 ${name} 入口文件不存在: ${mainFile}`)
        continue
      }

      const mod = await import(mainPath)
      const plugin: RepoxPlugin = mod.default || mod
      plugin.name = plugin.name || name
      plugin.version = plugin.version || pkg.version
      plugins.push(plugin)
      logger.debug(`已加载插件: ${name}@${plugin.version}`)
    } catch (error) {
      logger.warn(
        `插件 ${name} 加载失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
    }
  }

  return plugins
}
```

注意加载失败的处理：warn 日志 + continue。一个插件坏了不能影响其他插件和整个 CLI 的启动。这是容错设计的基本原则。

`mod.default || mod` 的写法是为了兼容两种导出方式：

```typescript
// ESM default export
export default { name: 'feishu', version: '1.0.0', ... }

// CommonJS module.exports
module.exports = { name: 'feishu', version: '1.0.0', ... }
```

### CLI 命令

`src/commands/plugin.ts` 提供了三个子命令：

```bash
repox plugin install feishu    # 安装（自动补全为 repox-plugin-feishu）
repox plugin list              # 列出已安装插件
repox plugin uninstall feishu  # 卸载
```

还支持别名：`install` → `add`，`uninstall` → `remove`，`list` → `ls`——跟 npm 的命令别名保持一致，降低学习成本。

## 12.6 插件间通信与依赖管理

当插件数量增多，一个不可避免的问题是：插件之间怎么协作？

repox 目前采用最简单的方案——**不直接通信**。插件通过钩子的参数和返回值间接交互。比如 A 插件在 `beforeCommit` 中修改了 commit message，B 插件在 `afterCommit` 中能看到最终的 commit 结果。

如果未来确实需要插件间通信，可以引入一个共享上下文对象：

```typescript
// 扩展后的钩子签名
interface HookContext {
  config: RepoxConfig
  cwd: string
  // 插件可以往 meta 里写数据
  meta: Map<string, unknown>
}

hooks?: {
  beforeCommand?: (ctx: HookContext, commandName: string) => Promise<void> | void
}
```

A 插件写入 `ctx.meta.set('scan-report-url', url)`，B 插件读取 `ctx.meta.get('scan-report-url')`。这种松耦合的方式避免了插件之间的强依赖。

但目前 repox 不需要这个——过度设计不是美德。等真的有两个以上的插件需要通信时再加也不迟。

依赖管理方面，npm 本身就处理了版本冲突。两个插件都依赖 `lodash` 但版本不同？npm 的嵌套 `node_modules` 策略自动解决。repox 不需要在这层上做额外工作。

## 12.7 安全：插件权限控制

npm 包天然具有完整的 Node.js 权限——文件读写、网络请求、子进程执行，什么都能做。`repox plugin install evil-plugin` 理论上可以安装一个恶意插件，窃取用户的 SSH key 或环境变量。

这不是 repox 独有的问题，而是整个 npm 生态的结构性风险。

现阶段的应对策略：

**1. 命名空间信任**。只有 `repox-plugin-` 前缀的包会被安装。虽然这不能阻止恶意包注册这个前缀，但至少缩小了攻击面。

**2. 安装前确认**。可以在安装时显示包的基本信息（作者、下载量、最近更新时间），让用户自行判断。

**3. 审计机制**。定期运行 `npm audit` 检查已安装插件的已知漏洞。可以集成到 `repox doctor` 中。

长远来看，Node.js 的 Permission Model（v20 实验性特性）值得关注：

```bash
node --experimental-permission --allow-fs-read="/home/user" dist/index.js
```

这可以限制插件的文件系统访问范围。但这个特性目前还不够成熟，无法精细控制到单个插件级别。

另一个思路是 WebAssembly 沙箱——让插件运行在 WASM 容器中，只暴露受限的 API。Extism 和 Wasmtime 等项目在这个方向上有不少进展。但对 repox 这种规模的项目来说，引入 WASM 运行时过于复杂，投入产出比不高。

务实的做法是：**明确告知用户"安装插件等同于信任其代码"，跟 npm install 是同一级别的信任决策。**

## 12.8 案例拆解：Claude Code 的 Hook 机制

Claude Code（Anthropic 的 CLI 编程助手）实现了一套基于 shell 命令的 Hook 系统，思路跟 repox 的插件钩子有本质区别，值得对比分析。

Claude Code 的 Hook 配置在项目的 `.claude/settings.json` 中：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "python3 .claude/hooks/validate-bash.py"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write",
        "command": "npx prettier --write $CLAUDE_FILE_PATH"
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "command": "terminal-notifier -message \"$CLAUDE_NOTIFICATION\""
      }
    ]
  }
}
```

关键差异：

**1. Shell 命令而非代码模块**。Claude Code 的 Hook 是任意 shell 命令——Python 脚本、Node.js 脚本、系统工具、管道组合，什么都行。这比 repox 的 TypeScript 模块方式更灵活，但也更不可控。

**2. Matcher 过滤**。钩子可以只在特定条件下触发。`"matcher": "Bash"` 表示只在 Claude 使用 Bash 工具时触发。repox 目前没有这个概念——所有已注册的钩子都会被无条件执行。

**3. 通过环境变量传参**。`$CLAUDE_FILE_PATH`、`$CLAUDE_NOTIFICATION` 这些环境变量是 Claude Code 在调用 Hook 时注入的。这种方式的好处是语言无关——任何能读环境变量的程序都能做 Hook。

**4. 生命周期事件更丰富**。Claude Code 定义了 12 种事件：PreToolUse、PostToolUse、Notification、Stop、SubagentStop 等。repox 目前只有 6 种，但 repox 的领域更聚焦。

如果 repox 要借鉴这个思路，可以支持一种混合模式——插件用 TypeScript 模块实现核心逻辑，但也支持在配置文件中定义轻量级的 shell Hook：

```json
// .repoxrc
{
  "hooks": {
    "afterCommit": "curl -X POST https://webhook.example.com -d '{\"event\": \"commit\"}'"
  }
}
```

这样简单的通知类 Hook 不需要写一整个 npm 包，一行 curl 就够了。但这个扩展目前是计划中的，不在核心实现范围内。

## 12.9 实战：插件命令 + 示例插件

### plugin 命令完整实现

`src/commands/plugin.ts` 的实现已经在 repox 代码库中：

```typescript
// src/commands/plugin.ts
export function registerPluginCommand(program: Command): void {
  const plugin = program
    .command('plugin')
    .description('管理 repox 插件')

  // repox plugin install <name>
  plugin
    .command('install <name>')
    .alias('add')
    .description('安装插件（如 repox plugin install feishu）')
    .action((name: string) => {
      installPlugin(name)
    })

  // repox plugin uninstall <name>
  plugin
    .command('uninstall <name>')
    .alias('remove')
    .description('卸载插件')
    .action((name: string) => {
      uninstallPlugin(name)
    })

  // repox plugin list
  plugin
    .command('list')
    .alias('ls')
    .description('列出已安装的插件')
    .option('-f, --format <format>', '输出格式', 'table')
    .action((options) => {
      const format = options.format as OutputFormat
      const plugins = listPlugins()

      if (plugins.length === 0) {
        logger.info('没有安装任何插件')
        logger.info(`运行 ${chalk.cyan('repox plugin install <name>')} 安装插件`)
        return
      }

      if (format === 'json') {
        logger.plain(JSON.stringify(plugins, null, 2))
        return
      }

      logger.title(`已安装插件 (${plugins.length} 个)`)
      const rows = plugins.map((p) => [
        p.name,
        p.version,
        p.description || chalk.gray('(无描述)'),
      ])
      logger.plain(formatList(['名称', '版本', '描述'], rows, format))
    })
}
```

空列表时的引导信息是个细节——用户跑 `repox plugin list` 发现没有插件，直接告诉他怎么安装，不需要去翻文档。

### 示例插件：repox-plugin-feishu

来写一个完整的飞书通知插件。这个插件在每次 commit 后向飞书群发送通知。

目录结构：

```
repox-plugin-feishu/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts
└── dist/
    └── index.js
```

`package.json`：

```json
{
  "name": "repox-plugin-feishu",
  "version": "1.0.0",
  "description": "repox 飞书通知插件 — commit 后自动发送群消息",
  "main": "dist/index.js",
  "type": "module",
  "keywords": ["repox-plugin", "feishu", "lark"],
  "peerDependencies": {
    "repox": ">=0.1.0"
  }
}
```

`keywords` 中包含 `repox-plugin` 是约定——方便在 npm 上搜索所有 repox 插件。`peerDependencies` 声明对 repox 版本的要求。

`src/index.ts`：

```typescript
import type { RepoxPlugin } from 'repox'

const WEBHOOK_ENV = 'FEISHU_WEBHOOK_URL'

const plugin: RepoxPlugin = {
  name: 'repox-plugin-feishu',
  version: '1.0.0',
  description: '飞书通知插件',

  hooks: {
    afterCommit: async () => {
      const webhookUrl = process.env[WEBHOOK_ENV]
      if (!webhookUrl) {
        // 没配置 webhook 就静默跳过，不报错
        return
      }

      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msg_type: 'text',
            content: {
              text: `[repox] 新的 commit 已提交，项目目录: ${process.cwd()}`,
            },
          }),
        })
      } catch {
        // 通知失败不应该影响 commit 流程
        console.warn('飞书通知发送失败')
      }
    },

    beforeCommit: (message: string) => {
      // 可以在这里校验 commit message 格式
      // 比如要求 feat: / fix: / chore: 前缀
      if (!/^(feat|fix|chore|docs|refactor|test|style|perf|ci|build|revert):/.test(message)) {
        console.warn('⚠ commit 消息不符合 conventional commits 规范')
      }
      return message // 不修改，只警告
    },
  },
}

export default plugin
```

几个设计原则体现在这个示例中：

**环境变量配置**。Webhook URL 通过环境变量传入，不需要复杂的配置文件。对于只有一两个配置项的插件，环境变量是最简单的方案。

**静默降级**。没配 webhook？跳过。发送失败？打个 warn。插件绝不能因为自身的问题阻断主流程。

**beforeCommit 只校验不修改**。返回原始 message，但在不符合规范时打印警告。如果要强制校验，可以改成 throw UserError。

使用方式：

```bash
# 安装插件
repox plugin install feishu

# 设置环境变量
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx"

# 正常使用 repox commit，插件自动生效
repox commit
```

用户不需要修改任何配置文件，不需要在代码中 import 插件——安装后自动加载、自动挂载钩子。这就是约定式插件的优势。

### 编写插件的基本模板

为了让社区更容易贡献插件，可以提供一个最小模板：

```typescript
// repox-plugin-template/index.ts
import type { Command } from 'commander'

export default {
  name: 'repox-plugin-example',
  version: '0.1.0',

  // 注册自定义命令
  registerCommands(program: Command) {
    program
      .command('example')
      .description('示例插件命令')
      .action(() => {
        console.log('Hello from plugin!')
      })
  },

  // 生命周期钩子
  hooks: {
    beforeCommand(commandName: string) {
      console.log(`即将执行命令: ${commandName}`)
    },
  },
}
```

30 行代码就能写一个功能完整的插件——注册了一个新命令，挂了一个钩子。入门门槛足够低。

## 12.10 小结

本章从设计到实现完整走过了一套插件系统：

1. **插件的动机**是保持核心精简。功能膨胀是 CLI 工具最常见的死因之一。

2. **三种架构**各有适用场景：约定式（npm 生态）适合 Node.js 项目、注册式（配置文件）适合需要参数定制的场景、命令式（PATH 发现）适合多语言生态。repox 选择约定式。

3. **RepoxPlugin 接口**定义了插件的能力边界：注册命令 + 生命周期钩子。接口设计的核心是"所有字段可选"——插件可以只做它关心的事。

4. **六个生命周期钩子**覆盖了命令执行、扫描、提交三个核心流程。钩子串行执行、错误隔离、支持同步和异步。

5. **安装与发现**基于 npm + manifest.json。安装用 `npm install --prefix`，发现用 manifest 文件，加载用动态 `import()`。

6. **安全**是未解的难题。现阶段靠命名约定和用户自主判断，长远看需要 Node.js Permission Model 或 WASM 沙箱的成熟。

7. **Claude Code 的 Hook 机制**提供了另一种思路：shell 命令级别的钩子，语言无关但更不可控。

8. **示例插件**展示了完整的开发流程：30 行代码就能写一个可用的插件。

插件系统本质上是一种"信任传递"：你信任核心代码的质量，你也信任（或不信任）社区贡献的插件代码。好的插件架构在于明确这条信任边界，并在边界上做好隔离和容错。

## 动手试一试

1. 编写一个 `repox-plugin-timer` 插件：在 `beforeCommand` hook 中记录时间，在 `afterCommand` hook 中打印命令执行耗时
2. 给插件系统添加"优先级"机制：允许插件声明 `priority: number`，高优先级的插件先执行 hook
3. 思考安全问题：如果用户安装了一个恶意插件，它能做什么？设计一个简单的权限模型（比如插件声明需要的权限，安装时让用户确认）
