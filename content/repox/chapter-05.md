# 第 5 章 配置管理

CLI 工具的配置系统决定了它的灵活性。配置太少，工具变成死板的一刀切；配置太多，用户被选项淹没。这一章讲清楚 CLI 配置的分层模型、文件格式选型、自动发现机制、校验策略，以及 repox 的完整实现。

## 5.1 CLI 的配置哲学

"约定优于配置"（Convention over Configuration）是 Rails 时代提出的理念，放到 CLI 领域同样成立——一个好的 CLI 工具应该零配置即可使用，但允许通过配置调整行为。

具体原则：

**开箱即用。** `repox scan` 不需要任何配置就能跑。默认的 AI 模型、默认的输出格式、默认的日志级别——所有选项都有合理的默认值。用户安装后第一秒就能用，而不是先花五分钟写配置文件。

**渐进式配置。** 用户的配置需求是渐进增长的：刚开始用默认值就够了；用一段时间后想改默认输出格式；团队使用时想统一 AI 模型配置。配置系统要支持这种从零到多的过程，不应该强迫用户一开始就面对完整的配置项。

**就近原则。** 项目级配置覆盖全局配置，命令行参数覆盖所有配置。这和 CSS 的优先级类似——越"近"的配置优先级越高。用户在某个项目里写了 `.repoxrc`，那这个项目里 repox 的行为就按这个配置来，不影响其他项目。

**可预测性。** 用户应该能随时查看"当前生效的是什么配置"。配置来源要透明——到底是默认值、全局配置、项目配置还是环境变量在起作用？`repox config list` 解决这个需求。

## 5.2 三层配置模型

repox 的配置优先级从低到高：

```
默认值 < 全局配置(~/.config/repox/) < 项目配置(.repoxrc) < 环境变量 < 命令行参数
```

如果你用过 Vite，这个模型很眼熟：`.env` 文件是默认值，`.env.local` 是本地覆盖，`vite.config.ts` 里的 `define` 是编译时注入，`import.meta.env` 是运行时读取。CLI 的配置层级和前端构建工具的环境变量体系本质上是同一个设计模式——越近的配置优先级越高。

每一层的定位和使用场景：

### 第 1 层：默认值

硬编码在代码里，保证工具在完全无配置时也能正常运行。

```typescript
// 通过 zod schema 的 .default() 定义
export const configSchema = z.object({
  ai: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
    model: z.string().default('doubao-1-5-pro-32k-250115'),
  }).default({}),

  github: z.object({
    token: z.string().optional(),
    apiUrl: z.string().default('https://api.github.com'),
  }).default({}),

  output: z.object({
    format: z.enum(['table', 'json', 'plain']).default('table'),
    color: z.boolean().default(true),
    language: z.enum(['zh', 'en']).default('zh'),
  }).default({}),

  plugins: z.array(z.string()).default([]),
})
```

默认值有一个重要约束：**不能依赖外部状态**。不能默认读某个文件、不能默认请求某个 API。默认值必须是纯粹的静态数据，否则无配置时工具可能因为外部依赖不可用而挂掉。

### 第 2 层：全局配置

存储在 `~/.config/repox/config.json`，影响当前用户所有项目中的 repox 行为。典型的全局配置内容：

```json
{
  "ai": {
    "model": "gpt-4o"
  },
  "output": {
    "language": "en"
  }
}
```

全局配置文件不需要包含所有字段——只写需要覆盖默认值的部分就够了。合并时采用深度合并（deep merge），未指定的字段保持默认值。

### 第 3 层：项目配置

存储在项目根目录的 `.repoxrc` 或 `.repoxrc.json`，影响当前项目中的 repox 行为。典型用途是团队统一配置——把 `.repoxrc` 提交到版本库，所有成员的 repox 在这个项目里行为一致。

```json
{
  "ai": {
    "model": "doubao-1-5-pro-32k-250115"
  },
  "output": {
    "format": "json"
  }
}
```

