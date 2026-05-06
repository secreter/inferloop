# 第 6 章 登录鉴权

大多数有实际功能的 CLI 工具都需要鉴权——调 GitHub API 要 token，调 AI 接口要 API Key，部署到云平台要身份凭证。但 CLI 的鉴权和 Web 完全不同：没有浏览器、没有 cookie、没有重定向。这一章讲清楚 CLI 鉴权的四种主流模式，深入拆解 OAuth Device Flow，并实现 repox 的完整登录系统。

## 6.1 CLI 鉴权与 Web 鉴权的区别

Web 应用的鉴权流程，前端工程师闭着眼都能写：用户点登录 → 跳转到第三方授权页 → 授权后带着 code 重定向回来 → 用 code 换 token → token 存在 cookie 或 localStorage 里。整个流程依赖浏览器的能力：能渲染 UI、能重定向、能存 cookie。

CLI 没有这些。终端是纯文本环境，无法渲染授权页面；命令行进程没有 HTTP 服务器（通常），接收不了回调重定向；进程结束后内存清空，token 必须持久化到文件系统。

这些限制催生了 CLI 特有的鉴权方案。在展开之前，先明确一个基本问题：CLI 鉴权要存储的是什么？

**Token，不是密码。** CLI 工具不应该存储用户的密码。正确的做法是通过某种方式获取一个有限权限的 token（或 API Key），然后存储这个 token。Token 可以被撤销、可以设过期时间、可以限制权限范围——比密码安全得多。

## 6.2 四种鉴权模式

### 模式一：Token 直接配置

最简单的方式——用户手动获取 token，通过环境变量或配置文件告诉 CLI。

```bash
# 环境变量
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
repox scan

# 或者写进 shell 配置
echo 'export GITHUB_TOKEN=ghp_xxx' >> ~/.zshrc
```

**代表产品：** 绝大多数 CI/CD 场景、早期的 GitHub CLI。

**优点：** 实现零成本，不需要在 CLI 里写任何鉴权逻辑。用户自己去 GitHub Settings → Developer settings → Personal access tokens 页面生成 token，粘贴过来就行。

**缺点：** 用户体验差。用户需要知道去哪生成 token、需要手动复制粘贴、需要自己管理 token 的生命周期（过期、泄露时手动更换）。对新手不友好。

**适用场景：** CI/CD 环境（token 通过 secrets 注入，本来就不需要交互式登录）、开发者工具的备用方案。

repox 通过环境变量支持这种模式：

```typescript
export function getGitHubToken(): string | undefined {
  // 环境变量优先
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN
  }
  const tokens = loadTokens()
  return tokens.github?.token
}
```

### 模式二：OAuth Device Flow

用户在终端里看到一个验证码，在浏览器里输入这个验证码完成授权。CLI 在后台轮询等待授权完成。

```
$ repox login

请在浏览器中完成 GitHub 授权:

  1. 打开 https://github.com/login/device
  2. 输入验证码: ABCD-1234

ℹ 已自动打开浏览器
⠋ 等待授权完成...
✔ 已登录为 octocat
```

**代表产品：** GitHub CLI (gh)、Azure CLI、1Password CLI。

**优点：** 用户体验好——整个过程只需要在浏览器里点一下"Authorize"按钮。不需要手动复制 token。安全性高——CLI 进程永远看不到用户的密码。

**缺点：** 需要注册 OAuth App、实现轮询逻辑、处理各种超时和错误状态。

**适用场景：** 面向个人开发者的 CLI 工具，需要调用第三方 API（GitHub、GitLab 等）的场景。

repox 的主要登录方式，下面会详细拆解。

### 模式三：OAuth PKCE + 本地回调

CLI 启动一个临时的本地 HTTP 服务器（比如 `http://localhost:9999/callback`），引导用户在浏览器里完成 OAuth 授权，授权完成后浏览器重定向到这个本地地址，CLI 接收 authorization code 并换取 token。

```
$ vercel login
> Opening browser to https://vercel.com/auth?...
> Waiting for authentication...
> Success! Email: dev@example.com
```

