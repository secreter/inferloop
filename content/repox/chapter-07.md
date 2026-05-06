# 第 7 章 网络请求

CLI 工具不是浏览器，也不是 Web 服务器。它运行在一个充满不确定性的环境里：用户的网络可能断了，可能在公司内网后面隔着三层代理，可能在高铁上信号时有时无。这些状况在 Web 开发中很少需要开发者直接处理——浏览器和框架已经兜底了——但在 CLI 场景下，每一个网络请求的失败都会直接变成一行冰冷的报错信息。

本章围绕 CLI 场景下网络请求的特殊性，从选型、中间件架构、超时与重试、代理适配到离线降级，逐步构建一个健壮的 HTTP 客户端。

## 7.1 CLI 场景下 HTTP 请求的特殊之处

Web 前端发请求，背后有浏览器的自动重试、有 Service Worker、有 UI 上的 loading 状态。CLI 没有这些。一次 `fetch` 失败，如果不处理，用户看到的就是一段 JavaScript 异常栈——这对大多数用户来说等于天书。

CLI 的网络请求有四个必须正视的问题：

**超时必须显式设置。** Node.js 的 `fetch` 默认没有超时限制。一个网络请求如果对端不响应，CLI 会永远挂在那里。这在交互式工具中是不可接受的——用户会以为程序崩了。

**重试不是可选项。** API 偶尔返回 500 是常态。浏览器应用可以弹个提示让用户手动刷新；CLI 工具做不到这一点。合理的自动重试策略能消化掉大量偶发错误。

**代理是企业环境的标配。** 很多公司的开发机通过 HTTP 代理访问外网，`HTTP_PROXY` / `HTTPS_PROXY` 环境变量是事实标准。忽略代理配置等于放弃企业用户。

**离线要能检测、要能降级。** 用户在飞机上执行 `repox deps check`，不应该等三十秒超时后看到一个报错。检测到网络不可用时，应该立刻告知用户，或者回退到缓存数据。

## 7.2 选型分析

Node.js 生态中做 HTTP 请求的库不少，值得认真比较。

### 内置 fetch（Node.js 18+）

Node.js 18 起内置了基于 undici 的全局 `fetch`。优势明显：零依赖、API 与浏览器一致、TypeScript 类型开箱即用。对于大多数 CLI 场景，它足够了。

```typescript
// 最基础的用法
const response = await fetch('https://api.github.com/repos/user/repo')
const data = await response.json()
```

不足之处：不自动读取代理环境变量（Node.js 22.5.0 起通过 `--experimental-network-imports` 部分支持），不内置重试、不内置超时（需要手动用 `AbortSignal`）。

### undici

`fetch` 的底层实现。如果需要更细粒度的连接池控制、HTTP/2、或者自定义 dispatcher（用于代理），可以直接用 undici。但对 CLI 来说通常没必要引入这层复杂度。

### got

功能最全的 Node.js HTTP 库：内置重试、超时、代理、钩子系统、分页支持。缺点是体积较大（加上依赖链约 1MB），且 API 风格与浏览器 `fetch` 不同，学习成本略高。适合需要大量高级特性的场景。

### ky

`fetch` 的轻量封装，API 简洁，支持重试和钩子。体积小（约 10KB），适合快速开发。但它最初为浏览器设计，Node.js 支持是后加的，某些边缘场景可能有坑。

### repox 的选择

repox 使用内置 `fetch` + 手写中间件。原因：

1. 零额外依赖，CLI 工具应该尽可能轻量
2. 中间件模式提供了足够的扩展性
3. 超时和重试的逻辑不复杂，不值得引入一个库

这个选择适用于大多数 CLI 项目。如果你的工具需要处理文件上传、分页遍历、Cookie 管理等复杂场景，got 是更务实的选择。

## 7.3 中间件模式设计

repox 的 `ApiClient` 采用经典的中间件链模式——和 Koa 的洋葱模型、Express 的中间件栈如出一辙，只不过方向反过来了：这里是请求发出前 / 响应返回后的双向拦截。