### 第 4 层：环境变量

优先级高于配置文件。适合 CI/CD 环境——不想把 API Key 写进配置文件，但需要在运行时注入。

repox 遵循的环境变量命名规范：

```bash
REPOX_AI_API_KEY=sk-xxx repox explain "这段代码做什么"
REPOX_AI_BASE_URL=https://api.openai.com/v1 repox commit
REPOX_AI_MODEL=gpt-4o repox review
GITHUB_TOKEN=ghp_xxx repox scan  # GitHub Token 直接用通用变量名
```

命名规则是 `REPOX_` 前缀 + 配置路径的大写下划线形式。`GITHUB_TOKEN` 是个例外——因为太多工具都用这个变量名，沿用社区惯例比自造一个更友好。

### 第 5 层：命令行参数

优先级最高。`repox scan --format json` 会覆盖配置文件里的 `output.format` 设置。命令行参数由 Commander 处理，不经过配置合并流程——它在命令执行时直接使用，不写入任何配置文件。

### 合并流程

```typescript
export async function loadConfig(cwd?: string): Promise<RepoxConfig> {
  const explorer = cosmiconfig('repox', {
    searchPlaces: [
      '.repoxrc',
      '.repoxrc.json',
      '.repoxrc.yaml',
      '.repoxrc.yml',
      'repox.config.js',
    ],
  })

  // 读取全局配置
  let globalConfig: Record<string, unknown> = {}
  const globalPath = getGlobalConfigPath()
  if (fs.existsSync(globalPath)) {
    try {
      const content = fs.readFileSync(globalPath, 'utf-8')
      globalConfig = JSON.parse(content)
    } catch {
      // 全局配置解析失败时忽略
    }
  }

  // 搜索项目配置
  let projectConfig: Record<string, unknown> = {}
  try {
    const result = await explorer.search(cwd)
    if (result && !result.isEmpty) {
      projectConfig = result.config as Record<string, unknown>
    }
  } catch {
    // 项目配置搜索失败时忽略
  }

  // 深度合并：默认 < 全局 < 项目
  const merged = deepMerge(
    JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    globalConfig,
    projectConfig,
  )

  // 环境变量覆盖
  if (process.env.REPOX_AI_API_KEY) {
    (merged as any).ai ??= {}
    ;(merged as any).ai.apiKey = process.env.REPOX_AI_API_KEY
  }
  if (process.env.REPOX_AI_BASE_URL) {
    (merged as any).ai ??= {}
    ;(merged as any).ai.baseUrl = process.env.REPOX_AI_BASE_URL
  }
  if (process.env.GITHUB_TOKEN) {
    (merged as any).github ??= {}
    ;(merged as any).github.token = process.env.GITHUB_TOKEN
  }

  // 用 zod 校验最终结果
  return configSchema.parse(merged)
}
```

几个细节：

- `JSON.parse(JSON.stringify(DEFAULT_CONFIG))` 做深拷贝，避免 `deepMerge` 修改默认值对象。有些人会用 `structuredClone()`，但 `JSON.parse(JSON.stringify())` 更兼容，且配置对象不含函数或 Symbol。
- 配置文件解析失败时静默忽略（`catch {}` 空块）。配置文件损坏不应该让工具完全不可用——回退到默认值仍然能工作，只是行为可能不符合用户预期。但后面会讲到更好的做法。
- 环境变量覆盖放在深度合并之后、zod 校验之前。这样环境变量的值也会经过 schema 校验。

### deepMerge 的实现

深度合并看似简单，但边界情况很多：

```typescript
function deepMerge(
  ...objects: Record<string, unknown>[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        result[key] !== null &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        )
      } else {
        result[key] = value
      }
    }
  }
  return result
}
```