**代表产品：** Vercel CLI、Netlify CLI、Supabase CLI。

**优点：** 全自动，用户只需要在浏览器里点授权。相比 Device Flow 少了输入验证码的步骤。

**缺点：** 需要在本地启动 HTTP 服务器，可能被防火墙拦截；需要处理端口占用；回调 URL 必须精确匹配 OAuth App 的配置，localhost 的端口号变了就出问题。

PKCE（Proof Key for Code Exchange）是 OAuth 2.0 的扩展，解决了公开客户端（CLI 没有 client secret）的安全问题。核心思路是在发起授权请求时附带一个随机生成的 `code_verifier`，授权服务器回传 code 后，CLI 用 `code_verifier` 证明自己是最初发起请求的那个客户端。

简化的实现思路：

```typescript
import { createServer } from 'node:http'
import crypto from 'node:crypto'

async function loginWithPKCE(): Promise<string> {
  // 生成 PKCE 密钥对
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

  // 启动本地回调服务器
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`)
      const code = url.searchParams.get('code')

      if (!code) {
        res.writeHead(400)
        res.end('Missing authorization code')
        return
      }

      // 用 code + codeVerifier 换取 token
      const token = await exchangeCodeForToken(code, codeVerifier)

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h1>授权成功，可以关闭此页面</h1>')
      server.close()
      resolve(token)
    })

    const port = 9876
    server.listen(port, () => {
      const authUrl = buildAuthUrl(codeChallenge, `http://localhost:${port}`)
      open(authUrl)
    })
  })
}
```

repox 没有采用这种方式，因为 GitHub 的 OAuth Device Flow 已经足够好用，不需要本地 HTTP 服务器的额外复杂度。

### 模式四：API Key 交互式输入

最适合 AI 类工具的方式——直接让用户粘贴 API Key。

```
$ repox login --ai
? 输入 AI API Key: ************************************
✔ AI API Key 已保存
```

**代表产品：** Claude Code（首次使用时交互式输入 API Key）、各种 AI CLI 工具。

**优点：** 实现简单，用户理解成本低——去 API 平台复制 Key 粘贴进来就行。

**缺点：** API Key 通常权限很大且不会过期（除非手动轮换），一旦泄露风险较高。

repox 对 AI 功能采用这种模式：

```typescript
async function loginAI(): Promise<void> {
  const apiKey = await password({
    message: '输入 AI API Key',
    mask: '*',
    validate: (v) => (v.length > 0 ? true : 'API Key 不能为空'),
  })

  saveAIApiKey(apiKey)
}
```

`@inquirer/prompts` 的 `password` 函数会用 `*` 遮盖输入内容，防止旁边有人偷看屏幕。`validate` 确保用户不会提交空值。

## 6.3 OAuth Device Flow 完整流程

Device Flow 是 OAuth 2.0 的一个扩展授权类型（RFC 8628），专门为"无法显示完整浏览器界面的设备"设计。智能电视、IoT 设备、CLI 工具都属于这个范畴。

完整流程分五步：

```
CLI                          GitHub                        浏览器
 │                              │                             │
 │ 1. POST /login/device/code  │                             │
 │  (client_id, scope)         │                             │
 │─────────────────────────────>│                             │
 │                              │                             │
 │ 2. 返回 device_code,        │                             │
 │    user_code,                │                             │
 │    verification_uri          │                             │
 │<─────────────────────────────│                             │
 │                              │                             │
 │ 3. 显示 user_code，                                       │
 │    打开 verification_uri ──────────────────────────────────>│
 │                              │                             │
 │                              │     4. 用户输入 user_code   │
 │                              │        并点击 Authorize     │
 │                              │<────────────────────────────│
 │                              │                             │
 │ 5. 轮询 POST               │                             │
 │    /login/oauth/access_token│                             │
 │    (device_code)            │                             │
 │─────────────────────────────>│                             │
 │                              │                             │
 │ 6. 返回 access_token        │                             │
 │<─────────────────────────────│                             │