如果你用过 axios 的 interceptors（`axios.interceptors.request.use(fn)`），repox 的中间件就是同一个概念——在请求发出前和响应返回后插入处理逻辑。区别是 axios interceptors 是"请求拦截器 + 响应拦截器"两段式，而这里是"洋葱模型"一段式，和 Koa 的中间件一模一样。

核心思路：每个中间件接收 `(url, options, next)` 三个参数。`next` 是链条中下一个中间件，最终 `next` 指向真正的 `fetch` 调用。中间件可以在调用 `next` 前修改请求，也可以在 `next` 返回后处理响应。

类型定义在 `src/core/api-client.ts` 中：

```typescript
// src/core/api-client.ts
type Middleware = (
  url: string,
  options: RequestInit,
  next: (url: string, options: RequestInit) => Promise<Response>,
) => Promise<Response>
```

中间件链的组装通过 `reduceRight` 实现：

```typescript
// src/core/api-client.ts
const chain = this.middlewares.reduceRight(
  (next: (u: string, o: RequestInit) => Promise<Response>, middleware) => {
    return (u: string, o: RequestInit) => middleware(u, o, next)
  },
  (u: string, o: RequestInit) => fetch(u, o),
)
```

`reduceRight` 从数组尾部开始折叠。假设中间件注册顺序是 `[logging, retry, auth]`，构建出的链路是：

```
logging → retry → auth → fetch
```

请求时 logging 最先执行，auth 最后执行（最靠近实际 fetch）。这意味着 `use` 的注册顺序就是请求的处理顺序——直觉上很自然。

为什么选择这种模式而不是简单的事件钩子？因为中间件可以完全控制执行流程：重试中间件可以多次调用 `next`，认证中间件可以在 401 时刷新 token 后重新调用 `next`，日志中间件可以计算请求耗时。事件钩子做不到这些。

## 7.4 认证中间件

认证是几乎所有 API 调用的前置条件。repox 把认证逻辑抽成中间件，而不是硬编码在请求方法里，好处是认证策略可以按需替换——GitHub 用 Bearer Token，其他 API 可能用 API Key 或 OAuth。

```typescript
// src/core/api-client.ts
static authMiddleware(getToken: () => string | undefined): Middleware {
  return (url, options, next) => {
    const token = getToken()
    if (token) {
      options.headers = {
        ...(options.headers as Record<string, string>),
        Authorization: `Bearer ${token}`,
      }
    }
    return next(url, options)
  }
}
```

`getToken` 用回调函数而不是直接传入 token 字符串，这是一个关键设计。token 可能来自配置文件、环境变量、甚至 keychain，获取时机应该推迟到请求发起时，而不是客户端创建时。这样在 token 过期后刷新的场景下也能正确工作。

## 7.5 日志中间件

调试网络问题时，知道"发了什么请求、耗时多少、返回了什么状态码"至关重要。日志中间件在 `next` 调用前后各记录一次，就能捕获完整的请求-响应信息：

```typescript
// src/core/api-client.ts
static loggingMiddleware(): Middleware {
  return async (url, options, next) => {
    const method = (options.method ?? 'GET').toUpperCase()
    logger.debug(`→ ${method} ${url}`)
    const start = Date.now()
    const response = await next(url, options)
    const duration = Date.now() - start
    logger.debug(`← ${response.status} (${duration}ms)`)
    return response
  }
}
```

注意这里用的是 `logger.debug`，不是 `console.log`。CLI 工具的日志分级在第 4 章已经讲过——默认情况下 debug 信息不会输出，只有用户传入 `--debug` 或 `--verbose` 时才显示。这很重要：没人希望每次正常使用时都看到一堆请求日志。

## 7.6 超时处理

Node.js 18+ 的 `AbortSignal.timeout()` 是处理请求超时的标准方式：

```typescript
// src/core/api-client.ts — request 方法内部
const fetchOptions: RequestInit = {
  method,
  headers: { ...this.defaultHeaders, ...headers },
  signal: AbortSignal.timeout(timeout),  // 默认 30000ms
}
```

`AbortSignal.timeout(ms)` 创建一个在指定毫秒后自动触发 abort 的信号。传给 `fetch` 后，如果请求在超时前未完成，`fetch` 会抛出一个 `DOMException`，`name` 属性为 `'AbortError'`。

