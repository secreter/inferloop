# 第 11 章 测试与发布

## 11.1 CLI 测试的特殊性

CLI 测试和前端组件测试的范式完全不同。前端测试的核心是 `render()` → 查询 DOM → 断言元素。CLI 测试的核心是 **启动进程** → **捕获 stdout/stderr** → **断言退出码**。

没有 DOM，没有 `screen.getByText()`。取而代之的是 `execSync()` 的返回值和 `error.status`。这种范式转换是前端工程师做 CLI 测试时最大的认知跳跃。

几个 CLI 测试特有的断言维度：
- **stdout 内容**：命令的主要输出是否正确
- **stderr 内容**：错误信息是否友好
- **退出码**：成功是 0，参数错误是 2，异常是 1
- **副作用**：文件是否被正确创建/修改，配置是否被写入

测试一个 React 组件，你渲染它、模拟点击、检查 DOM 变化。测试一个 CLI 工具，你启动一个进程、传入参数、检查 stdout 和退出码。

这带来两个根本差异：

**进程边界**。CLI 测试的被测对象是一个独立进程。每次测试都要 fork 或 exec 一个子进程，这意味着更高的启动开销、更难以 mock 的外部依赖、以及输出只有文本——没有对象、没有类型，只有一串字符串。

**状态隔离**。浏览器环境每个 tab 天然隔离，但 CLI 工具可能读写文件系统、修改环境变量、改变 git 状态。测试之间的状态泄漏是 CLI 测试中最常见的坑。

针对这两个特点，repox 的测试策略分三层：单元测试覆盖核心逻辑，集成测试验证完整命令，快照测试防止输出回归。

## 11.2 单元测试：核心模块

repox 使用 vitest 作为测试框架。`package.json` 中的配置：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

### 测试 Logger 模块

Logger 是最适合写单元测试的模块——纯逻辑、无副作用（除了 console 输出），状态可控。

```typescript
// src/core/__tests__/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger, setLogLevel } from '../logger.js'

describe('Logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setLogLevel('normal') // 每个测试重置状态
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('quiet 级别下 info 不应该输出', () => {
    setLogLevel('quiet')
    logger.info('这条信息不该出现')
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('normal 级别下 info 应该输出', () => {
    setLogLevel('normal')
    logger.info('这条信息应该出现')
    expect(consoleSpy).toHaveBeenCalledOnce()
  })

  it('normal 级别下 debug 不应该输出', () => {
    setLogLevel('normal')
    logger.debug('调试信息')
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it('debug 级别下所有方法都应该输出', () => {
    setLogLevel('debug')
    logger.info('info')
    logger.verbose('verbose')
    logger.debug('debug')
    expect(consoleSpy).toHaveBeenCalledTimes(3)
  })
})
```

注意 `beforeEach` 中的 `setLogLevel('normal')`。Logger 模块用模块级变量存储当前级别，测试之间共享这个状态。不重置的话，前一个测试设的 `quiet` 会影响后一个测试——这就是前面说的"状态泄漏"。

### 测试 Error 模块

错误类的测试重点是验证错误类型的识别和 handleError 的行为：

```typescript
// src/core/__tests__/error.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { UserError, NetworkError, handleError, ExitCode } from '../error.js'

describe('Error 类', () => {
  it('UserError 携带 hint', () => {
    const err = new UserError('配置缺失', '运行 repox init')
    expect(err.message).toBe('配置缺失')
    expect(err.hint).toBe('运行 repox init')
    expect(err.name).toBe('UserError')
    expect(err).toBeInstanceOf(Error)
  })

  it('NetworkError 携带状态码和 URL', () => {
    const err = new NetworkError('请求失败', 404, 'https://api.example.com')
    expect(err.statusCode).toBe(404)
    expect(err.url).toBe('https://api.example.com')
  })
})

describe('handleError', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  afterEach(() => {
    exitSpy.mockClear()
    stderrSpy.mockClear()
  })

  it('UserError 使用退出码 2', () => {
    handleError(new UserError('测试错误'))
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.USAGE_ERROR)
  })

  it('NetworkError 使用退出码 1', () => {
    handleError(new NetworkError('网络错误'))
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GENERAL_ERROR)
  })
})
```