关键决策：**数组不做合并，直接覆盖**。如果默认的 `plugins` 是 `['a', 'b']`，项目配置写了 `plugins: ['c']`，最终结果是 `['c']` 而不是 `['a', 'b', 'c']`。原因是数组合并的语义不确定——是追加？是替换？是去重合并？不同场景需求不同，与其猜错不如让用户完整指定。

## 5.3 配置文件格式选型

CLI 工具常见的配置文件格式有 JSON、TOML、YAML 和 JavaScript。每种格式各有优劣：

**JSON** — repox 的选择。

优点：无需额外解析器（Node.js 原生支持）、格式严格不易出错、IDE 支持好（自动补全、语法检查）。

缺点：不支持注释（JSON5 支持但不通用）、嵌套深时可读性差。

```json
{
  "ai": {
    "model": "gpt-4o",
    "baseUrl": "https://api.openai.com/v1"
  }
}
```

**TOML** — Rust 生态的标配，近年在 Node.js 生态也越来越常见。

优点：支持注释、扁平化写法可读性好、不会遇到 YAML 的缩进问题。

缺点：深嵌套结构表达力不如 JSON/YAML、Node.js 需要额外解析库。

```toml
[ai]
model = "gpt-4o"
baseUrl = "https://api.openai.com/v1"
```

**YAML** — Kubernetes 生态用得多，但争议也大。

优点：支持注释、格式简洁。

缺点：缩进敏感（容易出错）、类型推断有坑（`Norway: NO` 会被解析成 `false`）、规范过于复杂。

```yaml
ai:
  model: gpt-4o
  baseUrl: https://api.openai.com/v1
```

**JavaScript** — Next.js、ESLint 等工具的选择。

优点：可以写逻辑（条件配置、环境判断）、支持注释、TypeScript 类型提示。

缺点：有安全风险（加载配置等于执行代码）、不容易序列化（`repox config set` 无法修改 JS 配置）。

```javascript
export default {
  ai: {
    model: process.env.NODE_ENV === 'production' ? 'gpt-4o' : 'gpt-4o-mini',
  },
}
```

repox 选择 JSON 作为主要格式，但通过 cosmiconfig 支持多种格式。用户如果偏好 YAML 或 JS 配置，建对应的文件就行。这个决策在下一节展开。

## 5.4 cosmiconfig：配置自动发现

cosmiconfig 是 Node.js 生态最流行的配置搜索库，被 ESLint、Prettier、Stylelint、Babel 等工具广泛使用。它解决的问题是：**在不同位置、不同格式的配置文件中自动找到匹配的那一个**。

基本用法：

```typescript
import { cosmiconfig } from 'cosmiconfig'

const explorer = cosmiconfig('repox', {
  searchPlaces: [
    '.repoxrc',
    '.repoxrc.json',
    '.repoxrc.yaml',
    '.repoxrc.yml',
    'repox.config.js',
  ],
})

// 从当前目录向上搜索
const result = await explorer.search()

if (result) {
  console.log('找到配置文件:', result.filepath)
  console.log('配置内容:', result.config)
} else {
  console.log('未找到配置文件')
}
```

cosmiconfig 的搜索行为：

1. 从指定目录（默认 `process.cwd()`）开始
2. 按 `searchPlaces` 列表的顺序在当前目录找配置文件
3. 如果没找到，向上一级目录继续搜索
4. 一直搜到文件系统根目录为止
5. 找到第一个匹配的就停下来

这个"向上搜索"机制非常实用。假设项目结构是：

```
my-monorepo/
├── .repoxrc          ← 根目录的配置
├── packages/
│   ├── app/
│   │   ├── .repoxrc  ← app 包自己的配置
│   │   └── src/
│   └── lib/
│       └── src/
```

在 `packages/app/src/` 目录运行 repox，cosmiconfig 会找到 `packages/app/.repoxrc`。在 `packages/lib/src/` 运行，由于 lib 没有自己的配置，cosmiconfig 会一路向上找到根目录的 `.repoxrc`。

cosmiconfig 还自动处理不同格式的解析：