```

### 第 1 步：请求 Device Code

向 GitHub 的 Device Flow 端点发起请求：

```typescript
export async function requestDeviceCode(
  clientId: string,
): Promise<DeviceCodeResponse> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: 'repo read:user',
    }),
  })

  if (!response.ok) {
    throw new NetworkError(
      `GitHub Device Flow 请求失败 (${response.status})`,
      response.status,
      'https://github.com/login/device/code',
    )
  }

  return response.json() as Promise<DeviceCodeResponse>
}
```

`scope` 参数指定请求的权限范围：`repo` 允许访问仓库（包括私有仓库），`read:user` 允许读取用户信息。Scope 的设计原则是**最小权限**——只请求工具实际需要的权限。

请求成功后返回：

```typescript
interface DeviceCodeResponse {
  device_code: string       // 后续轮询用的设备码（保密，不展示给用户）
  user_code: string         // 展示给用户的验证码（如 "ABCD-1234"）
  verification_uri: string  // 用户要打开的 URL
  expires_in: number        // 过期时间（秒），通常 900 秒（15 分钟）
  interval: number          // 轮询间隔（秒），通常 5 秒
}
```

注意 `device_code` 和 `user_code` 的区别：`user_code` 给人看的，短且好输入；`device_code` 给程序用的，长且随机。

### 第 2 步：展示验证码并打开浏览器

```typescript
// 显示用户码
logger.newline()
logger.plain(chalk.bold('请在浏览器中完成 GitHub 授权:'))
logger.newline()
logger.plain(`  1. 打开 ${chalk.cyan(deviceCode.verification_uri)}`)
logger.plain(`  2. 输入验证码: ${chalk.bold.yellow(deviceCode.user_code)}`)
logger.newline()

// 尝试自动打开浏览器
try {
  await open(deviceCode.verification_uri)
  logger.info('已自动打开浏览器')
} catch {
  logger.info('请手动在浏览器中打开上述链接')
}
```

`open` 库（`import open from 'open'`）封装了跨平台的"打开 URL"操作——macOS 用 `open`，Linux 用 `xdg-open`，Windows 用 `start`。如果打开失败（比如无头服务器没有浏览器），静默降级，让用户手动操作。

验证码的格式设计值得注意：GitHub 的 user_code 是 `XXXX-XXXX` 格式，8 个字符加一个连字符。这比让用户抄写一个 32 位的 UUID 友好太多。短码的碰撞概率？不用担心——user_code 和 device_code 是绑定的，而且有效期只有 15 分钟。

### 第 3 步：轮询等待授权

CLI 无法知道用户什么时候完成了浏览器里的授权操作，只能定期轮询 GitHub 的 token 端点：

```typescript
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  callbacks: DeviceFlowCallbacks,
): Promise<string> {
  const maxAttempts = 60
  for (let i = 0; i < maxAttempts; i++) {
    callbacks.onPolling()
    await sleep(interval * 1000)

    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      },
    )

    const data = (await response.json()) as Record<string, string>

    if (data.access_token) {
      return data.access_token
    }

    if (data.error === 'authorization_pending') {
      continue  // 用户还没授权，继续等
    }

    if (data.error === 'slow_down') {
      interval += 5  // GitHub 要求降低轮询频率
      continue
    }

    if (data.error === 'expired_token') {
      throw new UserError('授权已过期，请重新执行 repox login')
    }

    if (data.error === 'access_denied') {
      throw new UserError('用户拒绝了授权请求')
    }
  }

  throw new UserError('授权超时，请重新执行 repox login')
}
```

轮询过程中的四种响应：

- **`authorization_pending`** — 正常状态，用户还没完成授权，继续轮询。这是最常见的响应。
- **`slow_down`** — GitHub 觉得你轮询太频繁了，要求增加间隔。RFC 8628 规定收到 slow_down 后必须把间隔增加 5 秒。不遵守会被 rate limit。
- **`expired_token`** — device_code 过期了（超过 15 分钟），用户太慢或者忘记授权了。
- **`access_denied`** — 用户明确拒绝了授权。

`maxAttempts = 60` 是兜底防止无限循环。按默认 5 秒间隔算，60 次是 5 分钟。加上 slow_down 可能增加的间隔，实际等待时间可能更长，但不会超过 device_code 的 15 分钟有效期。

### 第 4 步：获取用户信息并保存

拿到 token 后，立即用它请求一次 GitHub API 验证 token 有效，并获取用户信息：

```typescript
const token = await pollForToken(
  clientId,
  deviceCode.device_code,
  deviceCode.interval,
  {
    onUserCode: () => {},
    onPolling: () => {
      pollingSpinner.text = '等待授权完成...'
    },
  },
)

