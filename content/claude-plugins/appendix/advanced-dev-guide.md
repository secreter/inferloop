# 插件开发进阶指南

这篇面向想自己写插件的开发者。前面六章拆解了 49 个插件的实现，该轮到你自己动手了。

## 从零创建一个插件

最小可用插件只需要两个文件：

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── hello/
        └── SKILL.md
```

`plugin.json` 只有一个必填字段：

```json
{
  "name": "my-plugin"
}
```

名字用 kebab-case，全小写加连字符。这个名字会出现在 `/help` 的插件标签里，也会作为命令的命名空间前缀。

完整一点的 manifest：

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "干了什么一句话说清楚",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  }
}
```

version 遵循语义化版本号。description 会出现在插件市场的列表里，写得越具体用户越能判断要不要装。

### 本地开发测试

写好之后不用发布，直接本地加载：

```bash
claude --plugin-dir /path/to/my-plugin
```

每次改了 `hooks.json` 或 `plugin.json` 得重启 Claude Code 才能生效。改 skill、command、agent 的 markdown 内容则不需要——下次触发时自动读取最新版。

### 安装到项目

除了 `--plugin-dir`，还可以用官方安装命令：

```bash
/plugin install my-plugin@claude-plugins-official
```

或者从插件市场浏览安装：

```
/plugin > Discover
```

## 五种扩展点的进阶用法

Claude Code 的插件体系有五种扩展点：skills、commands、agents、hooks、MCP servers。前面章节在各插件的实现拆解中都涉及了，这里集中讲进阶用法。

### Skills：插件的主力

skill 是目前推荐的主力组件格式，既能做模型自动触发的知识库，也能做用户手动调用的斜杠命令。

**模型触发型 skill**——Claude 根据任务上下文自动加载：

```yaml
---
name: database-migration
description: This skill should be used when the user asks to "create a migration", "run migrations", "rollback database", or discusses database schema changes and version control.
version: 1.0.0
---
```

关键在 `description` 字段。这段文字永远驻留在 Claude 的上下文里（约 100 词），Claude 据此判断何时加载 SKILL.md 正文。触发率取决于你把用户可能说的话列得有多全。

一些写 description 的经验：

- 用第三人称："This skill should be used when..."
- 把用户可能用的原话用引号括起来："create a migration"、"rollback database"
- 覆盖同义词和不同说法
- 别太泛，否则什么请求都会触发，白白占上下文

**用户触发型 skill**——等价于斜杠命令：

```yaml
---
name: deploy
description: Deploy application to specified environment
argument-hint: <environment> [version]
allowed-tools: [Bash, Read, Grep]
---

Deploy to $1 environment.

Current version: !`git describe --tags --abbrev=0`

Steps:
1. Validate environment ($1 must be dev/staging/prod)
2. Run deployment script: !`bash ${CLAUDE_PLUGIN_ROOT}/scripts/deploy.sh $1 $2`
3. Verify deployment status
4. Report results
```

`argument-hint` 定义参数提示，`$1`、`$2` 取位置参数，`$ARGUMENTS` 取全部参数的原始字符串。`allowed-tools` 预批准工具列表——用户不会被逐个工具询问权限。

`!`\`command\`` 语法在命令加载时执行 bash 命令，结果内联到 prompt 中。这个特性在仓库的很多插件中反复出现，比如 commit-commands 里用它获取 git diff 输出。

**渐进式披露**是 skill 设计的核心原则。三级加载：

