# 6.12 Greptile

## 定位

AI 代码审查工具 Greptile 的 MCP 集成。在 Claude Code 里查看和处理 Greptile 对 PR 的审查意见。

## 核心功能

HTTP 类型远程 MCP 服务器，地址 `api.greptile.com/mcp`。

**PR 相关工具：**
- `list_pull_requests` —— 列出 PR，支持按仓库、分支、作者、状态筛选
- `get_merge_request` —— 获取 PR 详情和审查分析
- `list_merge_request_comments` —— 获取 PR 的所有评论，支持过滤

**代码审查工具：**
- `list_code_reviews` —— 列出代码审查
- `get_code_review` —— 获取审查详情
- `trigger_code_review` —— 触发一次新的 Greptile 审查

**搜索工具：**
- `search_greptile_comments` —— 跨所有审查搜索 Greptile 的评论

**自定义规则工具：**
- `list_custom_context` / `get_custom_context` / `search_custom_context` / `create_custom_context` —— 管理组织的编码规则和模式

## 安装与配置

```
/plugin install greptile@claude-plugins-official
```

需要 Greptile 账号和 API key：

1. 到 [greptile.com](https://greptile.com) 注册，连接你的 GitHub 或 GitLab 仓库
2. 到 [API Settings](https://app.greptile.com/settings/api) 生成 API key
3. 设置环境变量：

```bash
export GREPTILE_API_KEY="your-api-key-here"
```

## 典型使用场景

**场景一：修复审查意见**

提了 PR 后 Greptile 给了一堆审查意见，"帮我看看 Greptile 在当前 PR 上的评论，逐个修复"。Claude 拉取评论，理解问题，直接改代码。

**场景二：触发审查**

代码改完想先自审，"对这个分支触发一次 Greptile review"。

**场景三：团队规范管理**

"创建一个 custom context 规则：所有 API handler 必须包含 error handling middleware"。下次审查时 Greptile 会依据这个规则检查。

## 注意事项

- 需要 Greptile 付费账号（有 API 访问权限）。
- 仓库必须先在 Greptile 平台上连接过，否则 API 查不到数据。
- Greptile 同时支持 GitHub 和 GitLab，但具体可用功能取决于你连接的平台。