pollingSpinner.text = '正在获取用户信息...'
const user = await fetchGitHubUser(token)
pollingSpinner.stop()

saveGitHubAuth(token, user.login)
```

`fetchGitHubUser` 很简单——调 `GET /user` 接口拿 username：

```typescript
export async function fetchGitHubUser(
  token: string,
): Promise<{ login: string }> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })

  if (!response.ok) {
    throw new NetworkError(
      'GitHub 用户信息获取失败',
      response.status,
      'https://api.github.com/user',
    )
  }

  return response.json() as Promise<{ login: string }>
}
```

为什么要在登录时就获取用户信息？两个原因：一是验证 token 确实有效（如果 token 无效，这里就会报错，比后续某个命令执行到一半才发现要好得多）；二是缓存 username，`repox whoami` 可以直接显示，不需要每次都调 API。

## 6.4 Token 安全存储

Token 拿到手了，存在哪里？这个问题比看起来复杂。

### 方案对比

**系统钥匙串（Keychain / Credential Manager）**

macOS 有 Keychain，Windows 有 Credential Manager，Linux 有 libsecret。Token 由操作系统加密存储，应用需要通过系统 API 读取。

优点：最安全，Token 加密存储，其他进程无法直接读取。

缺点：跨平台实现复杂，需要原生模块（node-keytar）；Linux 上 libsecret 在无 GUI 的服务器环境不可用；Docker 容器里基本没法用。

**加密文件**

把 Token 用密码加密后存为文件。每次读取时需要解密。

优点：比明文安全，跨平台。

缺点：密码存在哪里？又变成了鸡生蛋的问题。如果密码硬编码在代码里，等于没加密。如果每次都让用户输入密码，体验极差。

**明文文件 + 文件权限**

把 Token 以 JSON 格式存储在文件中，通过文件系统权限（`0600`）限制只有当前用户可读写。

优点：实现简单、跨平台、无外部依赖、Docker 和 CI 环境都能用。

缺点：文件在磁盘上是明文的。如果有人能登录你的账户或者获取了你的磁盘访问权限，Token 就暴露了。

repox 选择了第三种——明文文件 + 文件权限。这是 GitHub CLI、Claude Code 等工具的共同选择。原因很务实：对于开发者 CLI 工具来说，"攻击者能登录你的系统账户"这个威胁模型下，钥匙串也保护不了什么（攻击者可以直接以你的身份运行 CLI）。而钥匙串带来的跨平台复杂度和环境兼容性问题是实打实的。

### 存储实现

```typescript
// Token 存储路径
function getTokenPath(): string {
  return path.join(getGlobalConfigDir(), 'credentials.json')
}