1. **元数据**（name + description）——始终在上下文中，约 100 词
2. **SKILL.md 正文**——触发时加载，控制在 1500-2000 词
3. **references/ examples/ scripts/**——按需加载，不限大小

plugin-dev 插件自身就是这个模式的范本：核心 SKILL.md 平均 1600 词，详细内容放在 references/ 目录下。hookify 的 writing-rules skill 也是一样——核心指令精简，复杂的规则引擎逻辑放在 Python 脚本里。

### Commands：遗留格式

`commands/*.md` 是老格式，功能和 `skills/<name>/SKILL.md` 完全一样，只是目录结构不同。新插件一律用 skills/ 目录。仓库里 hookify 还在用 commands/ 目录放 `hookify.md`、`list.md`、`configure.md` 等命令文件，但新开发的 plugin-dev 已经全面转向 skills/。

唯一的区别：commands/ 下的文件名就是命令名，`commands/review.md` 对应 `/review`。而 skills/ 下是目录名对应命令名，`skills/review/SKILL.md` 也对应 `/review`。

### Agents：自治子进程

agent 是能独立运行的子进程，有自己的系统提示词、工具权限和模型选择。Claude 主进程通过 Task 工具启动 agent，agent 完成任务后返回结果。

```yaml
---
name: code-reviewer
description: |
  Use this agent when the user asks to review code quality, analyze pull requests, or check for security issues. Examples:

  <example>
  Context: User just pushed new code
  user: "Review the changes I just made"
  assistant: "I'll use the code-reviewer agent for a thorough review."
  <commentary>
  Code review is a complex multi-step task suitable for autonomous agent.
  </commentary>
  </example>
model: inherit
color: cyan
tools: ["Read", "Grep", "Glob", "Bash"]
---

You are a code review specialist.

**Core Responsibilities:**
1. Analyze code for bugs, security issues, and style problems
2. Check test coverage adequacy
3. Evaluate architectural decisions

**Process:**
1. Read changed files
2. Identify patterns and anti-patterns
3. Cross-reference with project conventions
4. Generate structured report

**Output Format:**
## Review Summary
- Critical: [count]
- Warnings: [count]
- Suggestions: [count]

### Critical Issues
[Specific issues with file paths and line numbers]
```

几个要点：

- `description` 里的 `<example>` 块决定了 Claude 何时启动这个 agent。写 2-4 个覆盖不同场景的例子
- `model: inherit` 表示用跟主进程一样的模型。需要快速响应用 `haiku`，需要深度分析用 `opus`
- `tools` 遵循最小权限原则。只读分析就给 `["Read", "Grep", "Glob"]`，别给 Write
- `color` 在 UI 里区分不同 agent。同一插件内的 agent 用不同颜色

agent 和 skill 的本质区别：skill 是知识注入，agent 是任务委派。如果任务需要多步骤自主操作（读文件、跑命令、写报告），用 agent。如果只是需要 Claude 在处理用户请求时参考某些知识，用 skill。

### Hooks：事件驱动自动化

hooks 是插件体系里最底层的扩展点。每次工具调用前后、会话开始结束、用户提交输入时，都能触发自定义逻辑。

hooks 有两种类型：

**Prompt-based hooks**——让 LLM 做决策：

```json
{
  "description": "Code quality validation hooks",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Check if this file write introduces security risks: hardcoded credentials, SQL injection, XSS. Return 'approve' if safe, 'deny' with reason if not."
          }
        ]
      }
    ]
  }
}
```

**Command hooks**——执行脚本做确定性检查：

```json
{
  "description": "Hookify plugin hooks",
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

注意 `hooks.json` 的格式：插件的 hooks.json 有一层 `"hooks"` 包装（加上可选的 `"description"`），而用户 settings.json 里的 hooks 没有这层包装，事件类型直接在顶层。

hook 脚本通过 stdin 接收 JSON 输入，stdout 输出 JSON 结果：

```typescript
// hook 收到的输入结构
interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  tool_name?: string;      // PreToolUse/PostToolUse
  tool_input?: object;     // PreToolUse/PostToolUse
  tool_result?: string;    // PostToolUse
  user_prompt?: string;    // UserPromptSubmit
}

// PreToolUse hook 的输出
interface PreToolUseOutput {
  hookSpecificOutput?: {
    permissionDecision: "allow" | "deny" | "ask";
    updatedInput?: Record<string, unknown>;
  };
  systemMessage?: string;
}

// Stop hook 的输出
interface StopOutput {
  decision: "approve" | "block";
  reason?: string;
  systemMessage?: string;
}
```

退出码的含义：
- `0`：成功，stdout 内容显示在对话中
- `2`：阻断性错误，stderr 反馈给 Claude
- 其他：非阻断性错误

九个事件类型速查：

| 事件 | 触发时机 | 典型用途 |
|------|---------|---------|
| PreToolUse | 工具执行前 | 验证、拦截、修改参数 |
| PostToolUse | 工具执行后 | 反馈、日志、后处理 |
| UserPromptSubmit | 用户提交输入 | 添加上下文、输入校验 |
| Stop | 主 agent 要停止 | 检查任务是否完成 |
| SubagentStop | 子 agent 要停止 | 检查子任务是否完成 |
| SessionStart | 会话开始 | 加载项目上下文 |
| SessionEnd | 会话结束 | 清理、保存状态 |
| PreCompact | 上下文压缩前 | 保留关键信息 |
| Notification | 通知发送时 | 日志、联动 |

`matcher` 支持精确匹配（`"Write"`）、多选（`"Read|Write|Edit"`）、通配（`"*"`）、正则（`"mcp__.*__delete.*"`）。

一个重要限制：**hooks 在会话启动时加载，修改后必须重启 Claude Code 才能生效**。这点跟 skill/command 不同。

### MCP Servers：外部服务集成

MCP（Model Context Protocol）让插件接入外部服务。在 `.mcp.json` 或 `plugin.json` 的 `mcpServers` 字段里配置。

四种传输类型：

```json
// stdio：本地进程
{
  "local-db": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
    "env": { "LOG_LEVEL": "debug" }
  }
}

// SSE：托管服务（支持 OAuth）
{
  "asana": {
    "type": "sse",
    "url": "https://mcp.asana.com/sse"
  }
}

// HTTP：REST API
{
  "api-backend": {
    "type": "http",
    "url": "https://api.example.com/mcp",
    "headers": { "Authorization": "Bearer ${API_TOKEN}" }
  }
}

// WebSocket：实时双向通信
{
  "realtime": {
    "type": "ws",
    "url": "wss://mcp.example.com/ws"
  }
}
```

MCP 工具的命名格式是 `mcp__plugin_<插件名>_<服务名>__<工具名>`。在 command/skill 里预批准 MCP 工具时要用完整名：

```yaml
allowed-tools: ["mcp__plugin_asana_asana__asana_create_task"]
```

别用通配符 `mcp__plugin_asana_asana__*`——权限应该按最小原则给。

## Prompt Engineering 在插件中的应用

翻看仓库里的插件源码会发现，很多插件的核心就是精心设计的 prompt。skill 的 SKILL.md、agent 的系统提示词、command 的指令文本——全是 prompt。甚至 prompt-based hook 本身就是一段 prompt。

### Skill 的 prompt 设计

SKILL.md 的正文就是注入 Claude 上下文的 prompt。写作要求：

- 用祈使语气（"Validate the input before processing"），不用第二人称（"You should validate..."）
- 结构化，用 markdown 标题分层
- 引用资源文件用相对路径：`references/patterns.md`
- 控制篇幅在 1500-2000 词，超出的内容放 references/

plugin-dev 插件的 7 个 skill 是最好的写作范本。每个 SKILL.md 都遵循同一结构：Overview → 核心概念 → 具体 API/格式 → 最佳实践 → 额外资源 → 实施流程。

### Agent 的系统提示词设计

agent 的 markdown 正文会成为 agent 的系统提示词。标准模板：

```markdown
You are [角色] specializing in [领域].

**Core Responsibilities:**
1. [职责一]
2. [职责二]

**Process:**
1. [步骤一]
2. [步骤二]

**Quality Standards:**
- [标准一]
- [标准二]

**Output Format:**
[输出格式说明]

**Edge Cases:**
- [边界情况一]: [处理方式]
```

这个模板在 plugin-dev 的 plugin-validator、agent-creator、skill-reviewer 三个 agent 中反复验证过。几个规律：

- 角色定义要具体。"You are an expert plugin validator specializing in comprehensive validation" 比 "You are a helpful assistant" 有效得多
- 流程步骤越详细，agent 的行为越可预测
- 输出格式一定要定义，否则每次输出的格式都不一样

### Command 中的 prompt 技巧

command/skill 的正文是给 Claude 的指令，不是给用户看的文档。hookify 的 `/hookify` 命令就是个典型——整个 `hookify.md` 是一份详细的工作流程指令，从分析用户意图到生成规则文件，一步步写清楚 Claude 该做什么。

利用 `$ARGUMENTS` 和 `$1`、`$2` 做条件分支。`$IF` 语法来自 Claude Code 的 command 模板引擎（可以在 `plugin-dev` 插件的 `skills/command-development/` 目录下看到用法示例）：

```markdown
$IF($1,
Review PR #$1,
No PR number provided. Please specify: /review-pr [number]
)
```

用 `@` 引用文件内容：

```markdown
Review @src/api/users.ts against the standards in @${CLAUDE_PLUGIN_ROOT}/references/standards.md
```

## 调试与测试

### Debug 模式

```bash
claude --debug
```

debug 模式会输出：hook 的注册和执行日志、MCP 服务器的连接过程、skill 的触发和加载、工具调用的完整输入输出。

### 测试 hook 脚本

hook 脚本可以独立测试，不需要启动 Claude Code：

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"/etc/passwd","content":"hacked"}}' | \
  bash ./hooks/scripts/validate-write.sh

echo "Exit code: $?"
```

plugin-dev 插件提供了三个实用的测试脚本：

- `validate-hook-schema.sh`：验证 hooks.json 的结构和语法
- `test-hook.sh`：用样例输入测试 hook 脚本
- `hook-linter.sh`：检查 hook 脚本的常见问题

### 测试 skill 触发

验证 skill 是否在预期的请求下触发：

1. 用 `--plugin-dir` 加载插件
2. 输入 description 里写的触发短语
3. 观察 skill 是否被加载（debug 模式下有日志）

### 测试 agent 触发

agent 的触发取决于 description 里的 `<example>` 块。测试时模拟 example 中的用户请求，检查 Claude 是否启动了 agent。

### 验证 MCP 连接

```bash
# 启动 Claude Code 后
/mcp
```

`/mcp` 命令列出所有已连接的 MCP 服务器和它们提供的工具。如果服务器没出现，检查：

- JSON 语法是否正确
- URL 是否可访问
- 认证信息是否配置

## 发布和分享

### 提交到官方市场

仓库分两个区：

- `/plugins`：Anthropic 内部开发，只有团队成员能提交
- `/external_plugins`：第三方插件，需要通过[提交表单](https://clau.de/plugin-directory-submission)申请

外部插件需要满足质量和安全标准才能通过审核。

### 本地分享

最简单的方式是让其他人 clone 你的仓库，然后用 `--plugin-dir` 加载：

```bash
claude --plugin-dir /path/to/your-plugin
```

### 发布到 npm

可以把插件发布为 npm 包，用户通过包名安装。`plugin.json` 里建议加上 `repository` 和 `homepage` 字段方便溯源。

## 实际开发中的经验和坑

### `${CLAUDE_PLUGIN_ROOT}` 必须处处使用

插件安装位置因系统和安装方式而异。所有文件路径引用——hooks.json 里的命令路径、MCP 配置里的 server 路径、skill 里引用的脚本路径——都必须用 `${CLAUDE_PLUGIN_ROOT}`。

```json
// 正确
"command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/validate.sh"

// 错误——换台机器就挂
"command": "bash /Users/alice/plugins/my-plugin/scripts/validate.sh"
```

### hooks.json 格式的两种写法别混

插件的 `hooks/hooks.json` 有一层 `"hooks"` 包装：

```json
{
  "description": "可选的描述",
  "hooks": {
    "PreToolUse": [...]
  }
}
```

而用户的 `.claude/settings.json` 里的 hooks 没有这层包装：

```json
{
  "PreToolUse": [...]
}
```

格式写错不会报错，hook 就是不触发。debug 模式下能看到加载失败的日志。

### Hook 脚本里永远 exit 0

hookify 的 pretooluse.py 有一个好习惯：在 `finally` 块里永远 `sys.exit(0)`。hook 脚本如果异常退出（非 0 非 2），会产生不可预期的行为。除非你确实要拦截操作（exit 2），否则都应该 exit 0。

```bash
#!/bin/bash
set -euo pipefail

# 读取输入
input=$(cat)

# 做检查...
# 如果有问题，输出到 stderr 并 exit 2
# 否则正常退出

exit 0
```

### Skill 的 description 写得太泛会互相抢

如果两个 skill 的 description 都写了 "when the user asks about code"，它们会互相干扰。把触发条件写得越具体越好。plugin-dev 的 7 个 skill 互不冲突，就是因为每个的触发短语都精确到了具体的术语和操作。

### Hook 改了要重启

这个前面提过，再强调一次。hooks.json 和 hook 脚本的修改需要重启 Claude Code 才生效。但 hook 脚本读取的配置文件可以热更新——hookify 就是利用这一点实现的"无需重启即时生效"：hook 脚本本身不变，每次执行时动态读取 `.claude/hookify.*.local.md` 配置文件。

### 多个 hook 并行执行

同一个 matcher 下的多个 hook 是并行执行的，无法保证执行顺序，也看不到彼此的输出。设计 hook 时要确保它们是独立的。

### 先看 example-plugin

仓库里的 `example-plugin` 虽然功能简单，但它是 Anthropic 官方维护的"标准写法参考"。每种组件的基本格式、frontmatter 字段、目录结构，都以这个插件为准。遇到不确定的写法，先翻 example-plugin。

### plugin-dev 的 /plugin-dev:create-plugin 值得体验

plugin-dev 提供了一个 8 阶段的插件创建工作流（Discovery → Component Planning → Detailed Design → Structure Creation → Implementation → Validation → Testing → Documentation）。即使不用它来生成代码，走一遍这个流程也能帮你想清楚插件的设计。
