# Claude Code 插件体系概述

Claude Code 的插件体系建立在一个核心设计上：**约定优于配置的目录结构 + 自动发现机制**。你把文件放到对的位置，Claude Code 就能识别并加载它们。不需要注册表、不需要入口函数、不需要编译步骤。

## 整体架构

一个插件本质上就是一个目录。Claude Code 通过目录中 `.claude-plugin/plugin.json` 这个清单文件来识别它是不是一个插件，然后按约定扫描各子目录来发现组件。

插件提供五种扩展点：

| 扩展点 | 触发方式 | 运行形态 | 典型用途 |
|--------|---------|---------|---------|
| Commands | 用户手动输入 `/命令名` | 注入 prompt 指令 | 执行特定工作流 |
| Skills | Claude 根据上下文自动激活 | 注入 prompt 指令 | 提供领域知识和指导 |
| Agents | Claude 自主决定派遣，或用户指定 | 独立子进程 | 处理复杂多步任务 |
| Hooks | 事件驱动自动触发 | 执行脚本或 LLM prompt | 校验、拦截、注入上下文 |
| MCP Servers | 随插件启用自动启动 | 后台服务进程 | 接入外部 API 和工具 |

这五种扩展点覆盖了从"给 Claude 加知识"到"给 Claude 加工具"到"约束 Claude 行为"的全部需求。大多数插件只用到其中一两种。

## 五种扩展点详解

### Commands：斜杠命令

Commands 就是你在 Claude Code 里敲 `/xxx` 触发的东西。底层实现极简——就是一个 Markdown 文件，带 YAML frontmatter 定义元数据，正文部分是给 Claude 的指令。

文件位置：`commands/` 目录下的 `.md` 文件，或 `skills/<name>/SKILL.md`（新格式，功能完全一样）。

```typescript
// commands/review.md 被加载后的效果等价于：
interface Command {
  name: string;          // 文件名去掉 .md，如 "review"
  description: string;   // frontmatter 中的 description
  argumentHint?: string; // 提示用户输入什么参数
  allowedTools?: string[]; // 预授权的工具列表，减少权限弹窗
  model?: string;        // 覆盖默认模型
}
```

一个典型的命令文件长这样：

```markdown
---
description: 对当前分支的改动做代码审查
argument-hint: [文件路径或范围]
allowed-tools: [Read, Glob, Grep, Bash]
---

# Code Review

检查 $ARGUMENTS 指定的代码改动。

## 审查要点
1. 逻辑正确性
2. 错误处理是否完备
3. 是否有安全隐患
```

用户输入 `/review src/auth.ts` 时，`$ARGUMENTS` 会被替换成 `src/auth.ts`，整段 Markdown 作为指令注入给 Claude。

`allowed-tools` 字段值得留意。没有它的话，Claude 每次调用 Read、Bash 等工具都会弹确认框。把常用工具列在这里，命令执行过程中这些工具就自动放行了。

### Skills：自动激活的技能

Skills 和 Commands 在文件格式上几乎一样，关键区别是触发方式：Commands 由用户显式调用，Skills 由 Claude 根据对话上下文自动决定是否激活。

文件位置：`skills/<技能名>/SKILL.md`。

```markdown
---
name: security-review
description: 当用户讨论认证、权限控制、API 安全、密码处理，或修改涉及安全的文件时，应使用此技能。
version: 1.0.0
---

# 安全审查指导

在处理安全相关代码时，遵循以下原则...
```

`description` 字段是 Skills 的核心——它告诉 Claude 在什么条件下应该加载这个技能。写得太模糊，技能不会被触发；写得太宽泛，又会在不相关的场景下干扰。

实际经验：`description` 里最好包含具体的触发短语（"当用户说 xxx"）和关键词，而不是抽象的功能描述。仓库里 plugin-dev 的 7 个 Skills 在这方面做得不错，可以参考。

Skills 目录下还可以放子目录来组织辅助材料：

```
skills/
└── hook-development/
    ├── SKILL.md              # 主技能定义（自动加载）
    ├── references/           # 详细参考文档
    │   └── patterns.md
    ├── examples/             # 示例代码
    │   └── validate-write.sh
    └── scripts/              # 工具脚本
        └── validate-hook-schema.sh
```

