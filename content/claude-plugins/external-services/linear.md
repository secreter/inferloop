# 6.3 Linear

## 定位

Linear 项目管理平台的 MCP 集成。在 Claude Code 里直接创建 issue、更新状态、搜索任务。

## 核心功能

HTTP 类型远程 MCP 服务器，托管在 `mcp.linear.app/mcp`。主要操作：

- 创建和管理 issue
- 更新 issue 状态（Todo → In Progress → Done）
- 搜索 workspace 内的 issue 和项目
- 管理 project 和 cycle

## 安装与配置

```
/plugin install linear@claude-plugins-official
```

连接到 `https://mcp.linear.app/mcp`，认证走 Linear 的 OAuth 流程。首次使用时会引导你在浏览器里授权。

## 典型使用场景

**场景一：开发闭环**

写完一个功能，"把 LIN-234 标记为 Done，加个评论说已在 PR #56 里实现"。代码和项目管理不用切上下文。

**场景二：快速建 issue**

发现一个 bug，随手说"在 Frontend 项目里建个 bug issue，标题 '登录页在 Safari 下样式错位'，优先级 High"。

**场景三：Sprint 回顾**

"帮我列一下当前 cycle 里还有哪些 issue 没完成"。

## 注意事项

- Linear 的 MCP 端点是官方维护的，工具列表会随 Linear 产品迭代更新。
- 需要 Linear 账号，且你的 workspace 需要有对应的功能权限。
- 操作范围取决于 OAuth 授权时选择的 scope。
