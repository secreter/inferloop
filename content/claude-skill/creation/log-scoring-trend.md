# 审查日志、自评分与质量追踪

你的 code-review Skill 上线一个月了，效果怎么样？

"感觉还不错"不是答案。上周三那次审查漏掉了一个空指针，你还记得吗？上个月的 Critical 问题比这个月多还是少？Skill 的指令改过两次，改完是变好了还是变差了？

凭感觉管理 Skill 质量，和凭感觉管理代码质量一样不靠谱。你需要数据。

本章把三件事串起来：记录日志、让 Skill 自我评分、追踪质量趋势。上一章写的脚本是基础，这一章在它上面建一套完整的度量体系。

## 审查日志的设计

格式选 JSONL——每行一条 JSON 记录。选它不选 JSON 数组有两个原因：追加写入不需要读取整个文件，解析时可以逐行处理，不怕文件大了内存爆掉。

每条记录长这样：

```json
{
  "timestamp": "2025-03-15T10:30:00Z",
  "pr": "456",
  "total": 8,
  "critical": 1,
  "warning": 4,
  "suggestion": 3,
  "filesReviewed": 5,
  "score": 7,
  "rulesHit": ["security", "react", "base"],
  "selfScore": { "coverage": 0.8, "accuracy": 0.9, "depth": 0.7 }
}
```

`rulesHit` 记录本次审查触发了哪些规则文件，方便后续分析哪些规则使用频率高。`selfScore` 是下面要讲的自评分。

日志放在 `data/review-metrics.jsonl`。是否提交到 git 看团队偏好——提交的好处是有历史记录，不提交的好处是不污染 git log。折中方案是放在一个独立的分支上。

## 自评分机制

脚本能统计出"发现了几个问题"，但统计不出"发现的问题质量怎么样"。5 个 Warning 全是格式问题，不如 1 个 Warning 指出了一个竞态条件。

让 Skill 在审查结束后对自己的输出打分。三个维度：

- **覆盖率 (coverage)**：审查了多少比例的变更文件。0 到 1 之间。如果 PR 改了 10 个文件，Skill 只看了 6 个，覆盖率是 0.6。
- **准确率 (accuracy)**：提出的问题中，有多少是真实存在的。0 到 1 之间。这个依赖 AI 的自我判断——它知道自己是不是在硬凑问题。
- **深度 (depth)**：是否发现了需要理解业务逻辑才能看出的问题。0 到 1 之间。只挑格式问题是 0.2，发现了逻辑漏洞是 0.8。

在 SKILL.md 中加入自评指令：

```markdown
## 自我评分

审查完成后，对本次审查质量进行诚实评估（不要虚高）：
- coverage：你实际审查了变更文件的多大比例？跳过的文件算 0。
- accuracy：你提出的问题中，有多少是你确信真实存在的（而非"以防万一"的过度警告）？
- depth：你是否发现了需要理解调用链或业务逻辑才能看出的深层问题？全是表面问题给低分。

以 JSON 格式输出 selfScore，例如：{"coverage": 0.8, "accuracy": 0.9, "depth": 0.7}
```

"诚实评估"和"不要虚高"这两句不是客气话。不写的话，AI 倾向于给自己打高分。加了这两句，它会更保守一些。当然，自评分本身就有误差，但有数据总比没数据强，尤其是看趋势的时候。

## 质量趋势追踪

单次评分意义不大，连续 20 次的趋势才有用。写一个趋势报告脚本：