// 保存 token
export function saveTokens(tokens: TokenStore): void {
  const dir = getGlobalConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  const tokenPath = getTokenPath()
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600, // 仅当前用户可读写
  })
}
```

`mode: 0o600` 是关键——八进制 600 表示"owner 可读写，group 和 others 无任何权限"。即使同一台机器上的其他用户也无法读取这个文件。

`credentials.json` 的结构：

```typescript
interface TokenStore {
  github?: {
    token: string
    username: string
    loginAt: string
  }
  ai?: {
    apiKey: string
    configuredAt: string
  }
}
```

存储了 token 本身、关联的用户名（用于 `whoami` 展示），以及登录时间（用于排查问题——"这个 token 是什么时候创建的"）。

配置（`config.json`）和凭证（`credentials.json`）分开存储，不混在同一个文件里。原因是配置可能被用户截图、分享到群里问"我这个配置对不对"，如果 token 混在里面就泄露了。分开存储从物理上杜绝了这种误操作。

### 读取时的优先级

```typescript
export function getGitHubToken(): string | undefined {
  // 环境变量优先
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN
  }
  const tokens = loadTokens()
  return tokens.github?.token
}
```

环境变量始终优先于持久化的 token。这保证了 CI/CD 环境中通过 secrets 注入的 token 能覆盖开发者本地登录的 token——CI 机器可能用的是 bot 账号的 token，不应该用某个开发者的个人 token。

## 6.5 会话管理

### 多账号切换

有些开发者同时使用个人 GitHub 账号和公司 GitHub Enterprise 账号。repox 当前版本只支持一个 GitHub 账号（`credentials.json` 里只有一个 `github` 字段），但设计上预留了扩展空间。

一种常见的多账号设计：

```json
{
  "github": {
    "current": "personal",
    "accounts": {
      "personal": {
        "token": "ghp_xxx",
        "username": "octocat",
        "host": "github.com"
      },
      "work": {
        "token": "ghp_yyy",
        "username": "octocat-corp",
        "host": "github.example.com"
      }
    }
  }
}
```

配合 `repox login --host github.example.com` 和 `repox auth switch work` 命令，可以在多个账号间切换。GitHub CLI 就是这么做的。

### Token 刷新

GitHub 的 Personal Access Token 默认不过期（除非用户设置了过期时间）。OAuth App 颁发的 token 也没有 refresh token 机制。所以 repox 目前不需要处理 token 刷新。

但如果对接的是支持 OAuth 2.0 完整流程的服务（比如 Google、Microsoft），token 通常有过期时间，附带一个 refresh token。自动刷新的逻辑大致是：

```typescript
async function getValidToken(): Promise<string> {
  const tokens = loadTokens()
  if (!tokens.github) throw new UserError('未登录')

  // 检查 token 是否过期
  if (tokens.github.expiresAt && new Date(tokens.github.expiresAt) < new Date()) {
    // 用 refresh token 获取新的 access token
    const newToken = await refreshAccessToken(tokens.github.refreshToken)
    tokens.github.token = newToken.access_token
    tokens.github.expiresAt = newToken.expires_at
    saveTokens(tokens)
    return newToken.access_token
  }

  return tokens.github.token
}
```

### 过期处理

即使 token 本身没有过期时间，用户也可能在 GitHub 网站上手动撤销了 token。这种情况下 API 会返回 401。正确的处理方式：

```typescript
// 在 API 调用层统一处理 401
async function githubFetch(url: string, token: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (response.status === 401) {
    throw new UserError(
      'GitHub Token 已失效',
      '请运行 repox login 重新登录',
    )
  }

  return response
}
```

不要在每个命令里单独处理 401——把它放在 API 客户端层做统一拦截。这和前端的 axios 拦截器是同一个思路。

## 6.6 案例拆解：gh auth login

GitHub CLI（`gh`）的登录流程是 Device Flow 实现的标杆，值得完整拆解。

运行 `gh auth login` 后，gh 会引导用户做一系列选择：

```
$ gh auth login

? What account do you want to log into?
  > GitHub.com
    GitHub Enterprise Server

? What is your preferred protocol for Git operations on this host?
  > HTTPS
    SSH

? Authenticate GitHub CLI
  > Login with a web browser
    Paste an authentication token

! First copy your one-time code: ABCD-1234
Press Enter to open github.com in your browser...