- 无扩展名的 `.repoxrc` — 先尝试 JSON，失败了尝试 YAML
- `.repoxrc.json` — JSON 解析
- `.repoxrc.yaml` / `.repoxrc.yml` — YAML 解析
- `repox.config.js` — JavaScript 模块加载

这就是为什么 repox 虽然主推 JSON 格式，但用户想用 YAML 也完全可以——cosmiconfig 在底层默默处理了格式差异。

注意 cosmiconfig v9 已经原生支持 ESM。如果你在 `"type": "module"` 项目中遇到 `require is not defined` 错误，确认安装的是 v9 或更高版本。旧版本需要手动导入 `cosmiconfig/dist/esm`。

### 缓存机制

cosmiconfig 内置缓存。同一个目录的搜索结果会被缓存，重复调用 `search()` 不会重复读取文件系统。需要强制刷新时：

```typescript
explorer.clearCaches()
const freshResult = await explorer.search()
```

## 5.5 XDG 规范：配置存在哪里

全局配置存在用户的 home 目录下，但具体存哪里有讲究。早期的 Unix 程序喜欢在 home 目录根下建点文件——`.bashrc`、`.vimrc`、`.gitconfig`——这导致 `ls -a ~` 能看到几十个点文件，杂乱不堪。

XDG Base Directory Specification 解决了这个问题。它定义了几个标准目录：

| 环境变量 | 默认路径 | 用途 |
|----------|----------|------|
| `XDG_CONFIG_HOME` | `~/.config` | 配置文件 |
| `XDG_DATA_HOME` | `~/.local/share` | 持久数据 |
| `XDG_CACHE_HOME` | `~/.cache` | 缓存数据 |
| `XDG_STATE_HOME` | `~/.local/state` | 状态数据（日志等） |

repox 遵循 XDG 规范，把配置存在 `~/.config/repox/` 下：

```typescript
export function getGlobalConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME
  const base = xdgConfig || path.join(os.homedir(), '.config')
  return path.join(base, 'repox')
}
```

代码逻辑：先检查 `XDG_CONFIG_HOME` 环境变量是否被设置（有些用户会自定义配置目录位置），没设置就用默认的 `~/.config`。

为什么要遵循 XDG 规范？

1. **整洁。** `~/.config/repox/config.json` 比 `~/.repoxrc` 更有组织性。所有 CLI 工具的配置都在 `~/.config/` 下，每个工具一个子目录。
2. **可迁移。** 要备份所有工具的配置，只需备份 `~/.config/` 目录。
3. **可定制。** 用户可以通过设置 `XDG_CONFIG_HOME` 把配置挪到别的地方（比如 Dropbox 同步目录）。
4. **符合社区预期。** 越来越多的 CLI 工具遵循 XDG，不遵循的反而显得格格不入。

macOS 的情况稍微特殊——macOS 自己的配置习惯是 `~/Library/Application Support/`，但 CLI 工具普遍用 `~/.config/` 而不是 macOS 原生路径。这是因为 CLI 工具的用户群体更偏 Unix 习惯。

repox 全局配置目录的实际结构：

```
~/.config/repox/
├── config.json        ← 全局配置
└── credentials.json   ← 认证凭证（0600 权限）
```

`credentials.json` 存储 token 等敏感信息，权限设为 `0600`（仅当前用户可读写）。这是第 6 章的内容，这里先提一下——把配置和凭证分开存储是个好习惯，因为配置文件可能被分享（比如贴到文档里说"推荐这样配置"），但凭证绝对不能泄露。

## 5.6 配置校验：zod schema 驱动

配置文件是用户手写的，什么内容都可能出现：拼错字段名、值类型不对、嵌套层级错误。如果不做校验，这些错误会在运行时某个不可预测的地方爆炸，让用户一头雾水。

repox 用 zod 在配置加载时就做校验：