```typescript
// 执行方式: npx tsx trend-report.ts [log-file]
// scripts/trend-report.ts
import { readFileSync } from 'fs';

interface ReviewRecord {
  timestamp: string;
  pr: string;
  score: number;
  selfScore?: { coverage: number; accuracy: number; depth: number };
}

const lines: ReviewRecord[] = readFileSync('data/review-metrics.jsonl', 'utf-8')
  .trim().split('\n')
  .map(line => JSON.parse(line));

const recent = lines.slice(-20);
const avgScore = recent.reduce((s, r) => s + r.score, 0) / recent.length;
const avgSelfScore = {
  coverage: recent.reduce((s, r) => s + (r.selfScore?.coverage || 0), 0) / recent.length,
  accuracy: recent.reduce((s, r) => s + (r.selfScore?.accuracy || 0), 0) / recent.length,
  depth: recent.reduce((s, r) => s + (r.selfScore?.depth || 0), 0) / recent.length,
};

console.log(`=== 最近 ${recent.length} 次审查趋势 ===`);
console.log(`平均评分: ${avgScore.toFixed(1)} / 10`);
console.log(`覆盖率: ${(avgSelfScore.coverage * 100).toFixed(0)}%`);
console.log(`准确率: ${(avgSelfScore.accuracy * 100).toFixed(0)}%`);
console.log(`深度: ${(avgSelfScore.depth * 100).toFixed(0)}%`);

// 退化检测：最近 5 次 vs 之前 5 次
if (recent.length >= 10) {
  const last5 = recent.slice(-5);
  const prev5 = recent.slice(-10, -5);
  const last5Avg = last5.reduce((s, r) => s + r.score, 0) / 5;
  const prev5Avg = prev5.reduce((s, r) => s + r.score, 0) / 5;
  const drop = prev5Avg - last5Avg;
  if (drop > 1) {
    console.log(`\n⚠️ 警告：最近 5 次评分比之前下降了 ${drop.toFixed(1)} 分，检查是否有指令退化`);
  }
}
```

退化检测是这个脚本最有用的部分。Skill 的指令改了一个词、上下文稍微变长了一点、模型版本更新了——都可能导致质量波动。没有趋势数据，你根本不知道是什么时候开始变差的。

## 与 Git 集成

在 SKILL.md 的 frontmatter 中预授权脚本和 git 操作：

```yaml
allowed-tools: "Bash(npx tsx *) Bash(git add *) Bash(git commit *)"
```

每次审查后，append-log.ts 会自动 commit 日志文件。commit message 固定格式 `chore: append review log for PR #xxx`，方便用 `git log --grep` 过滤。

## 实战：code-review v7 — 日志 + 评分 + 趋势

v7 的 SKILL.md 在 v6 基础上加了自评分指令和完善的后处理流程。关键变化：

```yaml
---
name: code-review
description: "审查代码的质量、安全性和可维护性。当用户说'review 这段代码'、'帮我看看这个 PR'、'检查一下代码质量'时使用。"
argument-hint: "[PR-number]"
allowed-tools: "Bash(npx tsx *) Bash(gh pr *) Bash(git add *) Bash(git commit *)"
---
```

body 中新增的部分：

```markdown
## 自我评分

审查完成后，对本次审查质量进行诚实评估（不要虚高）：
- coverage：你实际审查了变更文件的多大比例？跳过的文件算 0。
- accuracy：你提出的问题中，有多少是你确信真实存在的？
- depth：你是否发现了需要理解调用链或业务逻辑才能看出的深层问题？

以 JSON 格式输出 selfScore。

## 审查后处理

1. 将审查结果保存到 `/tmp/review-output.md`
2. 运行 `npx tsx ${CLAUDE_SKILL_DIR}/scripts/collect-metrics.ts /tmp/review-output.md` 获取统计
3. 将 selfScore 合并到统计 JSON 中
4. 运行 `npx tsx ${CLAUDE_SKILL_DIR}/scripts/append-log.ts data/review-metrics.jsonl '<合并后的JSON>'` 记录日志
5. 在审查结果末尾附上统计摘要
```

目录结构加了一个脚本：

```
.claude/skills/code-review/
├── SKILL.md
├── rules/
│   ├── base.md
│   ├── react.md
│   └── security.md
└── scripts/
    ├── collect-metrics.ts
    ├── append-log.ts
    └── trend-report.ts
```

趋势报告不需要每次审查都跑。你想看的时候手动执行 `npx tsx .claude/skills/code-review/scripts/trend-report.ts` 就行，或者写个周报脚本定期跑。

## 反模式：不要记录审查全文

一个常见的错误做法是把 AI 的完整审查输出都存进日志。一次审查输出可能几千字，20 次就是几万字，日志文件几天就膨胀到解析困难。

review-metrics.jsonl 只记结构化摘要——数字、评分、命中的规则。需要回看某次审查的完整输出，去 git log 或者 PR 的评论区找。日志文件的职责是提供可计算的指标，不是做归档。
