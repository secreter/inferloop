# 第 3 章：交互式体验

## 为什么 CLI 需要交互

一条 CLI 命令可能需要十几个参数，但用户很少一次性全部提供。

```bash
# 理想情况：用户记得住所有参数
repox init --name my-app --model gpt-4o --language zh-CN --format conventional --exclude node_modules,dist

# 现实情况：用户只记得命令名
repox init
```

传统的做法是：缺参数就报错，让用户看 `--help` 然后重新输入。这个体验很差——用户需要在"看帮助→组装参数→执行→发现还差参数→再看帮助"的循环中反复折腾。

更好的做法是 **交互式降级**：参数存在就直接用，缺少时启动交互式提示。`gh pr create` 就是这个模式的典范——不带参数时逐步询问标题、描述、reviewer；带了参数时静默执行。

交互的价值不止于参数补全。它还能：

- **降低记忆成本**。用户不需要记住可选值。"选择 AI 模型"比"请输入 --model 参数，可选值有..."友好得多。
- **提供即时反馈**。密码输入时隐藏字符，目录路径输入时自动补全，这些在纯参数模式下做不到。
- **引导新用户**。`repox init` 的交互式向导就是最好的入门教程——走完一遍就知道有哪些配置项。

但交互也有边界。两个原则：

1. **能参数化的一定要能参数化**。交互只是参数的降级方案，不能成为唯一的输入方式。`repox commit --message "fix: typo"` 必须能跳过"请输入提交信息"的交互。
2. **管道中不能弹交互**。当 stdout 不是 TTY 时（即程序被管道连接），任何交互式提示都会卡死。必须检测 TTY 状态并降级。

## 三种交互模式

### 模式一：纯参数

所有输入都通过命令行参数传递，不涉及任何交互：

```bash
repox commit --message "fix: correct typo in README"
repox scan --format json --max-depth 3
```

适用场景：CI/CD 流水线、shell 脚本、被其他程序调用。

### 模式二：纯交互

所有输入都通过交互式提示获取：

```bash
$ repox init
? 项目名称: my-app
? 选择 AI 模型: gpt-4o
? 提交信息风格: conventional
? 排除目录 (逗号分隔): node_modules, dist
```

适用场景：首次设置向导、复杂配置场景。`npm init`、`create-next-app` 都是这种模式。

### 模式三：混合 fallback（推荐）

参数存在就用参数值，缺失则交互式询问：

```typescript
// 核心模式：options.xxx || await prompt()
const model = options.model || await select({
  message: '选择 AI 模型',
  choices: [
    { name: 'doubao-1-5-pro-32k-250115 (豆包，推荐)', value: 'doubao-1-5-pro-32k-250115' },
    { name: 'gpt-4o', value: 'gpt-4o' },
    { name: 'claude-sonnet-4-20250514', value: 'claude-sonnet-4-20250514' },
  ],
})
```

repox 的命令全部采用混合模式。实现思路是封装一个 `resolveOption` 函数：

```typescript
// src/utils/prompt.ts
import { input, select, confirm } from '@inquirer/prompts'

interface ResolveConfig<T> {
  value: T | undefined          // 命令行传入的值
  prompt: () => Promise<T>      // 交互式获取的方式
  nonInteractive?: T            // 非交互环境的默认值
}

export async function resolveOption<T>(config: ResolveConfig<T>): Promise<T> {
  // 已经有值了，直接返回
  if (config.value !== undefined) {
    return config.value
  }

  // 非交互环境（管道/CI），使用默认值或报错
  if (!process.stdin.isTTY) {
    if (config.nonInteractive !== undefined) {
      return config.nonInteractive
    }
    throw new Error('该参数在非交互环境中必须通过命令行传入')
  }

  // 交互式获取
  return config.prompt()
}
```

使用示例：

```typescript
const model = await resolveOption({
  value: options.model,
  prompt: () => select({
    message: '选择 AI 模型',
    choices: [
      { name: 'doubao-1-5-pro-32k-250115 (豆包，推荐)', value: 'doubao-1-5-pro-32k-250115' },
      { name: 'gpt-4o', value: 'gpt-4o' },
    ],
  }),
  nonInteractive: 'doubao-1-5-pro-32k-250115',  // CI 环境默认用豆包
})
```

