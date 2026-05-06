# claude-code-setup：项目自动化配置推荐器

分析你的代码仓库，推荐适合的 Claude Code 自动化方案——hooks、skills、MCP server、subagent、插件，每类给出 1-2 个最有价值的建议。

## 技术原理

这个插件只有一个组件：一个模型触发型 skill `claude-automation-recommender`。没有 slash command，没有 hooks，没有 agents。

触发机制靠 description 里的关键词匹配。当你对 Claude 说"帮我配置 Claude Code"、"推荐自动化方案"、"该用什么 hooks"之类的话，Claude 判断上下文匹配后，会把这个 skill 的完整内容加载进来。

skill 本体是一份结构化的分析流程指令，分三个阶段执行：

**Phase 1：代码库分析**。Claude 用 Bash、Glob、Grep 工具扫描项目：检查 package.json、pyproject.toml 等包管理文件确定技术栈；查看 .prettierrc、.eslintrc 等配置确定已有工具链；扫描 .env 文件、tests 目录、CI 配置等判断项目特征。

**Phase 2：匹配推荐**。skill 内嵌了大量"检测信号 -> 推荐方案"的映射表。比如检测到 Prettier 配置就推荐 PostToolUse auto-format hook，检测到 React 依赖就推荐 Playwright MCP server。映射表按五个维度组织：

| 维度 | 推荐内容 |
|------|----------|
| MCP Server | context7（文档查询）、Playwright（浏览器测试）、Supabase MCP、GitHub MCP 等 |
| Skills | commit command、frontend-design、feature-dev 等已有插件的 skill |
| Hooks | auto-format、auto-lint、type-check、block .env 编辑等 |
| Subagents | code-reviewer、security-reviewer、test-writer 等 |
| Plugins | plugin-dev、commit-commands、frontend-design 等 |

**Phase 3：生成报告**。按模板输出结构化报告，每个维度只推荐 1-2 项，避免信息过载。

真正有意思的是 `references/` 目录下的五个参考文件。这些不是 skill 启动时就加载的，而是 Claude 在分析过程中按需读取。这就是所谓"渐进式披露"（progressive disclosure）——metadata 始终在上下文里（约 100 词），SKILL.md 主体在触发时加载（约 2000 词），references 只在需要细节时才读。这样控制了上下文窗口的消耗。

### 参考文件内容

- `hooks-patterns.md`：各语言/框架的 hook 配置模板（Prettier、ESLint、Black、gofmt、rustfmt 等），包括检测方式和具体 JSON 配置
- `mcp-servers.md`：二十多种 MCP server 的适用场景和检测信号（context7、Playwright、Supabase、GitHub、AWS、Sentry 等）
- `skills-reference.md`：可用的官方插件 skill 列表 + 八种自定义 skill 模板（api-doc、create-migration、gen-test、new-component 等）
- `subagent-templates.md`：六种 subagent 模板（code-reviewer、security-reviewer、test-writer 等），含模型选择建议
- `plugins-reference.md`：官方插件目录，含 LSP 系列插件

## 安装与配置

```bash
# 通过插件市场安装
/plugin install claude-code-setup@claude-plugins-official

# 或本地测试
claude --plugin-dir /path/to/claude-code-setup
```

无需任何配置。这个 skill 是只读的，不会修改任何文件。

## 使用方法

不需要打 slash command。直接在对话里说：

```
推荐一下这个项目适合什么自动化方案
```

```
我该给这个项目配什么 hooks？
```

```
帮我设置 Claude Code
```

如果只想看某一类推荐，可以指定：

```
推荐 MCP server，不需要其他的
```

这时 skill 会切换到单维度模式，给出 3-5 个该类推荐而不是每类 1-2 个。

## 使用场景

**接手新项目时的第一步**。clone 下来，开 Claude Code，问一句"推荐自动化方案"。Claude 会扫描技术栈，告诉你该装什么 MCP server、配什么 hooks。比自己翻文档找方案快得多。

**团队统一配置**。跑一次推荐，把输出的 hooks 配置写进 `.claude/settings.json`，MCP server 配置写进 `.mcp.json`，两个文件都提交到仓库。团队成员 clone 后自动生效。

**技术选型参考**。不确定该用 skill 还是 hook 还是 subagent？这个 skill 内嵌了决策框架：重复性的后置操作用 hook，需要并行审查的用 subagent，包含模板和工作流的用 skill。

## 局限与注意事项

- 只分析不动手。输出的是推荐报告，不会帮你创建 hooks.json 或 .mcp.json。需要另外让 Claude 帮忙实现
- 参考文件里的 MCP server 列表不可能实时更新。如果你用的服务（比如某个小众数据库）不在列表里，skill 指令里写了"用 web search 查找"，但 web search 工具不一定可用
- 大型 monorepo 的分析可能不太准。skill 的检测逻辑比较简单——看根目录有没有某个文件，查依赖列表有没有某个包。子包级别的差异化推荐做不到
- Notification hooks 的配置示例是 macOS 专用的（`afplay`、`osascript`），Linux 和 Windows 用户需要自己改命令