这里 mock 了 `process.exit`——如果不 mock，`handleError` 会真的终止进程，测试后面的断言永远不会执行。`mockImplementation(() => undefined as never)` 中的 `as never` 是为了满足 TypeScript 类型要求（`process.exit` 的返回类型是 `never`）。

### 测试 Format 模块

格式化模块是纯函数，测试最直接：

```typescript
// src/utils/__tests__/format.test.ts
import { describe, it, expect } from 'vitest'
import { truncate } from '../format.js'

describe('truncate', () => {
  it('短字符串不截断', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('长字符串截断并加省略号', () => {
    expect(truncate('hello world', 8)).toBe('hello...')
  })

  it('刚好等于最大长度不截断', () => {
    expect(truncate('12345', 5)).toBe('12345')
  })
})
```

## 11.3 集成测试：启动子进程

单元测试覆盖了内部逻辑，但 CLI 的真正行为是"用户在终端敲命令"。集成测试通过启动子进程来模拟这个过程。

```typescript
// tests/integration/cli.test.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

const CLI = 'npx tsx src/index.ts'

describe('CLI 集成测试', () => {
  it('--version 输出版本号', () => {
    const output = execSync(`${CLI} --version`, { encoding: 'utf-8' }).trim()
    expect(output).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('--help 输出帮助信息', () => {
    const output = execSync(`${CLI} --help`, { encoding: 'utf-8' })
    expect(output).toContain('AI 驱动的仓库助手')
    expect(output).toContain('scan')
    expect(output).toContain('commit')
  })

  it('scan 命令输出 JSON', () => {
    const output = execSync(`${CLI} scan --format json`, {
      encoding: 'utf-8',
      cwd: process.cwd(), // 确保在 repox 项目目录下
    })
    const parsed = JSON.parse(output)
    expect(parsed.name).toBe('repox')
    expect(parsed).toHaveProperty('language')
    expect(parsed).toHaveProperty('frameworks')
  })

  it('未知命令返回非零退出码', () => {
    try {
      execSync(`${CLI} nonexistent`, { encoding: 'utf-8', stdio: 'pipe' })
      expect.fail('应该抛出错误')
    } catch (error: unknown) {
      const execError = error as { status: number; stderr: string }
      expect(execError.status).not.toBe(0)
    }
  })

  it('scan --format json 的输出是合法 JSON', () => {
    const output = execSync(`${CLI} scan --format json`, { encoding: 'utf-8' })
    expect(() => JSON.parse(output)).not.toThrow()
  })
})
```

集成测试的几个注意事项：

**启动方式**。开发阶段用 `npx tsx src/index.ts` 直接跑 TypeScript 源码，CI 中可以先 build 再测 `node dist/index.js`。两种方式都应该测，前者测开发时的行为，后者测打包后的行为。

**超时控制**。`execSync` 默认没有超时，如果 CLI 卡住（比如等待 stdin 输入），测试会永远挂起。建议加上 `timeout` 选项：

```typescript
execSync(command, { encoding: 'utf-8', timeout: 10000 }) // 10 秒超时
```

**工作目录**。CLI 的行为通常依赖当前目录（读 package.json、.git 目录等），`cwd` 选项需要明确设置。

**stderr 与 stdout**。`execSync` 在命令返回非零退出码时会抛出异常。异常对象的 `stdout` 和 `stderr` 分别对应标准输出和标准错误。测试错误场景时需要从异常中提取这些信息。

## 11.4 快照测试

快照测试用于检测输出格式的意外变化。手动检查 table 输出的每一行太繁琐，快照测试把第一次运行的结果保存下来，后续运行时自动对比。

```typescript
// tests/snapshot/output.test.ts
import { describe, it, expect } from 'vitest'
import { formatKeyValue, formatList } from '../../src/utils/format.js'

describe('输出格式快照', () => {
  it('formatKeyValue plain 格式', () => {
    const result = formatKeyValue({
      '项目名称': 'repox',
      '语言': 'TypeScript',
      'TypeScript': true,
    }, 'plain')
    expect(result).toMatchSnapshot()
  })

  it('formatList plain 格式', () => {
    const result = formatList(
      ['名称', '版本', '描述'],
      [
        ['repox-plugin-feishu', '1.0.0', '飞书集成'],
        ['repox-plugin-gitlab', '0.2.0', 'GitLab 支持'],
      ],
      'plain',
    )
    expect(result).toMatchSnapshot()
  })
})
```