这个三层逻辑覆盖了所有场景：用户传了参数就用参数，没传且在终端就问，没传且在管道/CI 就用默认值。优先级清晰，行为可预测。

## @inquirer/prompts 组件详解

`@inquirer/prompts` 是 Inquirer.js 的新版本，采用模块化设计（每个组件独立安装），API 更简洁，TypeScript 支持更好。

安装：

```bash
npm install @inquirer/prompts
```

### input：文本输入

```typescript
import { input } from '@inquirer/prompts'

const name = await input({
  message: '项目名称',
  default: 'my-project',
  validate: (value) => {
    if (!/^[a-z0-9-]+$/.test(value)) {
      return '项目名只能包含小写字母、数字和连字符'
    }
    return true
  },
  transformer: (value) => value.toLowerCase().replace(/\s+/g, '-'),
})
```

`validate` 返回 `true` 表示通过，返回字符串表示错误提示——用户会看到错误信息并重新输入，直到校验通过。

`transformer` 是显示层的转换——输入时实时把空格转成连字符，让用户看到最终效果。注意 transformer 不影响最终值，只影响显示。要转换最终值，在 validate 通过后自行处理。

### select：单选

```typescript
import { select } from '@inquirer/prompts'

const model = await select({
  message: '选择 AI 模型',
  choices: [
    { name: 'doubao-1-5-pro-32k-250115 (豆包，推荐)', value: 'doubao-1-5-pro-32k-250115' },
    { name: 'gpt-4o (OpenAI)', value: 'gpt-4o' },
    { name: 'claude-sonnet-4-20250514 (Anthropic)', value: 'claude-sonnet-4-20250514' },
    new Separator('── 开源模型 ──'),
    { name: 'deepseek-v3 (DeepSeek)', value: 'deepseek-v3' },
    { name: 'qwen-2.5-72b (通义千问)', value: 'qwen-2.5-72b' },
  ],
  default: 'doubao-1-5-pro-32k-250115',
})
```

`Separator` 是视觉分隔线，在选项列表中插入类别标题，不可选中。当选项超过 5 个时，分类能显著提升可读性。

select 组件用上下箭头选择，回车确认。这比手动输入字符串可靠得多——不会有拼写错误。

### checkbox：多选

```typescript
import { checkbox } from '@inquirer/prompts'

const features = await checkbox({
  message: '启用的功能',
  choices: [
    { name: '代码扫描 (scan)', value: 'scan', checked: true },
    { name: '代码解释 (explain)', value: 'explain', checked: true },
    { name: '代码审查 (review)', value: 'review', checked: true },
    { name: 'AI 提交 (commit)', value: 'commit' },
    { name: '自动修复 (fix)', value: 'fix' },
  ],
  required: true,
  validate: (items) => {
    if (items.length === 0) return '至少选择一个功能'
    return true
  },
})
```

`checked: true` 设置默认选中项。用户用空格键切换选中状态，上下箭头移动光标，回车确认。

### confirm：确认

```typescript
import { confirm } from '@inquirer/prompts'

const proceed = await confirm({
  message: '确认提交以上变更？',
  default: true,
})

if (!proceed) {
  console.log('已取消')
  process.exit(0)
}
```

confirm 只有 Yes/No 两个选项，是最简单的交互。适合在危险操作前做确认——删除文件、覆盖配置、提交代码。

### password：密码输入

```typescript
import { password } from '@inquirer/prompts'

const apiKey = await password({
  message: '输入 API Key',
  mask: '*',  // 显示 * 掩码；不设置则完全隐藏输入
  validate: (value) => {
    if (value.length < 10) return 'API Key 长度不合法'
    return true
  },
})
```

密码输入不会回显字符到终端。`mask: '*'` 会显示星号，让用户知道输入了多少字符；不设置 mask 则完全不显示任何内容。

重要：永远不要把 password 的值写到日志或 stdout。

### editor：编辑器

```typescript
import { editor } from '@inquirer/prompts'

const commitMessage = await editor({
  message: '编辑提交信息',
  default: 'feat: add new feature\n\n详细描述...',
  waitForUseInput: false,
  postfix: '.md',  // 临时文件扩展名，影响编辑器语法高亮
})
```

editor 组件会打开系统默认编辑器（由 `$EDITOR` 或 `$VISUAL` 环境变量决定），让用户编辑多行文本。关闭编辑器后返回编辑结果。