SKILL.md 会被自动加载，子目录里的文件 Claude 按需读取。这是 plugin-dev 插件提出的"渐进式披露"（progressive disclosure）模式：先给 Claude 核心信息（约 1500 词），详细参考等它需要时再读。这个设计对控制上下文长度很有意义。

### Agents：subagent（子代理）

Agents 是独立运行的子进程，有自己的系统 prompt、可用工具集和模型配置。Claude 主进程可以根据任务复杂度自主决定派遣某个 Agent，也可以由用户指定。

文件位置：`agents/` 目录下的 `.md` 文件。

```markdown
---
name: code-reviewer
description: |
  当用户请求代码审查、PR review、代码质量分析时使用此 Agent。

  <example>
  Context: 用户提交了一个 PR
  user: "帮我 review 这个 PR"
  assistant: "我来派遣代码审查 Agent 进行专业审查。"
  <commentary>
  涉及系统性代码审查，适合使用专门的 Agent。
  </commentary>
  </example>

model: inherit
color: blue
tools: ["Read", "Grep", "Glob"]
---

你是一个专业的代码审查专家。

**核心职责：**
1. 检查代码逻辑正确性
2. 识别潜在 bug 和安全风险
3. 评估代码可维护性

**审查流程：**
1. 先通读所有改动，建立整体理解
2. 逐文件检查...
```

几个关键点：

**`description` 里的 `<example>` 块**不是装饰，Claude 靠这些例子来判断什么时候该派遣这个 Agent。没有 example 的 Agent 基本等于没有自动触发能力。

**`model` 字段**控制 Agent 用哪个模型。绝大多数情况用 `inherit`（跟主进程一样）就行。只有当你明确知道某个 Agent 的任务简单到 Haiku 就够、或者复杂到必须 Opus 时才改。

**`tools` 字段**限制 Agent 能用的工具。遵循最小权限原则——一个只做分析的 Agent 不需要 Write 权限。不设这个字段的话，Agent 拥有全部工具访问权。

**`color` 字段**纯粹是 UI 层面的区分，让你在终端里一眼看出哪个 Agent 在说话。

### Hooks：事件钩子

Hooks 是事件驱动的自动化机制。Claude Code 在执行过程中会触发一系列事件，你可以挂载脚本或 prompt 到这些事件上。

文件位置：`hooks/hooks.json`，或者在 `plugin.json` 中内联配置。

支持的事件：

| 事件 | 触发时机 | 能干什么 |
|------|---------|---------|
| `PreToolUse` | 工具调用前 | 校验参数、拦截危险操作、修改输入 |
| `PostToolUse` | 工具调用后 | 检查结果、提供反馈、记录日志 |
| `UserPromptSubmit` | 用户提交 prompt 时 | 注入上下文、校验输入 |
| `Stop` | 主 Agent 准备停止时 | 检查任务是否真的完成了 |
| `SubagentStop` | 子 Agent 准备停止时 | 同上，但针对子 Agent |
| `SessionStart` | 会话开始 | 加载项目上下文、设置环境变量 |
| `SessionEnd` | 会话结束 | 清理资源、保存状态 |
| `PreCompact` | 上下文压缩前 | 标记需要保留的关键信息 |
| `Notification` | 发送通知时 | 日志记录 |

Hooks 有两种类型：

**Command Hook**——执行一段 bash 命令，适合确定性的校验逻辑：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/validate-write.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**Prompt Hook**——让 LLM 来做判断，适合需要理解上下文的复杂场景：

```json
{
  "type": "prompt",
  "prompt": "检查这个文件写入操作是否安全。关注：路径穿越、敏感文件覆盖、凭据泄露。返回 approve 或 deny。"
}
```

`matcher` 字段决定这个 Hook 响应哪些工具调用。支持精确匹配（`"Write"`）、多选（`"Read|Write|Edit"`）、通配（`"*"`）和正则（`"mcp__.*__delete.*"`）。

一个容易踩的坑：**Hooks 在会话启动时加载，运行中改了 hooks.json 不会生效**，必须重启 Claude Code。

### MCP Servers：外部工具集成