repox 在错误处理中专门识别这个异常：

```typescript
// src/core/api-client.ts
if (error instanceof DOMException && error.name === 'AbortError') {
  throw new NetworkError(`请求超时 (${timeout}ms)`, undefined, url)
}
```

将底层的 `AbortError` 转换为业务层的 `NetworkError`，错误信息中包含超时时长和请求 URL，便于用户排查。

超时时间的选择需要权衡。太短会导致正常请求被误杀（特别是 AI 模型的推理请求，可能需要 30 秒以上），太长会让用户等得不耐烦。repox 的做法是：

- 普通 API 请求：30 秒（默认值）
- AI 模型请求：不走 ApiClient，由 OpenAI SDK 自行管理超时
- 用户可通过 `timeout` 参数覆盖默认值

一个常见的陷阱：`AbortSignal.timeout` 创建的信号是一次性的，不能复用。如果中间件需要重试请求，每次重试都要创建新的 signal。repox 的重试中间件工作在 `fetch` 调用之上，`signal` 已经附着在 `options` 中，所以每次重试实际上复用了同一个 signal——这意味着超时计时器是从第一次请求开始算的总时间，而不是每次重试单独计时。对于大多数场景，这反而是更合理的行为：用户关心的是"这个操作总共花了多久"，而不是"每次重试各花了多久"。

## 7.7 重试策略

重试的核心原则只有一条：只重试可能自愈的错误。

repox 的重试中间件实现了这个原则：

```typescript
// src/core/api-client.ts
static retryMiddleware(maxRetries = 3): Middleware {
  return async (url, options, next) => {
    let lastError: Error | undefined
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await next(url, options)
        // 5xx 才重试
        if (response.status >= 500 && attempt < maxRetries) {
          logger.debug(`请求失败 (${response.status})，第 ${attempt + 1} 次重试...`)
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        return response
      } catch (err) {
        lastError = err as Error
        if (attempt < maxRetries) {
          logger.debug(`请求异常，第 ${attempt + 1} 次重试...`)
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
    }
    throw lastError ?? new Error('请求失败')
  }
}
```

几个设计要点：

**只重试 5xx。** 4xx 是客户端错误（参数不对、认证失败），重试多少次结果都一样。5xx 是服务端错误，可能是临时过载，重试有意义。网络异常（DNS 解析失败、连接超时）进入 `catch` 分支，也会重试——这类问题同样可能是偶发的。

**线性退避。** 等待时间 = `1000 * (attempt + 1)` 毫秒。第一次重试等 1 秒，第二次 2 秒，第三次 3 秒。相比指数退避（1s, 2s, 4s, 8s...），线性退避在 CLI 场景下更实用——用户不会愿意等 8 秒甚至更久。

如果需要指数退避（比如调用有严格限流的 API），可以把等待时间改为 `1000 * Math.pow(2, attempt)`，再加上随机抖动避免多个客户端同时重试造成雪崩：

```typescript
const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500
await new Promise((r) => setTimeout(r, delay))
```

**最大重试次数。** repox 默认 3 次，创建 GitHub 客户端时传入 2 次。重试次数不宜过大，否则用户等待时间会线性增长。

### 幂等性警告

只有幂等请求（GET、PUT、DELETE）才应该重试。POST 请求如果重试，可能导致资源重复创建。repox 当前没有区分 HTTP 方法，因为它的 POST 请求主要是调用 AI API（生成文本，天然幂等）。如果你的 CLI 需要发送非幂等的 POST，需要在重试中间件中加一层判断：

```typescript
if (options.method === 'POST' && !options.headers?.['Idempotency-Key']) {
  return response  // POST 不重试，除非带了幂等键
}
```

## 7.8 企业网络适配

### HTTP 代理

企业环境下，开发机通常通过代理访问外网。`HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 是约定俗成的环境变量。Node.js 内置 `fetch` 不会自动读取这些变量——需要手动处理。

最简单的方式是使用 `undici` 的 `ProxyAgent`：

```typescript
import { ProxyAgent } from 'undici'