这是处理多行输入的标准方式——`git commit` 不带 `-m` 参数时就是打开编辑器。单行的 input 组件处理不了提交信息这种需要分标题和描述的内容。

## 加载态处理

AI 接口调用通常需要几秒到几十秒。这段时间如果终端毫无反馈，用户会以为程序卡死了。

### ora：Spinner

```bash
npm install ora
```

```typescript
import ora from 'ora'

const spinner = ora('正在扫描项目...').start()

try {
  const result = await scanProject(dir)
  spinner.succeed(`扫描完成，发现 ${result.totalFiles} 个文件`)
} catch (error) {
  spinner.fail(`扫描失败: ${(error as Error).message}`)
  process.exit(1)
}
```

ora 在终端中显示一个旋转的动画字符（⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏），告诉用户程序还在运行。`spinner.succeed()` 把动画替换为绿色的 ✓，`spinner.fail()` 替换为红色的 ✗。

几个实用 API：

```typescript
const spinner = ora('正在分析...').start()

// 更新提示文字（不中断动画）
spinner.text = '正在调用 AI 接口...'

// 更新提示文字（带前缀信息）
spinner.prefixText = '[1/3]'

// 临时输出一行信息（不破坏 spinner）
spinner.info('跳过了 node_modules 目录')

// 警告
spinner.warn('文件过大，可能需要较长时间')

// 停止但不显示状态图标
spinner.stop()
```

**关键注意事项**：spinner 运行期间不要用 `console.log`。ora 通过控制终端光标来实现动画效果，`console.log` 会破坏光标位置，导致输出混乱。要在 spinner 运行期间输出信息，用 `spinner.info()` 或先 `spinner.stop()`。

### 封装异步操作

在 repox 中，AI 调用和 Git 操作是最常见的耗时操作。封装一个通用的 spinner 函数：

```typescript
// src/utils/spinner.ts
import ora, { type Ora } from 'ora'

interface SpinnerTask<T> {
  text: string
  task: (spinner: Ora) => Promise<T>
  successText?: string | ((result: T) => string)
  failText?: string
}

export async function withSpinner<T>(config: SpinnerTask<T>): Promise<T> {
  // 非 TTY 环境不显示 spinner
  if (!process.stderr.isTTY) {
    console.error(config.text)
    return config.task(ora({ isSilent: true }))
  }

  const spinner = ora(config.text).start()

  try {
    const result = await config.task(spinner)

    const successMsg = typeof config.successText === 'function'
      ? config.successText(result)
      : config.successText || config.text.replace('正在', '') + '完成'

    spinner.succeed(successMsg)
    return result
  } catch (error) {
    spinner.fail(config.failText || `失败: ${(error as Error).message}`)
    throw error
  }
}
```

使用方式：

```typescript
const result = await withSpinner({
  text: '正在扫描项目...',
  task: async (spinner) => {
    const files = await scanFiles(dir)
    spinner.text = `正在分析 ${files.length} 个文件...`
    return analyzeFiles(files)
  },
  successText: (result) => `扫描完成，发现 ${result.totalFiles} 个文件`,
})
```

注意 `withSpinner` 中 spinner 输出到 **stderr**（ora 默认写 stderr）。前面提过，日志和加载动画都属于"给人看的辅助信息"，应该走 stderr，不干扰 stdout 的数据流。

### 进度条

对于有明确进度的操作（如扫描大量文件），进度条比 spinner 更合适：

```typescript
// src/utils/progress.ts
export function createProgressBar(total: number, label: string = ''): {
  update: (current: number) => void
  finish: () => void
} {
  const width = 30

  function render(current: number): void {
    if (!process.stderr.isTTY) return

    const percent = Math.min(current / total, 1)
    const filled = Math.round(width * percent)
    const empty = width - filled
    const bar = '█'.repeat(filled) + '░'.repeat(empty)
    const percentStr = (percent * 100).toFixed(0).padStart(3)

    process.stderr.write(`\r${label} ${bar} ${percentStr}% (${current}/${total})`)
  }

  return {
    update(current: number) {
      render(current)
    },
    finish() {
      if (process.stderr.isTTY) {
        process.stderr.write('\n')
      }
    },
  }
}
```

使用方式：

```typescript
const progress = createProgressBar(files.length, '扫描中')

for (let i = 0; i < files.length; i++) {
  await processFile(files[i])
  progress.update(i + 1)
}

progress.finish()
```

