# Skill 的结构与配置

一个 SKILL.md 文件由两部分组成：frontmatter 和 body。没了。

```
---
name: code-review                    ← frontmatter（YAML）
description: "审查代码质量"
---
                                     ← 分隔线之后是 body
你是一个代码审查者。审查时关注……     ← body（Markdown）
```

Frontmatter 用 `---` 包裹，里面是 YAML 格式的元数据，告诉平台"这个 Skill 叫什么、什么时候触发、给它什么权限"。Body 是 Skill 被触发后 AI 读到的完整指令——你的所有策略、规则、输出格式，全写在这里。

两者分工明确：frontmatter 管调度，body 管执行。

## Frontmatter 全字段

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `name` | string | Skill 的唯一标识，也是 `/slash-command` 的名字。kebab-case，最长 64 字符 | `code-review` |
| `description` | string | 告诉 AI 何时触发这个 Skill。最长 1024 字符，建议控制在 250 字符以内。写得越具体，误触发越少 | `"审查代码的质量、安全性和可维护性。当用户说'review 这段代码'或'检查一下代码质量'时使用。"` |
| `argument-hint` | string | 用户输入 `/name` 后的自动补全提示 | `[PR-number]` |
| `disable-model-invocation` | boolean | 设为 `true` 后 AI 不会自动触发，只能用户手动 `/name` 调用 | `true` |
| `user-invocable` | boolean | 设为 `false` 后用户看不到这个 Skill，只有 AI 在执行其他任务时能内部调用 | `false` |
| `allowed-tools` | string / list | 预授权的工具列表，跳过运行时的权限确认弹窗 | `Bash(git add *) Bash(git commit *)` |
| `model` | string | 覆盖默认模型 | `claude-sonnet-4-20250514` |
| `effort` | string | 覆盖推理努力等级 | `high` |
| `context` | string | 设为 `fork` 时在独立子代理中运行，不污染主对话上下文 | `fork` |
| `agent` | string | 当 `context: fork` 时指定子代理类型 | `Explore` |
| `hooks` | object | Skill 生命周期钩子，可在触发前后执行脚本 | 见下方说明 |
| `paths` | string / list | 限制 Skill 只在匹配路径时激活 | `src/**/*.ts` |
| `shell` | string | body 中内联命令使用的 shell | `bash` |

几个容易忽略的点：

- `description` 不是给人看的摘要，是给 AI 看的触发条件。写法应该是"当用户说 X / 问 Y / 要求 Z 时使用"，而不是"这个 Skill 可以做什么"。
- `allowed-tools` 支持通配符。`Bash(git *)` 表示授权所有以 `git` 开头的命令。不需要的权限别给——最小授权原则。
- `context: fork` 适合耗时长或输出量大的任务（比如批量文件处理），子代理结束后会把结果汇报回主对话。

## 字符串替换变量

Body 中可以使用以下变量，平台会在运行时替换：

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `$ARGUMENTS` | 用户传入的完整参数字符串 | `"123 --verbose"` |
| `$0` | 第一个参数 | `123` |
| `$1` | 第二个参数 | `--verbose` |
| `${CLAUDE_SESSION_ID}` | 当前会话的唯一 ID | `sess_abc123` |
| `${CLAUDE_SKILL_DIR}` | 当前 Skill 的目录绝对路径 | `/home/user/.claude/skills/review-pr` |

实际用法：

```yaml
---
name: review-pr
description: "审查指定 PR 的代码变更。当用户说'review PR 123'或'看看这个 PR'时使用。"
argument-hint: "[PR-number]"
allowed-tools: "Bash(gh pr view *) Bash(gh pr diff *)"
---

审查 PR #$0 的代码变更。

步骤：
1. 运行 `gh pr diff $0` 获取变更内容
2. 逐文件审查，关注 bug 风险和安全问题
3. 运行 `gh pr view $0` 了解 PR 描述和上下文
4. 给出总结和改进建议
```

`${CLAUDE_SKILL_DIR}` 在 Skill 需要读取同目录下的参考文件时特别有用：