```typescript
import { z } from 'zod'

export const configSchema = z.object({
  ai: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
    model: z.string().default('doubao-1-5-pro-32k-250115'),
  }).default({}),

  github: z.object({
    token: z.string().optional(),
    apiUrl: z.string().default('https://api.github.com'),
  }).default({}),

  output: z.object({
    format: z.enum(['table', 'json', 'plain']).default('table'),
    color: z.boolean().default(true),
    language: z.enum(['zh', 'en']).default('zh'),
  }).default({}),

  plugins: z.array(z.string()).default([]),
})

export type RepoxConfig = z.infer<typeof configSchema>
```

zod 在配置管理中的三重价值：

### 1. 运行时校验

`configSchema.parse(merged)` 在配置加载时立即验证。如果用户写了 `"format": "xml"`，zod 会抛出明确的错误信息，指出 `format` 必须是 `table`、`json` 或 `plain` 之一。

```typescript
// 如果配置文件内容有问题，parse 会抛出 ZodError
try {
  return configSchema.parse(merged)
} catch (error) {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map(i =>
      `  ${i.path.join('.')}: ${i.message}`
    ).join('\n')
    throw new UserError(
      `配置文件格式错误:\n${issues}`,
      '运行 repox config reset 重置为默认配置',
    )
  }
  throw error
}
```

### 2. 类型推导

`z.infer<typeof configSchema>` 自动从 schema 推导出 TypeScript 类型。不需要手写一个 `interface RepoxConfig` 然后祈祷它和校验逻辑保持一致——schema 就是唯一的真相来源（Single Source of Truth）。

```typescript
// 自动推导出的类型等价于：
type RepoxConfig = {
  ai: {
    apiKey?: string
    baseUrl: string
    model: string
  }
  github: {
    token?: string
    apiUrl: string
  }
  output: {
    format: 'table' | 'json' | 'plain'
    color: boolean
    language: 'zh' | 'en'
  }
  plugins: string[]
}
```

### 3. 默认值填充

`.default()` 不只是标注"默认值是什么"，它在 `parse` 时会自动填充缺失字段。用户的配置文件只写了 `{ "ai": { "model": "gpt-4o" } }`，经过 `configSchema.parse()` 之后，所有其他字段都会被填上默认值。不需要手动遍历 schema 做缺省值合并。

## 5.7 案例拆解：Claude Code 的多层配置

Claude Code 的配置系统是多层合并的典范，它有五个配置来源：

```
默认值 < 企业策略 < 全局 settings < 项目 settings < 命令行参数
```

全局配置存储在 `~/.claude/settings.json`：

```json
{
  "permissions": {
    "allow": ["Bash(git:*)", "Read"],
    "deny": ["Bash(rm:*)"]
  },
  "apiKey": "sk-ant-..."
}
```

项目配置存储在 `.claude/settings.json`（项目根目录下）：

```json
{
  "permissions": {
    "allow": ["Bash(npm:*)"]
  }
}
```

企业配置存储在 `/etc/claude/settings.json`（系统级），由 IT 管理员部署，用于强制执行组织策略。

合并策略有几个值得注意的点：

**权限合并是加法。** 全局允许 `Bash(git:*)`，项目允许 `Bash(npm:*)`，最终结果是两者都允许。但 deny 规则的优先级高于 allow——如果全局 deny 了 `Bash(rm:*)`，项目配置无法覆盖这个限制。

**企业配置不可被覆盖。** 这是安全考虑。如果企业策略禁止了某些操作，任何层级的配置都不能解除这个限制。

**配置来源透明。** Claude Code 的调试模式会显示每个配置项的来源，帮助用户理解"为什么这个选项是这个值"。

这些设计对 repox 的启示：

- 安全敏感的配置（如允许执行的命令列表）应该有"不可覆盖"的层级
- 配置合并的语义要根据字段含义来定，不能一刀切全用 deep merge
- 提供配置来源查看功能，减少用户的困惑

## 5.8 实战：repox config 命令

