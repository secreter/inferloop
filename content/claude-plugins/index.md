# 本书简介

这本书拆解 `claude-plugins-official` 仓库里的每一个插件——33 个 Anthropic 官方插件和 16 个第三方外部插件，共 49 个。

目的很简单：你装了一个插件，想知道它到底干了什么、怎么干的、有什么坑，翻到对应章节就行。如果你正在写自己的插件，这些现成的实现就是最好的参考。

## 仓库里有什么

`/plugins` 目录放 Anthropic 自己开发维护的 33 个插件，`/external_plugins` 放第三方提交的 16 个。按功能大致分这么几块：

**开发流程类**：feature-dev（功能开发工作流）、commit-commands（Git 提交流程）、code-review / pr-review-toolkit（代码审查）、code-simplifier（代码精简）。这类插件把日常开发里反复做的事串成了自动化流程。

**语言服务器类**：typescript-lsp、pyright-lsp、rust-analyzer-lsp、gopls-lsp、clangd-lsp、ruby-lsp、swift-lsp、kotlin-lsp、jdtls-lsp、csharp-lsp、lua-lsp、php-lsp。一口气 12 个 LSP 插件，给 Claude Code 接上了各语言的类型检查和智能补全能力。

**插件开发类**：plugin-dev（插件开发工具箱）、skill-creator（技能创建器）、example-plugin（示例插件）、mcp-server-dev（MCP 服务器开发）、hookify（Hook 生成器）。想写自己的插件，这几个是入口。

**项目管理与协作类**：claude-code-setup（项目初始化配置）、claude-md-management（CLAUDE.md 维护）、session-report（会话报告）、ralph-loop（迭代循环开发）。

**输出风格类**：explanatory-output-style（解释型输出）、learning-output-style（学习型输出）。这两个比较特别，不提供工具能力，而是改变 Claude 的回答风格。

**外部服务集成类**：GitHub、GitLab、Linear、Asana（项目管理），Supabase、Firebase（后端即服务），Playwright（浏览器自动化），Terraform（基础设施即代码），以及 Discord、Telegram、iMessage、fakechat（消息通道）等。这些插件通过 MCP 协议把外部服务的 API 接进 Claude Code。

**专业领域类**：math-olympiad（竞赛数学）、security-guidance（安全指导）、frontend-design（前端设计）、agent-sdk-dev（Agent SDK 开发）、playground（交互式 HTML 沙盒）。

## 本书的组织

全书按功能分 6 章加附录，每章覆盖一个领域的所有插件：

| 章 | 主题 | 包含的插件 |
|---|------|-----------|
| 第 1 章 | 开发工具与工作流 | example-plugin, claude-code-setup, claude-md-management, commit-commands, feature-dev, plugin-dev, skill-creator, mcp-server-dev, agent-sdk-dev, hookify, playground, ralph-loop, session-report |
| 第 2 章 | 代码质量与审查 | code-review, pr-review-toolkit, code-simplifier, security-guidance |
| 第 3 章 | 输出风格定制 | explanatory-output-style, learning-output-style |
| 第 4 章 | 专业领域插件 | frontend-design, math-olympiad |
| 第 5 章 | LSP 语言服务器集成 | 12 个 *-lsp 插件（含通用原理概述） |
| 第 6 章 | 外部服务集成 | GitHub, GitLab, Linear, Asana, Supabase, Firebase, Terraform, Playwright, Discord, Telegram, iMessage, Greptile, Laravel Boost, Context7, Serena, fakechat |
| 附录 | 插件开发进阶 + 常见问题 + 插件速查索引 |

每个插件的讲解遵循同一结构：它解决什么问题、目录结构与组件构成、核心实现拆解、使用示例、已知限制和注意事项。

## 这本书适合谁

你应该已经用过 Claude Code，知道怎么跟它对话、怎么让它改代码。你可能用 `/` 斜杠命令执行过一些操作，也许装过一两个插件。但对插件体系的整体架构——skills、agents、hooks、commands、MCP servers 这五种扩展点分别是什么、怎么配合——还没有系统的认识。

如果你完全没用过 Claude Code，建议先跑通官方文档的入门流程再来。这本书不会从零教你 Claude Code 的基础操作。

如果你已经是插件开发老手，这本书对你的价值在于：快速了解官方仓库里每个插件的实现细节，看看别人怎么处理你遇到过的同类问题。

## 术语约定

全书统一使用以下术语：

| 术语 | 含义 |
|------|------|
| slash command | 斜杠命令，用户在 Claude Code 中输入 `/xxx` 触发的命令 |
| skill | 技能，Claude 根据上下文自动激活或用户手动调用的能力模块 |
| agent / subagent | 代理/子代理，独立运行的子进程，有自己的上下文和工具集 |
| hook | 钩子，挂载到特定事件上的自动化脚本或 prompt |
| frontmatter | Markdown 文件顶部的 YAML 元数据块（`---` 包裹的部分） |
| MCP | Model Context Protocol，Claude 调用外部工具的协议 |
| prompt | 提示词/指令，给 Claude 的输入文本 |
