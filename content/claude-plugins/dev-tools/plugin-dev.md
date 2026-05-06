# plugin-dev：插件开发工具箱

开发 Claude Code 插件用的全套工具。包含七个 skill（覆盖插件结构、hook、MCP 集成、command、agent、skill、settings）、三个 agent（agent 生成器、插件校验器、skill 审查器）、一个八阶段引导式插件创建命令。

## 技术原理

这个插件本身就是 Claude Code 插件系统能力的集中展示——它把自己做成了最好的教学案例。

### 七个 Skill

每个 skill 遵循相同的"渐进式披露"结构：SKILL.md 主体约 1500-2000 词，包含核心 API 参考；`references/` 放详细指南；`examples/` 放可用代码；`scripts/` 放校验脚本。Claude 只有在需要细节时才会读子目录里的文件，不会一次性加载所有内容。

**plugin-structure** —— 插件目录结构和 manifest 配置。核心内容：`.claude-plugin/plugin.json` 的必填和可选字段、组件目录约定（commands/、agents/、skills/、hooks/）、`${CLAUDE_PLUGIN_ROOT}` 路径变量的用法、自动发现机制的工作方式。附带三个示例结构（最小插件、标准插件、全功能插件）。

**hook-development** —— hook 是 Claude Code 的事件驱动自动化机制。skill 覆盖了所有 hook 事件（PreToolUse、PostToolUse、Stop、SubagentStop、SessionStart、SessionEnd、UserPromptSubmit、PreCompact、Notification），两种 hook 类型（prompt 型用 LLM 做判断，command 型执行确定性脚本），以及 hook 输出的 JSON schema。附带三个实战脚本（验证文件写入、验证 bash 命令、加载上下文）和三个工具脚本（schema 校验、hook 测试、hook lint）。

**mcp-integration** —— MCP server 集成。四种 server 类型（stdio 本地进程、SSE 服务端推送、HTTP REST、WebSocket 实时），配置位置（.mcp.json 或 plugin.json 内联），环境变量展开（`${CLAUDE_PLUGIN_ROOT}` 和用户自定义变量），认证模式（OAuth、token、env var）。附带三种配置示例。

**command-development** —— slash command 开发。frontmatter 字段（description、argument-hint、allowed-tools、model），`$ARGUMENTS` 参数占位符，`!` 反引号动态上下文注入。附带十个完整命令示例。

**agent-development** —— subagent 开发。frontmatter 里的 description 格式（用 `<example>` 块写触发示例），系统提示词设计模式（分析型、生成型、校验型、编排型），AI 辅助生成流程。附带 Claude Code 内部使用的 agent 创建系统提示词作为参考。

**skill-development** —— skill 本身怎么写。description 要用第三人称（"This skill should be used when..."），正文用祈使句，触发短语要具体。基于 skill-creator 的方法论改编。

**plugin-settings** —— 插件配置存储。用 `.claude/plugin-name.local.md` 文件存配置，YAML frontmatter 做结构化数据，markdown 正文做自由文本。附带 bash 解析脚本（sed/awk/grep 实现的 frontmatter 解析器）和临时 hook 激活模式（flag 文件 + quick-exit）。

### 三个 Agent

**agent-creator** —— 给定需求描述，自动生成 agent 的 markdown 文件。它会设计标识符（kebab-case 命名），写 description 里的 `<example>` 触发块，创建系统提示词，选模型和颜色，最后用 Write 工具生成文件。颜色选择有规则：蓝/青色做分析审查、绿色做生成创建、黄色做校验、红色做安全、品红做转换创意。

**plugin-validator** —— 全面校验插件结构。检查 plugin.json 语法和字段、目录组织、command/agent/skill/hook 的 frontmatter 格式、MCP 配置、文件命名规范、安全问题（硬编码凭证、HTTP 而非 HTTPS）。输出分 Critical/Warning/Positive 三档。

