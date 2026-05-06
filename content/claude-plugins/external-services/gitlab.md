# 6.2 GitLab

## 定位

GitLab 官方 MCP 集成，覆盖仓库、MR、CI/CD、issue、wiki 等 DevOps 全链路操作。

## 核心功能

HTTP 类型远程 MCP 服务器，托管在 `gitlab.com/api/v4/mcp`。接入后可操作 GitLab 平台的主要功能：

- 仓库管理
- Merge Request（创建、review、合并）
- CI/CD Pipeline 查看与触发
- Issue 管理
- Wiki 编辑
- 项目搜索

## 安装与配置

```
/plugin install gitlab@claude-plugins-official
```

这个插件的 `.mcp.json` 里没有写 Authorization header，说明认证走的是 GitLab 自己的 OAuth 流程——连接时 GitLab MCP 端点会引导你完成授权。

如果你用的是自托管 GitLab 实例，可能需要手动修改 `.mcp.json` 中的 URL 指向你的实例地址。

## 典型使用场景

**场景一：MR 管理**

"帮我创建一个 MR，从 feature/auth 合到 main，title 写 'Add OAuth2 login'"——一句话搞定，不用去 web 界面点。

**场景二：Pipeline 排查**

"最近一次 CI 失败了，帮我看看是哪个 stage 挂的，日志报了什么错"。

**场景三：跨项目搜索**

在 GitLab group 下有十几个微服务仓库，"帮我找一下哪个仓库用了 redis 7.x 的 client"。

## 注意事项

- 默认连接 gitlab.com。自托管实例需要改 URL。
- 认证方式依赖 GitLab MCP 端点的实现，首次使用可能需要在浏览器完成 OAuth 授权。
- CI/CD 操作（触发 pipeline、重试 job）可能需要对应的 role 权限（至少 Developer）。
