# 6.1 GitHub

## 定位

GitHub 官方 MCP 服务器，把 GitHub API 直接接入 Claude Code。建 issue、review PR、搜仓库，不用切浏览器。

## 核心功能

这是一个 HTTP 类型的远程 MCP 服务器，由 GitHub（Copilot 团队）托管在 `api.githubcopilot.com`。接入后 Claude 可以调用 GitHub 的完整 API——包括但不限于：

- 仓库管理（创建、fork、搜索）
- Issue 操作（创建、评论、关闭、打标签）
- Pull Request 全流程（创建、review、merge、查看 diff）
- 代码搜索
- 分支管理
- Release 发布

具体暴露哪些工具取决于 GitHub 服务端，会随 Copilot MCP 的版本更新而变化。

## 安装与配置

```
/plugin install github@claude-plugins-official
```

需要一个 GitHub Personal Access Token (PAT)。到 GitHub → Settings → Developer settings → Personal access tokens 生成，按需勾选权限（至少 `repo` 和 `read:org`）。

token 通过环境变量传入：

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_xxxxxxxxxxxx"
```

写进 shell profile 即可。插件通过 HTTP 连接 `https://api.githubcopilot.com/mcp/`，请求头带上这个 token。

## 典型使用场景

**场景一：批量处理 issue**

你在维护一个开源项目，积攒了十几个 issue 没看。直接跟 Claude 说"帮我看看最近的 open issue，哪些是 bug 哪些是 feature request，给每个加上对应 label"。

**场景二：PR review 辅助**

"看一下 #42 这个 PR 的 diff，有没有明显问题"——Claude 拉取 diff 内容，指出潜在问题，甚至可以直接留 review comment。

**场景三：快速搜索**

"这个仓库里哪些文件引用了 deprecated 的 `oldFunction`"——用 GitHub 的代码搜索 API 直接查。

## 注意事项

- 这是远程 MCP 服务器，请求走公网到 GitHub。网络不通或者 token 过期会直接报错。
- PAT 的权限范围决定了 Claude 能做什么。如果你只给了 `read` 权限，它建不了 issue。按最小权限原则来。
- 该服务器由 GitHub Copilot 团队维护，工具列表可能随版本迭代变化。
- 对私有仓库的操作需要 token 有对应仓库的访问权限。