**skill-reviewer** —— 审查 skill 质量。检查 description 的触发有效性（是否有具体短语、是否第三人称、长度是否合适），SKILL.md 正文质量（字数、写作风格、组织结构），渐进式披露的实现（是否把详细内容拆到 references/ 里）。

### /create-plugin 命令

八阶段引导式插件创建，类似 feature-dev 的结构化流程：

1. Discovery —— 理解插件目的
2. Component Planning —— 确定需要什么组件
3. Detailed Design —— 细化每个组件规格
4. Structure Creation —— 创建目录和 manifest
5. Component Implementation —— 逐个实现组件（过程中调用 Skill 工具加载对应的开发 skill）
6. Validation —— 跑 plugin-validator 和各种校验脚本
7. Testing —— 指导用户本地测试
8. Documentation —— 完善 README

命令的 `allowed-tools` 里包含 `Skill` 和 `Task`，这使得它能在流程中动态加载 plugin-dev 自己的 skill 和启动 agent——吃自己的狗粮。

## 安装与配置

```bash
/plugin install plugin-dev@claude-plugins-official
```

或开发时直接加载：

```bash
claude --plugin-dir /path/to/plugin-dev
```

## 使用方法

完整引导流程：

```
/plugin-dev:create-plugin 一个管理数据库迁移的插件
```

或者不带参数，让它问你：

```
/plugin-dev:create-plugin
```

也可以直接在对话里触发特定 skill：

```
我要给插件加一个 PreToolUse hook，验证文件写入操作
```

```
帮我配置一个 stdio 类型的 MCP server
```

```
创建一个代码审查 agent
```

## 使用场景

**从零开始做一个插件**。用 `/create-plugin` 走完整流程。它会问清楚需求，帮你选组件类型，创建目录结构，逐个实现每个组件，跑校验，最后生成 README。对第一次写插件的人来说，这比翻文档边看边写靠谱得多。

**给现有插件加 hook**。直接问"怎么加一个 PreToolUse hook"，hook-development skill 会给出事件类型选择、匹配规则写法、prompt 型 vs command 型的区别，还有现成的脚本模板。

**集成外部服务**。项目用了 Supabase、需要在插件里集成数据库操作？mcp-integration skill 会指导你写 .mcp.json，选 server 类型，处理认证。

**学习插件系统的内部机制**。plugin-structure skill 里对自动发现、manifest 字段、`${CLAUDE_PLUGIN_ROOT}` 路径解析的说明比官方文档还详细。不需要真的创建插件，光读这些内容就能搞清楚插件系统怎么运作。

**校验已有插件的质量**。对 Claude 说"validate my plugin"，plugin-validator agent 会从 manifest 到每个组件文件做一遍检查，报出结构问题、命名问题、安全问题。

## 局限与注意事项

- 这个插件非常大。七个 skill 加三个 agent，光核心 SKILL.md 就超过 11000 词，参考文件加起来超过 10000 词。全部加载到上下文里不现实，所以渐进式披露设计就特别重要——如果你在一次对话里频繁切换不同 skill 的话题，上下文可能会比较拥挤
- `/create-plugin` 的八阶段流程跑完需要不少时间和 token。做简单插件（比如只有一两个 command）不值得走完整流程，直接手写或者只用 plugin-structure skill 查格式就行
- command-development skill 的说明里反复提到 `commands/` 是 legacy 格式，推荐用 `skills/<name>/SKILL.md`。但实际上很多现有插件（包括 commit-commands、feature-dev）仍然用 `commands/`。新建插件按推荐的来就行，维护旧插件不用急着迁移
- agent-creator 生成的 agent 质量取决于你描述需求的清晰度。描述太模糊它会追问，但如果你给了个似是而非的描述，它可能生成一个方向偏了的 agent
- 校验脚本（validate-agent.sh、validate-hook-schema.sh 等）是 bash 写的，依赖 jq 等工具。Windows 环境可能需要 WSL