`\r` 是回车符，把光标移到行首，覆盖之前的内容。这就是终端中实现"原地更新"的原理——不是真的"动画"，而是不断覆盖同一行。

也可以用成熟的库如 `cli-progress`，但对于 repox 这种场景，上面几十行代码就够了。引入额外依赖需要有足够的理由。

## TTY 检测与管道兼容

这是 CLI 开发中最容易忽略、一旦忽略就会出严重问题的地方。

### 问题场景

```bash
# 场景 1：正常使用，一切正常
repox init

# 场景 2：管道使用，程序卡死
echo '{}' | repox init

# 场景 3：重定向使用，输出包含乱码（ANSI 转义码）
repox scan > result.txt
```

场景 2 卡死是因为 `@inquirer/prompts` 的交互组件试图从 stdin 读取键盘输入，但 stdin 连接的是管道，不是键盘。场景 3 的乱码是因为颜色和 spinner 的 ANSI 转义码被写入了文件。

### 检测方法

```typescript
// stdin 是否连接到终端
process.stdin.isTTY   // true: 终端直接运行; false/undefined: 管道或重定向

// stdout 是否连接到终端
process.stdout.isTTY  // true: 输出到终端; false/undefined: 管道或重定向

// stderr 是否连接到终端
process.stderr.isTTY  // true: 输出到终端; false/undefined: 重定向
```

三个流的 TTY 状态是独立的：

```bash
repox scan              # stdin=TTY, stdout=TTY, stderr=TTY
repox scan | jq .       # stdin=TTY, stdout=pipe, stderr=TTY
echo | repox scan       # stdin=pipe, stdout=TTY, stderr=TTY
repox scan > out.txt    # stdin=TTY, stdout=file, stderr=TTY
repox scan 2>/dev/null  # stdin=TTY, stdout=TTY, stderr=file
```

### 完整的兼容策略

```typescript
// src/utils/env.ts

/** 是否可以显示交互式提示 */
export function isInteractive(): boolean {
  // stdin 必须是 TTY（能读键盘输入）
  // stdout 必须是 TTY（能显示交互组件的渲染结果）
  // 没有设置 CI 环境变量
  return !!(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI)
}

/** 是否可以显示颜色 */
export function supportsColor(): boolean {
  // NO_COLOR 标准: https://no-color.org/
  if (process.env.NO_COLOR !== undefined) return false
  // FORCE_COLOR 可以强制启用
  if (process.env.FORCE_COLOR !== undefined) return true
  // stdout 必须是 TTY
  return !!process.stdout.isTTY
}

/** 是否可以显示 spinner 动画 */
export function supportsAnimation(): boolean {
  // spinner 写 stderr，所以检查 stderr
  return !!process.stderr.isTTY && !process.env.CI
}

/** 获取终端宽度 */
export function getTerminalWidth(): number {
  return process.stdout.columns || 80
}
```

在 repox 的各个模块中使用这些工具函数：

```typescript
// 交互式提示
import { isInteractive } from '../utils/env.js'

async function getModel(options: { model?: string }): Promise<string> {
  if (options.model) return options.model

  if (!isInteractive()) {
    // 非交互环境，使用默认值
    return 'doubao-1-5-pro-32k-250115'
  }

  return select({
    message: '选择 AI 模型',
    choices: [/* ... */],
  })
}
```

```typescript
// 颜色输出
import { supportsColor } from '../utils/env.js'

function colorize(text: string, color: string): string {
  if (!supportsColor()) return text

  const colors: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
  }

  return `${colors[color] || ''}${text}${colors.reset}`
}

// 用法
console.log(colorize('✓ 扫描完成', 'green'))
// TTY: 绿色的 "✓ 扫描完成"
// 管道: 纯文本 "✓ 扫描完成"
```

生产环境中，颜色处理推荐用 `chalk` 或 `picocolors` 库——它们自动处理 TTY 检测和 `NO_COLOR` 环境变量，不需要手写上面的逻辑。但理解底层原理很重要，便于调试问题。

### CI 环境检测

CI/CD 环境通常没有 TTY，且有特殊的输出需求。常见 CI 平台会设置特定的环境变量：

```typescript
export function isCI(): boolean {
  return !!(
    process.env.CI ||           // 通用标准（GitHub Actions, GitLab CI, etc.）
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL
  )
}
```