`repox config` 提供四个子命令：`list`、`get`、`set`、`reset`，加一个辅助命令 `path`。

### config list — 查看当前生效的所有配置

```typescript
config
  .command('list')
  .alias('ls')
  .description('列出当前生效的所有配置')
  .action(async () => {
    const cfg = await loadConfig()
    logger.title('当前配置')
    printConfig(cfg, '')
  })
```

`printConfig` 是一个递归函数，将嵌套的配置对象扁平化为 `key.path = value` 的形式输出：

```typescript
function printConfig(obj: unknown, prefix: string): void {
  if (obj === null || obj === undefined) return
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    const display = Array.isArray(obj)
      ? obj.length > 0 ? obj.join(', ') : chalk.gray('(空)')
      : String(obj)
    logger.plain(`  ${chalk.cyan(prefix)} = ${display}`)
    return
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      printConfig(value, path)
    } else {
      const display = value === undefined || value === null
        ? chalk.gray('(未设置)')
        : Array.isArray(value)
          ? value.length > 0 ? value.join(', ') : chalk.gray('(空)')
          : String(value)
      logger.plain(`  ${chalk.cyan(path)} = ${display}`)
    }
  }
}
```

运行效果：

```
当前配置
────────────────────────

  ai.baseUrl = https://ark.cn-beijing.volces.com/api/v3
  ai.model = doubao-1-5-pro-32k-250115
  github.apiUrl = https://api.github.com
  output.format = table
  output.color = true
  output.language = zh
  plugins = (空)
```

用 `key.path` 的扁平化格式而不是嵌套格式展示，是因为这跟 `config get` 和 `config set` 的参数格式一致。用户看到 `ai.model = doubao-1-5-pro-32k-250115`，马上就知道可以用 `repox config set ai.model gpt-4o` 来修改。

### config get — 读取单个配置项

```typescript
config
  .command('get <key>')
  .description('获取指定配置项的值（如 ai.model）')
  .action(async (key: string) => {
    const cfg = await loadConfig()
    const value = getConfigValue(cfg, key)
    if (value === undefined) {
      logger.warn(`配置项 ${key} 不存在`)
    } else {
      logger.plain(
        typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : String(value),
      )
    }
  })
```

`getConfigValue` 通过点号路径访问嵌套属性：

```typescript
export function getConfigValue(config: RepoxConfig, keyPath: string): unknown {
  const keys = keyPath.split('.')
  let current: unknown = config
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
```

使用方式：

```bash
$ repox config get ai.model
doubao-1-5-pro-32k-250115

$ repox config get ai
{
  "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
  "model": "doubao-1-5-pro-32k-250115"
}

$ repox config get nonexistent
⚠ 配置项 nonexistent 不存在
```

注意 `get ai`（获取整个子对象）和 `get ai.model`（获取叶子值）都能工作。子对象以 JSON 格式输出，叶子值以纯文本输出——这让脚本可以直接用 `$(repox config get ai.model)` 获取值。

### config set — 修改全局配置

```typescript
config
  .command('set <key> <value>')
  .description('设置全局配置项')
  .action((key: string, value: string) => {
    const keys = key.split('.')
    const obj: Record<string, unknown> = {}

    // 从点号路径构建嵌套对象
    let current: Record<string, unknown> = obj
    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = {}
      current = current[keys[i]] as Record<string, unknown>
    }

    // 尝试解析为 JSON（处理布尔值、数字等）
    let parsedValue: unknown = value
    try {
      parsedValue = JSON.parse(value)
    } catch {
      // 保持字符串原样
    }
    current[keys[keys.length - 1]] = parsedValue

    saveGlobalConfig(obj)
    logger.success(`已设置 ${key} = ${value}`)
  })
```

值解析的巧思：命令行参数全是字符串，但配置值可能是布尔值或数字。`JSON.parse(value)` 尝试解析：`"true"` 变成 `true`，`"42"` 变成 `42`，`"gpt-4o"` 解析失败保持字符串。这是一个简单有效的启发式处理。