✓ Authentication complete.
- gh config set -h github.com git_protocol https
✓ Configured git protocol
✓ Logged in as octocat
```

设计亮点：

**渐进式询问。** 不是一上来就扔一堆选项，而是一步步引导。先选 host（支持 GitHub Enterprise），再选 Git 协议（HTTPS 还是 SSH），最后选认证方式（Device Flow 还是手动粘贴 Token）。每一步的选项都控制在 2-3 个，用户不需要做复杂决策。

**多种认证方式并存。** Device Flow 是默认推荐，但也支持手动粘贴 Token（"Paste an authentication token"）。因为有些环境（无头服务器、Docker 容器）打不开浏览器，Device Flow 行不通。给用户提供退路很重要。

repox 也借鉴了这个设计：

```typescript
.option('--token <token>', '直接提供 GitHub Token（非交互式）')
.action(async (options) => {
  if (options.token) {
    // 非交互式：直接用 token 登录
    const spinner = ora('验证 Token...').start()
    try {
      const user = await fetchGitHubUser(options.token)
      spinner.stop()
      saveGitHubAuth(options.token, user.login)
    } catch (error) {
      spinner.stop()
      throw new UserError('Token 验证失败，请检查 Token 是否有效')
    }
    return
  }

  // 交互式流程...
})
```

`--token` 参数是 Device Flow 的补充——在无法打开浏览器的环境中，用户可以在另一台机器上生成 Token，然后用 `repox login --token ghp_xxx` 直接登录。

**协议配置联动。** gh 在登录成功后会自动配置 Git 的 credential helper，让 `git push` 等操作能自动使用 gh 存储的 token。这种"一次登录，处处可用"的体验很优秀。repox 目前没做这一步，但未来可以加。

**SSH Key 自动生成。** 如果用户选择 SSH 协议，gh 会询问是否自动生成 SSH Key 并上传到 GitHub。整个 SSH 配置流程完全自动化。这种主动帮用户解决关联问题的做法，是优秀 CLI 体验的体现。

## 6.7 实战：repox login / logout / whoami

把前面的知识整合起来，看 repox 鉴权系统的完整实现。

### 命令注册

```typescript
// src/commands/auth.ts
export function registerAuthCommands(program: Command): void {
  // repox login
  program
    .command('login')
    .description('登录认证')
    .option('--github', '仅登录 GitHub')
    .option('--ai', '仅配置 AI API Key')
    .option('--token <token>', '直接提供 GitHub Token（非交互式）')
    .action(async (options) => {
      // ...
    })

  // repox logout
  program
    .command('logout')
    .description('退出登录，清除保存的凭证')
    .option('--github', '仅清除 GitHub 凭证')
    .option('--ai', '仅清除 AI API Key')
    .action((options) => {
      // ...
    })

  // repox whoami
  program
    .command('whoami')
    .description('显示当前登录状态')
    .action(() => {
      // ...
    })
}
```

三个命令覆盖了认证生命周期的完整闻环：登录 → 查看状态 → 登出。

### login 的分支逻辑

login 命令有三个入口路径：

1. **`repox login --token ghp_xxx`** — 非交互式，直接用 Token 登录
2. **`repox login --github`** / **`repox login --ai`** — 指定登录类型，跳过选择
3. **`repox login`** — 交互式选择登录 GitHub 还是配置 AI API Key

```typescript
.action(async (options) => {
  if (options.token) {
    // 非交互式直接登录
    const spinner = ora('验证 Token...').start()
    try {
      const user = await fetchGitHubUser(options.token)
      spinner.stop()
      saveGitHubAuth(options.token, user.login)
    } catch {
      spinner.stop()
      throw new UserError('Token 验证失败，请检查 Token 是否有效')
    }
    return
  }

  // 交互式选择
  let scope = options.github ? 'github' : options.ai ? 'ai' : undefined
  if (!scope) {
    scope = await select({
      message: '选择登录方式',
      choices: [
        { name: 'GitHub（用于仓库分析、Code Review 等）', value: 'github' },
        { name: 'AI API Key（用于 AI 功能）', value: 'ai' },
      ],
    })
  }

  if (scope === 'github') {
    await loginGitHub()
  } else {
    await loginAI()
  }
})
```

`select` 来自 `@inquirer/prompts`，在终端渲染一个箭头选择列表。用户用上下键选择，回车确认。比让用户输入 `1` 或 `2` 更直观，也不容易出错。

### loginGitHub 的完整流程

```typescript
async function loginGitHub(): Promise<void> {
  const clientId = process.env.REPOX_GITHUB_CLIENT_ID || DEFAULT_GITHUB_CLIENT_ID

  const spinner = ora('正在请求 GitHub 授权...').start()

  let deviceCode
  try {
    deviceCode = await requestDeviceCode(clientId)
  } catch {
    spinner.stop()
    throw new UserError(
      'GitHub Device Flow 请求失败',
      '请检查网络连接，或使用 repox login --token <token> 直接登录',
    )
  }

  spinner.stop()

  // 显示用户码
  logger.newline()
  logger.plain(chalk.bold('请在浏览器中完成 GitHub 授权:'))
  logger.newline()
  logger.plain(`  1. 打开 ${chalk.cyan(deviceCode.verification_uri)}`)
  logger.plain(`  2. 输入验证码: ${chalk.bold.yellow(deviceCode.user_code)}`)
  logger.newline()

  // 尝试自动打开浏览器
  try {
    await open(deviceCode.verification_uri)
    logger.info('已自动打开浏览器')
  } catch {
    logger.info('请手动在浏览器中打开上述链接')
  }

  // 轮询等待授权
  const pollingSpinner = ora('等待授权完成...').start()

  try {
    const token = await pollForToken(
      clientId,
      deviceCode.device_code,
      deviceCode.interval,
      {
        onUserCode: () => {},
        onPolling: () => {
          pollingSpinner.text = '等待授权完成...'
        },
      },
    )

    pollingSpinner.text = '正在获取用户信息...'
    const user = await fetchGitHubUser(token)
    pollingSpinner.stop()

    saveGitHubAuth(token, user.login)
  } catch (error) {
    pollingSpinner.stop()
    throw error
  }
}
```

整个流程的 UX 编排值得注意：

- 请求 device code 时显示 spinner（"正在请求 GitHub 授权..."），因为网络请求可能需要几秒
- 拿到 user code 后 spinner 停止，切换到静态文本展示验证码——验证码必须持续可见，不能被 spinner 动画盖住
- 自动打开浏览器后，切换到新的 spinner（"等待授权完成..."），因为这个等待可能持续几十秒
- 拿到 token 后 spinner 文字变成"正在获取用户信息..."，让用户知道"已经拿到授权了，在做最后一步"

这种 spinner + 静态文本交替的节奏感，是 CLI 体验设计的细节。

### logout

```typescript
program
  .command('logout')
  .description('退出登录，清除保存的凭证')
  .option('--github', '仅清除 GitHub 凭证')
  .option('--ai', '仅清除 AI API Key')
  .action((options) => {
    if (options.github) {
      clearTokens('github')
      logger.success('GitHub 凭证已清除')
    } else if (options.ai) {
      clearTokens('ai')
      logger.success('AI API Key 已清除')
    } else {
      clearTokens()
      logger.success('所有凭证已清除')
    }
  })