在 CI 中，repox 应该：
- 不启动任何交互式提示
- 不显示 spinner 动画（CI 日志不支持 `\r` 覆盖）
- 输出结构化格式（JSON），便于后续步骤解析
- 所有必要参数通过命令行或环境变量传入

## 实战：repox init 交互式向导

把第 2 章中简陋的 init 命令改造成完整的交互式向导。

```typescript
// src/commands/init.ts
import { Command } from 'commander'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { input, select, checkbox, confirm } from '@inquirer/prompts'
import ora from 'ora'
import { isInteractive } from '../utils/env.js'

interface RepoxConfig {
  name: string
  model: string
  language: string
  commitFormat: string
  features: string[]
  exclude: string[]
}

const DEFAULT_CONFIG: RepoxConfig = {
  name: basename(process.cwd()),
  model: 'doubao-1-5-pro-32k-250115',
  language: 'zh-CN',
  commitFormat: 'conventional',
  features: ['scan', 'explain', 'review', 'commit'],
  exclude: ['node_modules', 'dist', '.git', '.next', 'build'],
}

function detectProjectType(): { framework: string; packageManager: string } {
  let framework = 'unknown'
  let packageManager = 'npm'

  // 检测包管理器
  if (existsSync('bun.lockb') || existsSync('bun.lock')) packageManager = 'bun'
  else if (existsSync('pnpm-lock.yaml')) packageManager = 'pnpm'
  else if (existsSync('yarn.lock')) packageManager = 'yarn'

  // 检测框架
  if (existsSync('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps['next']) framework = 'Next.js'
      else if (deps['nuxt']) framework = 'Nuxt'
      else if (deps['vue']) framework = 'Vue'
      else if (deps['react']) framework = 'React'
      else if (deps['express']) framework = 'Express'
      else if (deps['fastify']) framework = 'Fastify'
    } catch {
      // package.json 解析失败，忽略
    }
  } else if (existsSync('go.mod')) {
    framework = 'Go'
  } else if (existsSync('Cargo.toml')) {
    framework = 'Rust'
  } else if (existsSync('requirements.txt') || existsSync('pyproject.toml')) {
    framework = 'Python'
  }

  return { framework, packageManager }
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('初始化 repox 项目配置')
    .option('--name <name>', '项目名称')
    .option('--model <model>', 'AI 模型')
    .option('--language <lang>', '输出语言')
    .option('--force', '覆盖已有配置')
    .action(async (options) => {
      const configPath = resolve('.repox.json')

      // 检查已有配置
      if (existsSync(configPath) && !options.force) {
        console.error('.repox.json 已存在。使用 --force 覆盖。')
        process.exit(1)
      }

      // 项目检测
      const spinner = ora('正在检测项目类型...').start()
      const detected = detectProjectType()
      spinner.succeed(
        detected.framework !== 'unknown'
          ? `检测到 ${detected.framework} 项目 (${detected.packageManager})`
          : `包管理器: ${detected.packageManager}`
      )

      let config: RepoxConfig

      if (isInteractive()) {
        // 交互式模式
        config = await interactiveInit(options, detected)
      } else {
        // 非交互模式：使用参数 + 默认值
        config = {
          ...DEFAULT_CONFIG,
          name: options.name || DEFAULT_CONFIG.name,
          model: options.model || DEFAULT_CONFIG.model,
          language: options.language || DEFAULT_CONFIG.language,
        }
      }

      // 写入配置
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

      console.log('')
      console.log(`配置已写入 ${configPath}`)
      console.log('')
      printConfig(config)
      console.log('')
      console.log('下一步:')
      console.log('  repox scan       扫描项目结构')
      console.log('  repox explain    解释代码文件')
      console.log('  repox config     修改配置')
    })
}

async function interactiveInit(
  options: Record<string, string | undefined>,
  detected: { framework: string; packageManager: string },
): Promise<RepoxConfig> {
  console.log('')

  // 项目名称
  const name = options.name || await input({
    message: '项目名称',
    default: DEFAULT_CONFIG.name,
    validate: (v) => v.trim().length > 0 || '项目名称不能为空',
  })

  // AI 模型选择
  const model = options.model || await select({
    message: '默认 AI 模型',
    choices: [
      { name: 'doubao-1-5-pro-32k-250115 (豆包，推荐)', value: 'doubao-1-5-pro-32k-250115' },
      { name: 'gpt-4o (OpenAI)', value: 'gpt-4o' },
      { name: 'claude-sonnet-4-20250514 (Anthropic)', value: 'claude-sonnet-4-20250514' },
      { name: 'deepseek-v3 (DeepSeek)', value: 'deepseek-v3' },
    ],
    default: 'doubao-1-5-pro-32k-250115',
  })

  // 输出语言
  const language = options.language || await select({
    message: '输出语言',
    choices: [
      { name: '中文', value: 'zh-CN' },
      { name: 'English', value: 'en' },
      { name: '日本語', value: 'ja' },
    ],
    default: 'zh-CN',
  })

  // 提交信息格式
  const commitFormat = await select({
    message: '提交信息风格',
    choices: [
      {
        name: 'Conventional Commits (feat: / fix: / ...)',
        value: 'conventional',
      },
      {
        name: '简洁风格 (直接描述变更)',
        value: 'simple',
      },
    ],
    default: 'conventional',
  })

  // 启用的功能
  const features = await checkbox({
    message: '启用的功能',
    choices: [
      { name: '项目扫描 (scan)', value: 'scan', checked: true },
      { name: '代码解释 (explain)', value: 'explain', checked: true },
      { name: '代码审查 (review)', value: 'review', checked: true },
      { name: 'AI 提交 (commit)', value: 'commit', checked: true },
    ],
    validate: (items) => items.length > 0 || '至少选择一个功能',
  })

  // 排除目录
  const defaultExcludes = [...DEFAULT_CONFIG.exclude]
  if (detected.framework === 'Next.js') defaultExcludes.push('.next')

  const excludeStr = await input({
    message: '排除的目录 (逗号分隔)',
    default: defaultExcludes.join(', '),
  })
  const exclude = excludeStr.split(',').map(s => s.trim()).filter(Boolean)

  // 确认
  console.log('')
  printConfig({ name, model, language, commitFormat, features, exclude })
  console.log('')

  const confirmed = await confirm({
    message: '确认以上配置？',
    default: true,
  })

  if (!confirmed) {
    console.log('已取消')
    process.exit(0)
  }

  return { name, model, language, commitFormat, features, exclude }
}

function printConfig(config: RepoxConfig): void {
  console.log('  项目名称:   ' + config.name)
  console.log('  AI 模型:    ' + config.model)
  console.log('  输出语言:   ' + config.language)
  console.log('  提交风格:   ' + config.commitFormat)
  console.log('  启用功能:   ' + config.features.join(', '))
  console.log('  排除目录:   ' + config.exclude.join(', '))
}
```