function getProxyAgent(): ProxyAgent | undefined {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy

  if (!proxy) return undefined
  return new ProxyAgent(proxy)
}
```

注意环境变量要同时检查大小写——不同系统和工具的约定不一致。`NO_PROXY` 变量指定不走代理的域名列表，格式通常是逗号分隔：

```typescript
function shouldProxy(hostname: string): boolean {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy
  if (!noProxy) return true

  const entries = noProxy.split(',').map(s => s.trim().toLowerCase())
  const host = hostname.toLowerCase()

  return !entries.some(entry => {
    if (entry === '*') return true
    if (entry.startsWith('.')) return host.endsWith(entry)
    return host === entry || host.endsWith('.' + entry)
  })
}
```

### 自签名证书

企业内网经常使用自签名证书。Node.js 默认会拒绝这类证书。两种处理方式：

1. 设置环境变量 `NODE_TLS_REJECT_UNAUTHORIZED=0`（全局禁用证书验证，**不推荐用于生产**）
2. 通过 `NODE_EXTRA_CA_CERTS` 环境变量指向企业的 CA 证书文件

CLI 工具应该在文档中说明这两个环境变量的用法，而不是在代码中硬编码跳过证书验证。repox 在遇到证书错误时，会在错误提示中给出指引：

```typescript
if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
  throw new NetworkError(
    'TLS 证书验证失败（可能是自签名证书）',
    undefined,
    url,
  )
  // hint: 设置 NODE_EXTRA_CA_CERTS 环境变量指向 CA 证书
}
```

## 7.9 离线检测与友好降级

检测网络状态最可靠的方式是发一个实际请求。DNS 解析是最轻量的检测手段：

```typescript
import dns from 'node:dns/promises'

async function isOnline(): Promise<boolean> {
  try {
    await dns.resolve('dns.google')
    return true
  } catch {
    return false
  }
}
```

但不要在每次请求前都做网络检测——这会增加延迟。更好的策略是：

1. 正常发送请求
2. 如果失败，检测是否离线
3. 如果离线，给出明确提示而不是泛泛的网络错误

```typescript
async function handleNetworkFailure(error: Error, url: string): Promise<never> {
  const online = await isOnline()
  if (!online) {
    throw new NetworkError(
      '当前没有网络连接',
      undefined,
      url,
    )
  }
  // 有网但请求失败，可能是 DNS、防火墙、服务端问题
  throw new NetworkError(
    `请求失败: ${error.message}`,
    undefined,
    url,
  )
}
```

降级策略因命令而异。`repox deps check` 检查依赖版本需要访问 npm registry，离线时可以跳过版本检查，只输出本地已安装的版本信息。`repox explain` 必须调用 AI API，离线时只能直接报错。CLI 工具应该为每个需要网络的命令设计降级方案，而不是一刀切。

## 7.10 实战：封装 repox 的 API Client

把前面讨论的所有要素组合起来，看 repox 完整的 `ApiClient` 是如何工作的。

类的构造函数接收 base URL 和默认请求头：

```typescript
// src/core/api-client.ts
export class ApiClient {
  private baseUrl: string
  private defaultHeaders: Record<string, string>
  private middlewares: Middleware[] = []

  constructor(baseUrl: string, defaultHeaders: Record<string, string> = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...defaultHeaders,
    }
  }
}
```

`baseUrl` 末尾的斜杠被去掉，避免和 endpoint 路径拼接时出现双斜杠。默认设置 JSON 的 Content-Type 和 Accept，因为 repox 调用的 API 全部是 JSON 接口。

`request` 方法是核心，负责组装请求参数、构建中间件链、执行请求、统一错误处理：

```typescript
// src/core/api-client.ts
async request<T = unknown>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`
  const { method = 'GET', headers = {}, body, timeout = 30000 } = options

  const fetchOptions: RequestInit = {
    method,
    headers: { ...this.defaultHeaders, ...headers },
    signal: AbortSignal.timeout(timeout),
  }

  if (body !== undefined) {
    fetchOptions.body = JSON.stringify(body)
  }

  const chain = this.middlewares.reduceRight(
    (next: (u: string, o: RequestInit) => Promise<Response>, middleware) => {
      return (u: string, o: RequestInit) => middleware(u, o, next)
    },
    (u: string, o: RequestInit) => fetch(u, o),
  )

  try {
    const response = await chain(url, fetchOptions)
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      throw new NetworkError(
        `请求失败: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`,
        response.status,
        url,
      )
    }
    const data = (await response.json()) as T
    return { status: response.status, headers: response.headers, data }
  } catch (error) {
    if (error instanceof NetworkError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new NetworkError(`请求超时 (${timeout}ms)`, undefined, url)
    }
    throw new NetworkError(
      `网络错误: ${error instanceof Error ? error.message : '未知错误'}`,
      undefined,
      url,
    )
  }
}
```