```

logout 不需要确认提示。删除凭证不是危险操作——重新 login 就能恢复。加一个 "Are you sure?" 只会让高频操作变麻烦。

`clearTokens` 的实现是修改 `credentials.json` 文件，而不是删除它：

```typescript
export function clearTokens(scope?: 'github' | 'ai'): void {
  const tokens = loadTokens()
  if (scope) {
    delete tokens[scope]
  } else {
    Object.keys(tokens).forEach(
      (key) => delete tokens[key as keyof TokenStore],
    )
  }
  saveTokens(tokens)
}
```

保留文件（而不是删除）的好处是文件权限不会丢失。如果 `clearTokens` 删除了文件，下次 `saveTokens` 重新创建时如果忘了设 `0600` 权限，就会出现安全漏洞。

### whoami

```typescript
program
  .command('whoami')
  .description('显示当前登录状态')
  .action(() => {
    const info = getWhoami()
    const hasGitHub = !!getGitHubToken()
    const hasAI = !!getAIApiKey()

    logger.title('登录状态')

    if (info.github) {
      logger.plain(
        `  GitHub: ${chalk.green(info.github.username)} (登录于 ${info.github.loginAt})`,
      )
    } else if (hasGitHub) {
      logger.plain(`  GitHub: ${chalk.green('已配置')}（通过环境变量）`)
    } else {
      logger.plain(`  GitHub: ${chalk.gray('未登录')}`)
    }

    if (hasAI) {
      logger.plain(`  AI API: ${chalk.green('已配置')}`)
    } else {
      logger.plain(`  AI API: ${chalk.gray('未配置')}`)
    }

    if (!hasGitHub && !hasAI) {
      logger.newline()
      logger.info('运行 repox login 开始登录')
    }
  })