这个实现体现了几个关键设计：

**1. 检测先行**。在询问用户之前，先自动检测项目类型。检测结果会影响默认值（比如 Next.js 项目自动排除 `.next` 目录）。用户看到合理的默认值后，大多数情况直接回车就行——最快路径只需要按 6 次回车。

**2. 混合模式的完整实现**。每个配置项都是 `options.xxx || await prompt()` 的模式。`repox init --model gpt-4o` 跳过模型选择但仍然询问其他配置；`repox init --name foo --model gpt-4o --language en` 则几乎不需要交互。

**3. 确认步骤**。所有配置收集完后，打印预览并要求确认。这是防御性设计——万一用户不小心选错了，有机会取消重来。

**4. 非交互降级**。CI 环境中直接使用默认值，不会卡死。

## 实战：repox commit 确认流程

commit 命令比 init 更复杂，因为它涉及 Git 操作和 AI 生成，需要更细致的交互设计。

```typescript
// src/commands/commit.ts
import { Command } from 'commander'
import { execSync } from 'node:child_process'
import { confirm, select, editor } from '@inquirer/prompts'
import { withSpinner } from '../utils/spinner.js'
import { isInteractive } from '../utils/env.js'

export function registerCommitCommand(program: Command): void {
  program
    .command('commit')
    .description('AI 生成提交信息并提交')
    .option('-m, --message <message>', '直接指定提交信息（跳过 AI 生成）')
    .option('--dry-run', '只生成提交信息，不执行提交')
    .option('--format <style>', '提交信息风格', 'conventional')
    .option('--no-verify', '跳过 Git hooks')
    .action(async (options) => {
      // 1. 前置检查
      assertGitRepo()
      const staged = getStagedDiff()

      if (!staged.trim()) {
        console.error('没有暂存的变更。')
        console.error('')
        console.error('暂存方式:')
        console.error('  git add <file>       暂存指定文件')
        console.error('  git add -p           交互式暂存')
        console.error('  git add .            暂存所有变更')
        process.exit(1)
      }

      // 2. 显示变更摘要
      const stats = getStagedStats()
      console.log('暂存的变更:')
      console.log(`  ${stats.files} 个文件, +${stats.additions} -${stats.deletions}`)
      console.log('')

      // 3. 生成或获取提交信息
      let message: string

      if (options.message) {
        // 用户直接指定了提交信息
        message = options.message
      } else {
        // AI 生成提交信息
        message = await withSpinner({
          text: '正在生成提交信息...',
          task: async () => {
            // 实际项目中这里调用 AI 接口
            // 这里用模拟实现
            await sleep(1000)
            return generateMockCommitMessage(staged)
          },
          successText: '提交信息已生成',
        })
      }

      console.log('')
      console.log('提交信息:')
      console.log(`  ${message.split('\n').join('\n  ')}`)
      console.log('')

      // 4. dry-run 模式直接退出
      if (options.dryRun) {
        console.log('（dry-run 模式，未执行提交）')
        return
      }

      // 5. 交互式确认
      if (isInteractive()) {
        const action = await select({
          message: '下一步',
          choices: [
            { name: '确认提交', value: 'commit' },
            { name: '编辑提交信息', value: 'edit' },
            { name: '重新生成', value: 'regenerate' },
            { name: '取消', value: 'cancel' },
          ],
        })

        switch (action) {
          case 'edit':
            message = await editor({
              message: '编辑提交信息',
              default: message,
            })
            break
          case 'regenerate':
            message = await withSpinner({
              text: '正在重新生成...',
              task: async () => {
                await sleep(1000)
                return generateMockCommitMessage(staged)
              },
              successText: '新的提交信息已生成',
            })
            console.log('')
            console.log('提交信息:')
            console.log(`  ${message.split('\n').join('\n  ')}`)
            console.log('')

            const confirmRegenerated = await confirm({
              message: '使用这条提交信息？',
              default: true,
            })
            if (!confirmRegenerated) {
              console.log('已取消')
              return
            }
            break
          case 'cancel':
            console.log('已取消')
            return
        }
      }

      // 6. 执行提交
      const verifyFlag = options.verify === false ? '--no-verify' : ''
      try {
        // 提交信息可能包含特殊字符，用 stdin 传入比命令行参数更安全
        execSync(`git commit ${verifyFlag} -F -`, {
          input: message,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        console.log('提交成功')
      } catch (error) {
        console.error(`提交失败: ${(error as Error).message}`)
        process.exit(1)
      }
    })
}

function assertGitRepo(): void {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' })
  } catch {
    console.error('错误: 当前目录不是 Git 仓库')
    process.exit(1)
  }
}

function getStagedDiff(): string {
  return execSync('git diff --staged', { encoding: 'utf-8' })
}

function getStagedStats(): { files: number; additions: number; deletions: number } {
  const output = execSync('git diff --staged --numstat', { encoding: 'utf-8' })
  const lines = output.trim().split('\n').filter(Boolean)

  let additions = 0
  let deletions = 0

  for (const line of lines) {
    const [add, del] = line.split('\t')
    if (add !== '-') additions += parseInt(add, 10)
    if (del !== '-') deletions += parseInt(del, 10)
  }

  return { files: lines.length, additions, deletions }
}

function generateMockCommitMessage(diff: string): string {
  // 模拟 AI 生成（后续章节替换为真实实现）
  const fileCount = (diff.match(/^diff --git/gm) || []).length
  return `feat: update ${fileCount} file${fileCount > 1 ? 's' : ''}\n\nAI-generated commit message placeholder`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

commit 命令的交互设计有几个值得注意的地方：

**变更摘要前置**。在生成提交信息之前，先展示变更统计（文件数、增删行数）。这让用户确认暂存的内容是正确的——发现不对可以直接 Ctrl+C。

**四选一操作菜单**。生成提交信息后不是简单的 Y/N 确认，而是提供四个选项：确认、编辑、重新生成、取消。这比 `gh pr create` 的流程更灵活——AI 生成的内容经常需要微调，"编辑"选项比"取消→手动 git commit"高效得多。

**安全的提交信息传递**。用 `git commit -F -`（从 stdin 读取）而不是 `git commit -m "message"`。原因是提交信息可能包含引号、换行、特殊字符，通过命令行参数传递需要复杂的转义处理，而 stdin 传递完全不需要转义。

**非交互环境自动提交**。CI 中直接执行提交，不弹确认。配合 `--message` 参数可以实现全自动化：

```bash
# CI 中使用
repox commit --message "$(repox commit --dry-run --format json | jq -r .message)"
```

## Ctrl+C 与交互清理

交互式组件运行时，用户按 Ctrl+C 需要特殊处理。`@inquirer/prompts` 在收到 SIGINT 时会抛出一个 `ExitPromptError` 异常（旧版本中是 `CancelledPrompt`）。如果不捕获，Node.js 会输出一段不友好的堆栈跟踪。

```typescript
import { ExitPromptError } from '@inquirer/prompts'