```bash
$ repox config set output.color false    # boolean
$ repox config set ai.model gpt-4o       # string
```

`saveGlobalConfig` 的合并写入逻辑：

```typescript
export function saveGlobalConfig(config: Partial<RepoxConfig>): void {
  const dir = getGlobalConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  const configPath = getGlobalConfigPath()

  // 读取现有配置
  let existing: Record<string, unknown> = {}
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch { /* 忽略 */ }
  }

  // 合并后写回
  const merged = deepMerge(existing, config)
  fs.writeFileSync(
    configPath,
    JSON.stringify(merged, null, 2) + '\n',
    'utf-8',
  )
}
```

关键点是"读取 → 合并 → 写回"三步。`set ai.model gpt-4o` 不会清除配置文件里其他已有的设置，只会更新目标字段。

### config reset — 重置配置

```typescript
config
  .command('reset')
  .description('重置配置为默认值')
  .action(() => {
    saveGlobalConfig({})
    logger.success('配置已重置为默认值')
  })
```

实现上是把空对象写入全局配置文件。由于 `loadConfig` 加载时会用 zod schema 的默认值填充缺失字段，空配置文件等价于"使用所有默认值"。

### config path — 显示配置文件路径

```typescript
config
  .command('path')
  .description('显示全局配置文件路径')
  .action(() => {
    logger.plain(getGlobalConfigPath())
  })
```

看似无足轻重的命令，实际使用频率很高。用户想手动编辑配置文件时，`repox config path` 告诉他文件在哪，然后 `code $(repox config path)` 用编辑器打开。比记住 `~/.config/repox/config.json` 这个路径方便得多。

### 项目配置

除了全局配置，repox 还支持项目配置。用户在项目根目录创建 `.repoxrc` 文件：

```bash
# 手动创建
echo '{ "ai": { "model": "gpt-4o" }, "output": { "format": "json" } }' > .repoxrc

# 或者用 config set 的项目模式（未来可扩展）
```

项目配置适合提交到 Git 仓库。团队成员 clone 项目后，repox 自动读取项目配置，不需要每个人手动设置。

一个实践建议：项目配置里不应该包含 API Key 等敏感信息。把 `.repoxrc` 加到 `.gitignore` 的模板里，或者在项目配置中只放非敏感的偏好设置（输出格式、AI 模型选择等），把 Key 留给环境变量。

## 小结

配置管理的核心是**分层合并**和**渐进式复杂度**。这一章覆盖了：

- **三层配置模型** — 默认值、全局配置、项目配置、环境变量、命令行参数，五级优先级递增。用户只需要关心自己需要改的那一层。
- **cosmiconfig** — 自动搜索多种格式的配置文件，省去手写搜索逻辑。向上搜索机制天然支持 monorepo 场景。
- **XDG 规范** — `~/.config/repox/` 而不是 `~/.repoxrc`，保持 home 目录的整洁。
- **zod 校验** — 配置加载时就发现错误，而不是在运行时某个不可预测的地方崩溃。同时提供类型推导和默认值填充。
- **config 子命令** — `list`/`get`/`set`/`reset` 四件套，覆盖配置管理的所有日常操作。

配置系统不应该是用户需要学习的东西——好的配置系统是透明的。用户感知不到它的存在，但需要调整行为时，一条命令就能搞定。

## 动手试一试

1. 给 repox 添加 `.env` 文件支持：安装 `dotenv` 库，在 `loadConfig` 最前面调用 `dotenv.config()`，让 `.env` 文件中的环境变量也能覆盖默认配置
2. 实现 `repox config edit` 命令，自动用系统默认编辑器（`$EDITOR` 或 `vi`）打开全局配置文件
3. 试试配置优先级：在 `.repoxrc` 中设置 `ai.model` 为 A，在环境变量中设置为 B，在命令行中传入 C，验证最终生效的是哪个