```markdown
先读取 ${CLAUDE_SKILL_DIR}/references/team-knowledge/naming-conventions.md 了解团队命名规范，
然后按规范审查代码。
```

## 作用域层级

Skill 可以放在三个位置，优先级从高到低：

| 作用域 | 路径 | 生效范围 |
|--------|------|----------|
| Enterprise | 组织托管设置 | 全组织所有成员 |
| Personal | `~/.claude/skills/` | 你参与的所有项目 |
| Project | `.claude/skills/` | 仅当前项目 |

同名 Skill 的覆盖规则：高优先级赢。如果你在 Personal 和 Project 都有一个 `code-review`，Personal 的生效。

Monorepo 场景：嵌套目录中的 `.claude/skills/` 也会被自动发现。比如 `packages/frontend/.claude/skills/` 下的 Skill，在整个 monorepo 中都可用。

选择哪个作用域？一个简单的判断标准：

- 你个人的工作习惯（翻译风格、解释偏好）→ Personal
- 团队的工程规范（review 标准、提交格式）→ Project，提交到 git
- 组织级安全策略 → Enterprise

### Skill 与 CLAUDE.md 的区别

新手常见的困惑：什么东西该写在 CLAUDE.md 里，什么该做成 SKILL.md？

| | CLAUDE.md | SKILL.md |
|---|-----------|----------|
| 加载时机 | 始终在上下文中 | 触发时才加载 |
| 定位 | 项目级背景知识和规则 | 按需触发的能力包 |
| 触发方式 | 自动，每次对话都在 | 通过 description 匹配或 /命令 |
| 评测体系 | 无 | 有（evals.json + benchmark） |
| 生命周期 | 随项目存在 | 有独立的创建/迭代/退出流程 |

判断标准：

- 所有对话都需要的背景信息（项目架构、技术栈、编码规范）→ CLAUDE.md
- 特定场景按需使用的能力（代码审查、生成 changelog、部署）→ SKILL.md

一个典型的错误是把 review 规则全塞进 CLAUDE.md。这意味着你每次跟 Claude 聊天——哪怕只是问一个语法问题——都得带上几百行 review 规则。浪费 token，还可能干扰无关任务。反过来，把"本项目用 TypeScript + React，包管理器是 pnpm"写成 Skill 也不合适，因为几乎每次对话都需要这个信息。

简单记：**CLAUDE.md 是"我是谁"，SKILL.md 是"我能做什么"。**

## 平台演进与兼容性

Skill 不是 Claude Code 的私有格式。Agent Skills 是一个开放规范（agentskills.io），目前已有 30 多个平台支持。

这意味着两件事：

第一，你写的 SKILL.md 可以在其他支持该规范的平台上运行，不被锁定。

第二，Claude Code 的 frontmatter 字段可能随版本迭代增减。建议只依赖规范中明确定义的字段（`name`、`description` 等核心字段不会变），平台特有的扩展字段加上注释说明来源。

## 实战：创建 code-review v1

回到第 1 章的 code review 场景。现在你已经了解了完整的配置选项，来创建一个最小但完整的版本：

```bash
mkdir -p .claude/skills/code-review
```

`.claude/skills/code-review/SKILL.md`：

```yaml
---
name: code-review
description: "审查代码的质量、安全性和可维护性。当用户说'review 这段代码'、'帮我看看这个 PR'、'检查一下代码质量'时使用。"
---

你是一个严格但友善的代码审查者。审查时关注：

1. **Bug 风险**：空指针、未处理异常、边界条件
2. **安全问题**：XSS、注入、敏感信息泄露
3. **可维护性**：命名清晰度、函数长度、重复代码

对每个问题标注严重度：🔴 Critical / 🟡 Warning / 🔵 Suggestion

最后给出总体评价和一个 1-10 的评分。
```

15 行。没有 `allowed-tools`，没有 `context: fork`，没有花哨的参数传递。这就是 v1-minimal——能用，但还有很大的改进空间。对应快照目录 `skills/code-review-snapshots/v1-minimal/`。

后续章节会逐步加入参考文件、工具授权、结构化输出，把它从"能用"变成"好用"。