快照文件会自动生成在 `__snapshots__` 目录下。当你有意修改了输出格式，运行 `vitest --update` 更新快照。

快照测试对 CLI 工具特别有用——`--help` 输出就是你的 API 文档，任何意外变动都应该被发现：

```typescript
it('help 输出保持稳定', () => {
  const output = execSync('npx tsx src/index.ts --help', { encoding: 'utf-8' })
  expect(output).toMatchSnapshot()
})
```
第一次运行会生成快照文件，后续运行会对比。如果你改了命令描述，`vitest -u` 更新快照。

快照测试有个常见的坑：**不要对包含颜色转义码的输出做快照**。chalk 在 CI 环境中可能自动禁用颜色（检测到 `TERM=dumb` 或 `CI=true`），导致快照在本地通过但 CI 失败。解决方案是测试 plain 格式，或者在测试前设置 `process.env.FORCE_COLOR = '0'`。

## 11.5 Mock 策略

CLI 测试中最棘手的问题是外部依赖的 mock。

### Mock fetch（API 请求）

repox 的 AI 和 GitHub 功能都依赖 HTTP 请求。测试时不能真的调 API——慢、不稳定、消耗配额。

```typescript
// 方式一：vi.stubGlobal 替换全局 fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

mockFetch.mockResolvedValueOnce({
  ok: true,
  status: 200,
  json: async () => ({ data: 'test' }),
  headers: new Headers(),
})

// 调用被测代码后验证
expect(mockFetch).toHaveBeenCalledWith(
  expect.stringContaining('/api/'),
  expect.objectContaining({ method: 'POST' }),
)
```

`vi.stubGlobal` 比 `vi.spyOn(globalThis, 'fetch')` 更可靠，因为后者在某些 Node.js 版本中可能找不到 `fetch` 属性。

```typescript
// 方式二：mock 整个 api-client 模块
vi.mock('../core/api-client.js', () => ({
  createGitHubClient: () => ({
    get: vi.fn().mockResolvedValue({ data: { full_name: 'test/repo' }, status: 200 }),
    post: vi.fn().mockResolvedValue({ data: {}, status: 201 }),
  }),
}))
```

模块级 mock 的好处是不需要关心 fetch 的细节（headers、body 序列化等），直接在业务层面 mock。

### Mock process.exit

前面已经展示过。关键是 `mockImplementation` 必须阻止真正的退出：

```typescript
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
```

### Mock 文件系统

测试 config 模块时需要模拟配置文件的存在与内容：

```typescript
import { vol } from 'memfs'
vi.mock('node:fs', async () => {
  const memfs = await import('memfs')
  return memfs.fs
})

beforeEach(() => {
  vol.reset()
  vol.fromJSON({
    '/home/user/.config/repox/config.json': JSON.stringify({
      ai: { apiKey: 'sk-test' },
    }),
    '/project/.repoxrc': JSON.stringify({
      output: { format: 'json' },
    }),
  })
})
```

`memfs` 是内存文件系统，完全隔离、运行飞快。不过要注意：如果被测代码使用了 `fs/promises`，需要同时 mock `node:fs` 和 `node:fs/promises`。

另一种更轻量的方式是用真实的临时目录：

```typescript
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'repox-test-'))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})
```

临时目录的好处是不需要 mock 文件系统，代码路径跟生产环境完全一致。代价是 I/O 开销——对绝大多数测试来说可以忽略。

### 打包策略：bundle all vs external deps

CLI 工具的打包有两种思路：

| 策略 | 优点 | 缺点 |
|------|------|------|
| 全部 bundle | 零外部依赖，`npx` 即用 | 包体积大（可能 10MB+），部分包不支持 bundle |
| external deps | 构建快，包体积小 | 用户需要 `npm install`，node_modules 必须存在 |

repox 选择 `packages: 'external'`（外部依赖模式），原因是 ink、react 等包的内部结构复杂，bundle 进去容易出问题。对于不使用 ink 的纯 CLI 工具，全部 bundle 是更好的选择——用户 `npx repox` 就能直接运行，零安装。

## 11.6 打包优化：esbuild 单文件 bundle

`npm install -g repox` 之后，用户敲 `repox scan` 到看到输出，中间经历了什么？

Node.js 启动 → 解析入口文件 → 逐个 `import` → 解析 node_modules → 加载几十个 .js 文件 → 执行。这个过程在 ESM 模式下尤其慢——每个 import 都是一次文件系统查找和解析。

