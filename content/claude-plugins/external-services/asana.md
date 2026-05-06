# 6.4 Asana

## 定位

Asana 项目管理平台的 MCP 集成。从 Claude Code 里创建任务、搜索项目、更新进度。

## 核心功能

SSE（Server-Sent Events）类型的远程 MCP 服务器，地址 `mcp.asana.com/sse`。可以：

- 创建和管理 task
- 搜索 project 和 task
- 更新任务状态、指派人、截止日期
- 查看 project 进度

## 安装与配置

```
/plugin install asana@claude-plugins-official
```

连接到 `https://mcp.asana.com/sse`。认证方式由 Asana MCP 端点处理，通常走 OAuth 流程。

注意这是 SSE 类型而非普通 HTTP——连接方式稍有不同，但对用户来说透明，Claude Code 内部处理了。

## 典型使用场景

**场景一：跨工具同步**

代码写完提了 PR，顺手"把 Asana 里'实现用户头像上传'这个 task 标记完成，备注 PR 链接"。

**场景二：批量建任务**

产品经理发了一份需求文档，"帮我根据这份文档在 '2024 Q2' project 下建任务，每个 feature 一个 task"。

**场景三：进度检查**

"当前 sprint 的任务完成率怎么样，还有哪些 overdue 的"。

## 注意事项

- SSE 连接需要持续的网络通道，网络不稳定时可能断连。
- Asana 的免费版和付费版功能不同，部分高级功能（自定义字段、Timeline 等）可能在免费版不可用。
- 操作权限取决于你在 Asana workspace 中的角色。