几个值得注意的细节：

- `endpoint` 支持传入完整 URL（以 `http` 开头）或相对路径（拼接 baseUrl）
- 错误处理三层分离：先检查是否是已转换的 `NetworkError`（避免重复包装），再检查超时，最后兜底处理未知网络错误
- 非 2xx 响应也当作错误处理（`!response.ok`），同时尝试读取响应体作为错误详情

便捷方法 `get` 和 `post` 只是 `request` 的薄封装，减少调用时的样板代码：

```typescript
// src/core/api-client.ts
async get<T>(endpoint: string, options?: Omit<RequestOptions, 'method'>): Promise<ApiResponse<T>> {
  return this.request<T>(endpoint, { ...options, method: 'GET' })
}

async post<T>(endpoint: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<ApiResponse<T>> {
  return this.request<T>(endpoint, { ...options, method: 'POST', body })
}
```

### 创建 GitHub 客户端

`createGitHubClient` 工厂函数展示了中间件的实际组装方式：

```typescript
// src/core/api-client.ts
export function createGitHubClient(token?: string): ApiClient {
  const client = new ApiClient('https://api.github.com', {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  })

  client
    .use(ApiClient.loggingMiddleware())
    .use(ApiClient.retryMiddleware(2))

  if (token) {
    client.use(ApiClient.authMiddleware(() => token))
  }

  return client
}
```

中间件注册顺序：logging → retry → auth → fetch。这意味着：

1. 日志记录每一次请求（包括重试产生的请求）
2. 重试中间件包裹住 auth 和 fetch，重试时 auth 头会被重新注入
3. 认证紧贴 fetch，确保每次实际发出的请求都带有 token

### repox deps check 的网络调用

`repox deps check` 命令需要访问 npm registry 查询每个依赖的最新版本。当前实现（`src/commands/deps.ts`）通过 `execSync` 调用 `npm view`：

```typescript
// src/commands/deps.ts
const output = execSync(`npm view ${dep.name} version`, {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 10000,
}).trim()
```

当前 `repox deps check` 使用 `execSync('npm view')` 逐个查询版本，这是最简单直接的实现。在生产级工具中，可以用 npm registry API（`https://registry.npmjs.org/<package>`）+ ApiClient 批量并发查询，性能会好很多。这是一个很好的练习题——用前面实现的 ApiClient 重写 deps check。

这种方式简单直接，但有缺陷：每个依赖启动一个子进程，20 个依赖就是 20 次进程创建开销。更高效的做法是直接通过 `ApiClient` 调用 npm registry API：

```typescript
// 更高效的实现思路
const registryClient = new ApiClient('https://registry.npmjs.org')
  .use(ApiClient.retryMiddleware(1))

// 并行查询所有依赖的最新版本
const results = await Promise.allSettled(
  allDeps.map(async (dep) => {
    const { data } = await registryClient.get<{ 'dist-tags': { latest: string } }>(
      `/${dep.name}`
    )
    return {
      name: dep.name,
      current: dep.version,
      latest: data['dist-tags'].latest,
    }
  })
)
```

`Promise.allSettled` 而不是 `Promise.all`，确保单个依赖查询失败不影响其他依赖。这是 CLI 工具中处理批量网络请求的常见模式。

但要注意并发数控制。同时发出 50 个请求可能触发 npm registry 的限流。一个简单的并发池实现：