repox 使用 esbuild 将所有源码和依赖打包成单个文件：

```javascript
// esbuild.config.js
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    // 保留为外部依赖，避免打包问题
    'ink',
    'react',
    'yoga-wasm-web',
  ],
})

console.log('构建完成 → dist/index.js')
```

配置逐项解释：

- **entryPoints**：入口文件，esbuild 从这里开始追踪依赖图。
- **bundle: true**：将所有 import 的模块内联到一个文件中。
- **platform: 'node'**：告诉 esbuild 这是 Node.js 环境，`node:fs` 等内置模块不打包。
- **target: 'node18'**：生成兼容 Node.js 18 的代码，不会 polyfill 已支持的语法。
- **format: 'esm'**：输出 ES Module 格式。
- **banner**：在文件头部插入 shebang 行，让操作系统知道用 node 执行这个文件。
- **external**：某些包打包后会出问题（native module、WASM 等），保留为外部依赖。

打包前后的对比：

| 指标 | 打包前（tsx 直接运行） | 打包后（单文件） |
|------|---------------------|----------------|
| 启动时间 | ~300ms | ~50ms |
| 文件数量 | 数百个 | 1 个 |
| 分发体积 | node_modules 几十 MB | 单文件 ~200KB |

启动时间从 300ms 到 50ms——对一个频繁调用的 CLI 工具来说，这个差距是决定性的。

`package.json` 中的 `bin` 字段指向打包后的文件：

```json
{
  "bin": {
    "repox": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "node esbuild.config.js",
    "prepublishOnly": "npm run build"
  }
}
```

`prepublishOnly` 确保每次 publish 前都会重新构建。`files` 字段限制 npm 包只包含 `dist` 目录，不会把源码和测试文件也发上去。

## 11.7 npm publish 全流程

第一次发布 npm 包的流程：

```bash
# 1. 确保已登录 npm
npm login

# 2. 检查包名是否被占用
npm search repox

# 3. 构建
npm run build

# 4. dry-run 看看会发布什么
npm publish --dry-run

# 5. 正式发布
npm publish
```

如果包名已被占用，可以用 scope 包：

```json
{
  "name": "@yourname/repox",
  "bin": {
    "repox": "./dist/index.js"
  }
}
```

scope 包默认是私有的，公开发布需要加 `--access public`：

```bash
npm publish --access public
```

安装方式变成 `npm install -g @yourname/repox`，但 bin 的名字仍然是 `repox`——用户执行的命令不变。

## 11.8 可执行文件分发：Node SEA

npm 安装要求用户先装 Node.js——这对开发者来说理所当然，但如果想让非 Node.js 用户也能用呢？

Node.js 从 v20 开始提供 Single Executable Application (SEA) 功能，可以把 JS 代码和 Node.js 运行时打包成一个独立的可执行文件。

步骤：

```bash
# 1. 用 esbuild 打包成单文件（已经做了）
node esbuild.config.js

# 2. 生成 SEA 配置
echo '{ "main": "dist/index.js", "output": "dist/sea-prep.blob" }' > sea-config.json

# 3. 生成 SEA blob
node --experimental-sea-config sea-config.json

# 4. 复制 node 可执行文件
cp $(which node) dist/repox

# 5. 注入 blob
npx postject dist/repox NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# 6. macOS 需要重签名
codesign --sign - dist/repox  # 仅 macOS
```

最终产物是一个约 50-80MB 的可执行文件（包含了完整的 Node.js 运行时）。体积不小，但用户只需要下载一个文件就能运行——零依赖。

实际项目中，SEA 打包通常交给 CI/CD 流水线，针对 Linux/macOS/Windows 三个平台分别构建。

## 11.9 版本管理：changesets

手动改 package.json 的版本号、写 CHANGELOG、打 tag、publish——每次发版都做一遍容易出错。changesets 将这些步骤自动化。

```bash
# 安装
npm install -D @changesets/cli

# 初始化
npx changeset init
```

日常开发流程变成：

```bash
# 完成一个功能后，创建 changeset
npx changeset
# 交互式选择：这是 patch / minor / major？
# 写一行变更描述

# 发版时，changeset 自动：
# 1. 根据所有待发布的 changeset 计算新版本号
# 2. 更新 package.json
# 3. 生成 CHANGELOG.md
# 4. 提交并打 tag
npx changeset version
npm publish
```

