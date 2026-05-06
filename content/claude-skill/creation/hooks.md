# Hooks：Skill 的行为钩子

上一章的审查后处理流程有个隐患：它依赖 AI "记得"在审查完成后运行脚本。

大部分时候它会记得。但当 PR 的 diff 特别长、上下文快撑满的时候，AI 开始丢指令。先丢的往往就是这种"善后"类的步骤——它觉得审查结果已经输出了，任务完成了，收集指标那几步就跳过了。

你可以把指令写得更强调："必须执行""不要跳过"。有用，但不根治。因为这本质上是在用"提醒"来解决"保证"的问题。

Hooks 解决的就是这个：不管 AI 做了什么、输出了多少、上下文有多长，hook 都会在指定时机自动执行。人会忘，机器不会。

## Hooks 是什么

在 Skill 的生命周期中自动触发的 shell 命令。概念和 git hooks 一样：git 有 pre-commit、post-commit，Skill 也有类似的触发点。

区别在于：SKILL.md 里的指令是"请 AI 做"，AI 可以选择做或不做；hook 是平台层面的自动执行，AI 甚至不知道它的存在。

## 典型场景

| Hook 时机 | 场景 | 示例命令 |
|----------|------|---------|
| Skill 触发后 | 确保工作区干净 | `git pull --rebase` |
| AI 回复完成后 | 收集指标、追加日志 | `npx tsx scripts/collect-metrics.ts` |
| 指标低于阈值 | 输出告警 | `echo "Review quality below threshold"` |

最常用的是"AI 回复完成后"这个时机。审查结果已经输出了，现在跑统计脚本，结果一定是完整的。

## 配置方式

Hooks 在 `.claude/settings.json` 中配置。这是团队级别的配置，提交到仓库后所有人共享：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Skill:code-review",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/skills/code-review/scripts/collect-metrics.ts /tmp/review-output.md > /tmp/review-metrics.json"
          },
          {
            "type": "command",
            "command": "npx tsx .claude/skills/code-review/scripts/append-log.ts data/review-metrics.jsonl \"$(cat /tmp/review-metrics.json)\""
          }
        ]
      }
    ]
  }
}
```

`PostToolUse` 是触发时机——在工具调用完成后执行。`matcher` 指定只对 code-review Skill 生效。`hooks` 数组里的命令按顺序执行。

还有一种更简单的配置方式，直接在 SKILL.md 的 frontmatter 里定义：

```yaml
---
name: code-review
hooks:
  post-run: "npx tsx ${CLAUDE_SKILL_DIR}/scripts/collect-metrics.ts /tmp/review-output.md | npx tsx ${CLAUDE_SKILL_DIR}/scripts/append-log.ts data/review-metrics.jsonl"
---
```

两种方式的区别：settings.json 适合统一管理多个 Skill 的 hooks，frontmatter 适合 Skill 自包含。如果这个 Skill 会分享给其他团队用，放 frontmatter 更方便，拿走一个目录就是完整的。

> **格式说明**：frontmatter 中 `hooks` 字段的具体 schema 取决于 Claude Code 的版本，可能随平台更新变化。上面的 `post-run` 写法是简化示例。实际使用时请参考 Claude Code 的最新文档确认支持的 hook 事件名称和格式。settings.json 中的 `PostToolUse` 格式是目前最稳定的配置方式，推荐优先使用。

## 实战：code-review v8 — 加入 hooks

v8 的变化集中在两处：把后处理从指令移到 hook，加入评分告警。

SKILL.md 的 frontmatter 变化：

```yaml
---
name: code-review
description: "审查代码的质量、安全性和可维护性。当用户说'review 这段代码'、'帮我看看这个 PR'、'检查一下代码质量'时使用。"
argument-hint: "[PR-number]"
allowed-tools: "Bash(npx tsx *) Bash(gh pr *)"
---
```

注意 `allowed-tools` 里去掉了 `Bash(git add *)` 和 `Bash(git commit *)`——因为 git 操作现在由 hook 中的脚本自动完成，不再需要 AI 来执行。

对应的 `.claude/settings.json` 配置：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Skill:code-review",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/skills/code-review/scripts/collect-metrics.ts /tmp/review-output.md > /tmp/review-metrics.json"
          },
          {
            "type": "command",
            "command": "npx tsx .claude/skills/code-review/scripts/append-log.ts data/review-metrics.jsonl \"$(cat /tmp/review-metrics.json)\""
          },
          {
            "type": "command",
            "command": "node -e \"const m=JSON.parse(require('fs').readFileSync('/tmp/review-metrics.json','utf-8')); if(m.score<6) console.log('⚠️ 审查评分 '+m.score+'/10，低于阈值，建议检查 Skill 指令是否需要调整')\""
          }
        ]
      }
    ]
  }
}
```

第三个 hook 是评分告警：如果这次审查评分低于 6 分，输出一条警告。这不是给 AI 看的——是给你看的。连续几次低分，说明 Skill 的指令或规则需要调整了。

SKILL.md body 中，原来的"审查后处理"章节可以简化：

```markdown
## 审查后处理

审查完成后，将完整的审查结果保存到 `/tmp/review-output.md`（包含问题列表、评分和 selfScore）。
后续的指标收集和日志记录由 hook 自动完成，不需要手动执行脚本。
```

从一整段步骤说明变成一句话。AI 只需要做一件事：把输出存到固定路径。剩下的全交给 hook。

## Hooks vs Skill 指令

这两种机制不是替代关系，是互补关系：

| | Skill 指令 | Hook |
|---|-----------|------|
| 执行者 | AI | 系统 |
| 确定性 | AI 可能跳过 | 每次都执行 |
| 灵活性 | 可以根据情况调整 | 固定流程 |
| 适合场景 | 需要判断力的步骤 | 机械性的后处理 |

"需要判断力"的例子：决定要不要查看某个文件的 git 历史——这取决于审查中发现了什么，适合用指令让 AI 自己决定。

"机械性后处理"的例子：收集指标、追加日志、发告警——不管审查结果是什么，这些步骤都要做，适合用 hook。

原则说起来很简单：**确定性的后处理用 hook，需要判断力的用指令。** 分不清的时候，先用指令，等你发现 AI 经常跳过它的时候再改成 hook。

## v6 到 v8 的演进回顾

三章走下来，code-review Skill 经历了一次架构升级：

- **v6**（第 11 章）：加入脚本，AI 负责调用
- **v7**（第 12 章）：加入自评分和趋势追踪，开始用数据衡量质量
- **v8**（第 13 章）：后处理从指令移到 hook，执行确定性从"大概率"变成"必定"

这个演进过程本身就是一个通用模式：先让 AI 手动做，观察哪些步骤是固定的，然后把固定步骤抽成脚本，最后用 hook 保证脚本一定执行。不需要一步到位，先跑起来再优化。