MCP（Model Context Protocol）是 Anthropic 定义的协议，用于让 Claude 调用外部服务提供的工具。插件通过 `.mcp.json` 文件声明需要启动哪些 MCP 服务器。

文件位置：插件根目录的 `.mcp.json`。

```json
{
  "github-server": {
    "type": "http",
    "url": "https://api.githubcopilot.com/mcp/"
  }
}
```

支持四种服务器类型：

- **stdio**：本地进程，通过标准输入输出通信。适合本地工具。
- **http**：标准 HTTP REST 接口。最常见的远程服务类型。
- **sse**：Server-Sent Events，适合需要 OAuth 认证的托管服务。
- **WebSocket**：实时双向通信。

环境变量用 `${变量名}` 语法引用：

```json
{
  "db-server": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/servers/db-server.js"],
    "env": {
      "DATABASE_URL": "${DATABASE_URL}"
    }
  }
}
```

MCP 服务器启动后，它提供的工具会以 `mcp__<服务器名>__<工具名>` 的格式出现在 Claude 的工具列表中。在插件环境下，服务器名会带上插件前缀，变成 `mcp__plugin_<插件名>_<服务名>__<工具名>`——比如 Asana 插件的创建任务工具全名是 `mcp__plugin_asana_asana__asana_create_task`。

## 插件目录结构

一个完整插件的目录布局：

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # 必需：插件清单
├── commands/                 # 斜杠命令（.md 文件）
│   ├── review.md
│   └── deploy.md
├── agents/                   # subagent 定义（.md 文件）
│   └── code-reviewer.md
├── skills/                   # 技能定义（每个技能一个子目录）
│   ├── testing-guidance/
│   │   ├── SKILL.md
│   │   └── references/
│   └── api-design/
│       └── SKILL.md
├── hooks/                    # 事件钩子
│   ├── hooks.json
│   └── scripts/
│       └── validate.sh
├── .mcp.json                 # MCP 服务器配置
├── scripts/                  # 共享工具脚本
├── README.md                 # 文档
└── LICENSE
```

多数插件不需要所有这些目录。仓库里最小的插件（比如各 LSP 插件）可能只有 `.claude-plugin/plugin.json` 加一个 `.mcp.json`，或者只有 `skills/` 目录。

## 配置文件

### plugin.json

唯一必填字段是 `name`：

```json
{
  "name": "my-plugin"
}
```

完整的可选字段：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "一句话说明插件用途",
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "url": "https://yoursite.com"
  },
  "homepage": "https://docs.example.com",
  "repository": "https://github.com/you/my-plugin",
  "license": "MIT",
  "keywords": ["testing", "automation"],
  "commands": "./custom-commands",
  "agents": ["./agents", "./extra-agents"],
  "hooks": "./config/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

`commands`、`agents`、`hooks`、`mcpServers` 这几个路径字段用于指定非默认位置的组件。注意它们是**补充**而非替代——即使你指定了 `"commands": "./custom-commands"`，`commands/` 目录下的文件仍然会被加载。

路径必须是相对路径，以 `./` 开头，不能用绝对路径。

### .mcp.json

这个文件放在插件根目录，结构就是一个 JSON 对象，key 是服务器名，value 是服务器配置。前面 MCP Servers 部分已经展示过格式，不再重复。

### hooks.json

放在 `hooks/` 目录下。插件中的 hooks.json 需要用包装格式：

```json
{
  "description": "可选的描述信息",
  "hooks": {
    "PreToolUse": [...],
    "Stop": [...]
  }
}
```

注意这跟用户 settings 中直接写 hooks 的格式不同——插件格式多了一层 `"hooks"` 包装。

### 关于 ${CLAUDE_PLUGIN_ROOT}

在 hooks.json 和 .mcp.json 中引用插件内的脚本时，必须用 `${CLAUDE_PLUGIN_ROOT}` 而不是相对路径。因为插件的实际安装位置取决于用户的安装方式和操作系统，硬编码路径必然出问题。

这个环境变量在 hook 脚本执行时也可用：

```bash
#!/bin/bash
source "${CLAUDE_PLUGIN_ROOT}/lib/utils.sh"
```