try {
  const model = await select({ message: '选择模型', choices: [/* ... */] })
} catch (error) {
  if (error instanceof ExitPromptError) {
    // 用户按了 Ctrl+C，静默退出
    console.log('')  // 换行，避免终端提示符和 spinner 文字粘在一起
    process.exit(130)
  }
  throw error  // 其他错误继续抛出
}
```

可以封装成一个全局的处理逻辑，避免每个交互点都写 try-catch：

```typescript
// src/utils/prompt.ts
import { ExitPromptError } from '@inquirer/prompts'

export function handlePromptError(error: unknown): never {
  if (error instanceof ExitPromptError) {
    console.log('')
    process.exit(130)
  }
  throw error
}

// 在命令的 action 中使用
.action(async (options) => {
  try {
    await interactiveFlow(options)
  } catch (error) {
    handlePromptError(error)
  }
})
```

更优雅的方案是在 `cli.ts` 的顶层统一处理，这样每个命令都不需要关心 Ctrl+C 逻辑：

```typescript
// src/cli.ts
import { ExitPromptError } from '@inquirer/prompts'

export function run(argv: string[]): void {
  const program = createProgram()

  program.parseAsync(argv).catch((error) => {
    if (error instanceof ExitPromptError) {
      process.exit(130)
    }
    console.error(error.message)
    process.exit(1)
  })
}
```

`parseAsync` 返回 Promise，用 `.catch()` 统一处理所有命令中未捕获的异常。这比 `parse`（同步）更适合有异步操作的 CLI。

## 小结

这一章完成了 repox 的交互式体验建设，核心内容：

- **三种交互模式**。纯参数模式面向自动化，纯交互模式面向向导，混合 fallback 模式兼顾两者。repox 全面采用混合模式，`options.value || await prompt()` 是核心模式。
- **@inquirer/prompts 组件**。input、select、checkbox、confirm、password、editor 覆盖了 CLI 交互的所有常见场景。validate 做输入校验，transformer 做实时反馈。
- **加载态**。ora spinner 处理耗时操作的用户体验，`withSpinner` 封装简化使用。进度条用于有明确进度的场景。所有加载态输出到 stderr，不干扰 stdout 数据。
- **TTY 检测**。`process.stdin.isTTY` 和 `process.stdout.isTTY` 是最关键的两个判断。非 TTY 环境必须禁用交互组件、禁用颜色、禁用动画。`isInteractive()`、`supportsColor()`、`supportsAnimation()` 三个工具函数覆盖所有判断需求。
- **实战验证**。`repox init` 展示了完整的交互式向导模式——检测项目类型、逐步询问配置、预览确认。`repox commit` 展示了 AI 生成内容的交互确认流程——生成、预览、四选一操作。两个命令都完整支持非交互降级。

下一章将进入输出层的设计——颜色、排版、表格、JSON 结构化输出，以及如何让同一份数据在不同终端环境下都呈现最佳效果。

## 动手试一试

1. 给 `repox init` 添加一个 `--template <name>` 选项。当传入模板名时跳过交互式选择，直接使用预设配置
2. 实现 TTY 检测降级：当 `process.stdin.isTTY` 为 false 时（比如在 CI 中），自动使用默认值而不弹出交互提示
3. 在 `repox commit` 的确认环节，增加一个"编辑"选项，让用户可以手动修改 AI 生成的 commit message