changeset 文件是 markdown 格式，存在 `.changeset/` 目录下，跟代码一起进 git。这意味着版本变更信息跟代码变更绑定——review PR 时就能看到这个变更会导致版本号怎么变。

## 11.10 自动更新提醒

用户装了 `repox@0.1.0`，三个月后你发了 `0.5.0`，加了很多新功能。但用户不知道——他没有关注你的 npm 页面，也没有订阅你的 release note。

`update-notifier` 解决这个问题：

```typescript
import updateNotifier from 'update-notifier'
import pkg from '../package.json' assert { type: 'json' }

// 检查更新（异步、非阻塞、有本地缓存不会每次都请求 npm）
const notifier = updateNotifier({ pkg })
notifier.notify()
```

输出效果：

```
   ╭─────────────────────────────────────╮
   │                                     │
   │   Update available 0.1.0 → 0.5.0   │
   │   Run npm i -g repox to update      │
   │                                     │
   ╰─────────────────────────────────────╯
```

`update-notifier` 的设计很巧妙：检查请求在子进程中执行，不阻塞 CLI 的正常运行；结果缓存在本地，默认每天最多检查一次；只在终端是 TTY 时才显示提醒，不干扰管道操作。

## 11.11 GitHub Actions CI/CD

完整的 CI/CD 配置覆盖：代码检查、测试、构建验证、自动发布。

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm test

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci
      - run: npm run build

      # 验证打包产物能正常运行
      - run: node dist/index.js --version
      - run: node dist/index.js --help
```

自动发布到 npm：

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: 'https://registry.npmjs.org'
          cache: 'npm'

      - run: npm ci
      - run: npm run build

      - name: 创建 Release PR 或发布
        uses: changesets/action@v1
        with:
          publish: npm publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

几个要点：

**矩阵测试**。`strategy.matrix` 在 Node.js 18、20、22 三个版本上分别跑测试。CLI 工具的用户环境比 Web 应用多样得多，跨版本兼容性测试是必要的。

**构建验证**。不只是 `npm run build` 不报错就行，还要实际执行 `node dist/index.js --version` 确认产物可用。esbuild 偶尔会漏掉某个模块但不报错——构建成功不等于产物正确。

**changesets/action**。自动检测是否有待发布的 changeset，有则创建 Release PR（更新版本号和 CHANGELOG），PR 合并后自动 publish 到 npm。

如果你用 GitLab CI 而非 GitHub Actions，配置思路完全一致，只是语法不同。参考 GitLab 的 [Node.js 模板](https://docs.gitlab.com/ci/examples/end_to_end_testing_webdriverio/)，把 `npm test` 和 `npm run build` 放到对应的 stage 即可。

## 11.12 小结

本章覆盖了 CLI 工具从测试到发布的完整链路：

1. **单元测试**用 vitest 测核心模块（logger、error、format），注意状态隔离。
2. **集成测试**用 `execSync` 启动子进程，验证真实的命令行为。
3. **快照测试**防止输出格式的意外回归。
4. **Mock 策略**：`vi.stubGlobal` mock fetch，`vi.spyOn` mock process.exit，`memfs` 或临时目录 mock 文件系统。
5. **esbuild 打包**将启动时间从 300ms 降到 50ms，这对 CLI 工具至关重要。
6. **npm publish** 是最简单的分发方式，scope 包解决命名冲突。
7. **Node SEA** 生成独立可执行文件，适合非 Node.js 用户。
8. **changesets** 自动化版本号 + CHANGELOG + tag 的发版流程。
9. **GitHub Actions** 覆盖 CI 测试、构建验证、自动发布的完整 pipeline。

测试和发布不是写完代码后的额外工作，而是工程质量的基本保障。一个没有测试的 CLI 工具，你自己都不敢改代码；一个发布流程没自动化的项目，每次发版都是一次冒险。

## 动手试一试

1. 给 `repox --help` 的输出添加快照测试，确保命令描述不会被意外修改
2. 尝试把 esbuild 配置改为全量 bundle（去掉 `packages: 'external'`），观察哪些包会报错，哪些能正常 bundle
3. 给 CI 配置添加矩阵测试：同时在 Node 18 和 Node 22 上运行测试