```

whoami 区分了三种状态：通过 OAuth 登录的（显示 username 和登录时间）、通过环境变量配置的（只显示"已配置"，不暴露 token 内容）、未登录的（灰色显示并提示如何登录）。

最后一个 `if` 是引导性设计——如果用户什么都没配置就运行 whoami，说明他可能刚安装工具在探索功能，这时候给一个"运行 repox login 开始登录"的提示比什么都不说更有帮助。

### 关于 GitHub OAuth App 的注册

实现 Device Flow 需要一个 GitHub OAuth App 的 Client ID。注册步骤：

1. 打开 GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Application name: `repox`
3. Homepage URL: 项目主页
4. Authorization callback URL: `http://localhost`（Device Flow 实际不用回调，但 GitHub 要求必填）
5. 勾选 "Enable Device Flow"
6. 记下 Client ID

注意：Client ID 是公开的，可以硬编码在代码里。Client Secret 才需要保密——但 Device Flow 不需要 Client Secret（它是为公开客户端设计的）。

repox 把 Client ID 硬编码为常量，同时支持环境变量覆盖（方便开发者自己注册 OAuth App 测试）：

```typescript
const DEFAULT_GITHUB_CLIENT_ID = 'Ov23lihxOMZ3poSnxx5l'

async function loginGitHub(): Promise<void> {
  const clientId = process.env.REPOX_GITHUB_CLIENT_ID || DEFAULT_GITHUB_CLIENT_ID
  // ...
}
```

代码中的 `Ov23lihxOMZ3poSnxx5l` 是本书配套项目的 GitHub OAuth App Client ID。如果你在自己的项目中使用 Device Flow，需要在 [GitHub Developer Settings](https://github.com/settings/developers) 中创建自己的 OAuth App，并勾选 **Enable Device Flow**。Client ID 是公开信息，不需要保密；但不要把 Client Secret 写进代码——Device Flow 根本不需要它。

## 小结

CLI 鉴权的核心挑战是"没有浏览器"这个约束条件下如何安全、便捷地获取和存储凭证。这一章覆盖了：

- **四种鉴权模式** — Token 直接配置（最简单）、Device Flow（最佳体验）、PKCE + 本地回调（全自动）、API Key 交互输入（最适合 AI 场景）。不是选一种，而是根据场景组合使用。
- **OAuth Device Flow** — 请求 device code → 显示 user code → 轮询 token，五步流程的每一步都有明确的错误处理策略。
- **Token 存储** — 明文文件 + 0600 权限是务实的选择。配置和凭证分文件存储，防止误泄露。环境变量优先于文件存储。
- **完整的认证生命周期** — login（获取凭证）→ whoami（查看状态）→ logout（清除凭证），三个命令覆盖全流程。

一个好的鉴权系统对用户来说是"一条命令就搞定"的事。背后的 OAuth 握手、token 轮询、安全存储，用户完全不需要知道。这就是 CLI 鉴权设计的目标——把复杂度藏在简洁的交互背后。

## 动手试一试

1. 实现 `repox login --ai` 的交互式流程：提示用户输入 API Key，用 password 组件隐藏输入，保存到 credentials.json
2. 给 `repox whoami` 添加 `--json` 输出格式，方便在脚本中使用
3. 研究 `keytar` 库，将 token 存储从明文 JSON 文件迁移到操作系统的钥匙串（macOS Keychain / Linux Secret Service）
