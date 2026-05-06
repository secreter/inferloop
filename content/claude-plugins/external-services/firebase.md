# 6.6 Firebase

## 定位

Google Firebase 的 MCP 集成，通过本地 `firebase-tools` CLI 运行。管理 Firestore、Auth、Cloud Functions、Hosting、Storage。

## 核心功能

这是一个本地 stdio 类型的 MCP 服务器，运行方式是 `npx firebase-tools@latest mcp`。和前面几个远程 HTTP 服务不同，它在你本地跑，通过 Firebase CLI 与 Google 后端通信。

- Firestore 数据库读写
- Authentication 用户管理
- Cloud Functions 部署和管理
- Hosting 操作
- Storage 文件管理
- 项目配置查看

## 安装与配置

```
/plugin install firebase@claude-plugins-official
```

前置条件：
1. 本地需要 Node.js（npx 可用）
2. 需要先通过 `firebase login` 完成认证——这个插件依赖本地已有的 Firebase CLI 登录态
3. 如果还没装过 firebase-tools，第一次 `npx` 会自动下载，可能需要等几秒

插件启动时会执行 `npx -y firebase-tools@latest mcp`，每次都拉最新版本。如果你网络不好或者想锁定版本，可以先全局安装一个固定版本：`npm install -g firebase-tools@13.x`。

## 典型使用场景

**场景一：Firestore 数据调试**

"查一下 Firestore 里 `/users/uid123` 这个文档的内容"，或者"把 `/config/settings` 文档的 `maintenanceMode` 改成 true"。

**场景二：Auth 用户排查**

用户说登录不了，"帮我查一下邮箱 user@example.com 在 Auth 里的状态，是不是被禁用了"。

**场景三：部署 Cloud Functions**

"把当前项目的 functions 部署一下"——前提是项目目录下有 `firebase.json` 和 functions 代码。

## 注意事项

- 本地运行，依赖 `firebase login` 的登录态。登录态过期需要重新 `firebase login`。
- `npx firebase-tools@latest` 每次拉最新版本，冷启动会慢一些。CI 环境建议锁版本。
- 操作直接作用于你当前 Firebase 项目。Firestore 的写操作是实时生效的，不可撤销——对生产数据库要谨慎。
- 多项目切换需要确认当前 CLI 指向的是哪个项目（`firebase use`）。