```typescript
async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = []
  let index = 0

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const i = index++
      try {
        const value = await tasks[i]()
        results[i] = { status: 'fulfilled', value }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runNext()))
  return results
}

// 最多 5 个并发请求
const results = await parallelLimit(
  allDeps.map((dep) => () => registryClient.get(`/${dep.name}`)),
  5,
)
```

## 7.11 错误信息的艺术

网络请求失败时，错误信息的质量直接决定了用户体验。看两个对比：

差的：
```
Error: fetch failed
```

好的：
```
✖ 网络请求失败: 请求超时 (30000ms)
  请求地址: https://api.github.com/repos/user/repo
  提示: 检查网络连接，或使用 --timeout 增加超时时间
```

repox 的 `NetworkError` 类专门为此设计，携带 `statusCode` 和 `url` 两个上下文字段。全局错误处理器 `handleError`（`src/core/error.ts`）根据错误类型输出对应格式：

```typescript
// src/core/error.ts
} else if (error instanceof NetworkError) {
  console.error(chalk.red('✖'), `网络请求失败: ${error.message}`)
  if (error.url) {
    console.error(chalk.gray('  请求地址:'), error.url)
  }
  if (error.statusCode) {
    console.error(chalk.gray('  状态码:'), error.statusCode)
  }
  process.exit(ExitCode.GENERAL_ERROR)
}
```

## 7.12 小结

本章覆盖了 CLI 场景下网络请求的关键方面：

- **中间件架构**提供了灵活的请求处理管线，认证、日志、重试各司其职
- **超时处理**用 `AbortSignal.timeout` 一行搞定，但要理解它在重试场景下的行为
- **重试策略**只针对 5xx 和网络异常，配合退避算法避免雪崩
- **代理和证书**是企业环境的刚需，不能忽视
- **离线检测**应该在请求失败后进行，而不是作为前置检查
- **错误信息**要包含足够的上下文（URL、状态码、建议），帮助用户自行排查

下一章进入 AI 集成——repox 最核心的能力。HTTP 客户端是基础设施，AI 是业务价值。

## 中场回顾：repox 的模块全景

到这里，repox 的基础设施已经搭建完毕。在继续 AI 功能之前，回顾一下已有模块的关系：

```
┌─────────────────────────────────────────────────┐
│                    CLI 入口                       │
│              src/cli.ts (Commander)               │
└──────────────┬────────────────────────────────────┘
               │ 注册命令
  ┌────────────┼────────────┬──────────────┐
  │            │            │              │
  ▼            ▼            ▼              ▼
┌──────┐  ┌──────┐   ┌──────────┐   ┌──────────┐
│ init │  │ scan │   │  config  │   │   auth   │
│(ch3) │  │(ch4) │   │  (ch5)   │   │  (ch6)   │
└──┬───┘  └──┬───┘   └────┬─────┘   └────┬─────┘
   │         │            │               │
   ▼         ▼            ▼               ▼
┌──────────────────────────────────────────────────┐
│                   核心模块层                       │
│  logger(ch4) │ error(ch4) │ config(ch5) │ auth(ch6) │
└──────────────────────────┬───────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────┐
│                   基础设施层                       │
│     api-client(ch7)  │  git utils  │  format     │
└──────────────────────────────────────────────────┘
```

接下来的第 8-9 章将在这套基础设施之上构建 AI 能力。你会发现，AI 模块（`src/core/ai.ts`）和 GitHub API 客户端使用完全相同的 HTTP 调用模式——这就是分层架构的价值。

## 动手试一试

1. 用 ApiClient 重写 `deps check`：不用 `execSync('npm view')`，改用 `client.get('https://registry.npmjs.org/<package>')` 查询版本，并用 `Promise.all` 并发请求
2. 给 ApiClient 添加一个 `cacheMiddleware`：对相同 URL 的 GET 请求在 5 分钟内返回缓存结果
3. 测试代理：设置 `HTTP_PROXY=http://localhost:8080`，观察 repox 的网络请求是否经过代理（提示：Node.js 内置 fetch 不自动读取代理环境变量，需要额外处理）
