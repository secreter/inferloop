# 评测基础与思维模型

## 一个反直觉的发现

你花了两天写了一个 Skill，反复试了几轮，输出看着挺像样。于是推给团队，信心满满。

第二天同事发来消息："这跟我直接问 AI 差不多啊？"

你愣了一下，打开 Claude Code，不加载 Skill 试了一遍——发现确实差不多。

问题出在哪？你从来没有对比过"有 Skill"和"没有 Skill"的差异。你一直在看绝对输出质量，觉得"输出不错"，但从没验证过 Skill 到底带来了多少增量。

这就像发布一个性能优化但没跑 benchmark。PR 描述写着"大幅提升渲染性能"，reviewer 问你"快了多少"，你答不上来。

评测不是可选的收尾工作。它应该从你动手写 Skill 的第一天就介入。但别慌——这一章不会展开完整的评测方法论（那是第四部分的事），这里只讲三个你现在就需要知道的核心概念。

## 概念一：衡量 delta，不是绝对质量

Skill 的价值不是"有了它之后 AI 表现有多好"，而是：

**Skill 价值 = 有 Skill 时的表现 − 没有 Skill 时的表现**

这个差值才是你真正创造的东西。

举个具体的例子。你写了一个 code-review Skill，跑了 20 个测试用例：

- **没有 Skill**：AI 通用审查，pass_rate = 0.40（20 个断言通过了 8 个）
- **有 Skill**：按团队规范审查，pass_rate = 0.85（20 个断言通过了 17 个）
- **Delta = +0.45**

这是一个高价值 Skill。AI 原本只能做到 40 分的事，你帮它拉到了 85 分。

再看另一个场景。你给 AI 写了一个"生成 Git commit message"的 Skill：

- **没有 Skill**：pass_rate = 0.88
- **有 Skill**：pass_rate = 0.91
- **Delta = +0.03**

AI 本来就擅长写 commit message，你的 Skill 几乎没带来增量。这个 Skill 不值得维护。

所以，每次评测至少要跑两组：`with_skill` 和 `without_skill`。只看一组，你永远不知道自己的 Skill 到底有没有用。

## 概念二：三维指标，不是单看质量

只盯着 pass_rate 看会掉进陷阱。评测要看三个维度：

| 维度 | 指标 | 关心的问题 |
|------|------|-----------|
| 质量 | pass_rate | 断言通过率是多少？ |
| 成本 | tokens | 消耗了多少 token？ |
| 效率 | time | 花了多少时间？ |

这三者之间要找平衡。看两个真实场景：

**Skill A**：质量从 0.40 提升到 0.85（+0.45），执行时间从 12 秒增加到 22 秒，token 消耗增加 30%。质量大幅提升，成本增加可接受——值得。

**Skill B**：质量从 0.88 提升到 0.90（+0.02），token 消耗翻了一倍（因为 Skill 指令太长，references 太多）。质量几乎没变，成本翻倍——不值得。

直觉上你会觉得"质量越高越好"。但如果一个 Skill 为了多通过一条断言要多烧 5000 个 token，你得认真想想这笔账划不划算。

## 概念三：用断言定义"好"

"输出质量"是个模糊的概念。你说"审查结果挺好的"，我说"一般般"——谁对？

断言把主观判断变成客观检查。一个断言就是一个可以判定 true/false 的陈述，并且带有具体的 evidence。

**强断言**——可验证、可量化：

- "输出包含至少 3 个带严重度标记（高/中/低）的审查意见" → 数一下就知道
- "检出了第 42 行的 SQL 注入风险" → 在输出里搜一下就知道
- "生成的代码通过了 TypeScript 编译" → 跑一下就知道

**弱断言**——无法客观判定：

- "审查结果是有用的" → 谁来判断？标准是什么？
- "使用了正确的格式" → 什么是"正确的"？
- "代码质量有所提升" → 跟什么比？提升多少算数？

写断言的关键：每一条都要能回答"证据在哪"。所以每个断言要求有 `evidence` 字段——引用输出中的具体内容作为证据。不是你觉得通过了就通过了，要拿输出原文说话。

## evals.json 的最小结构

把上面三个概念落地，最终会写成一个评测文件。最简单的结构长这样：

```json
{
  "skill_name": "code-review",
  "evals": [
    {
      "id": 1,
      "prompt": "Review this React component for potential issues",
      "expected_output": "Should identify missing error boundary and unhandled promise rejection",
      "assertions": [
        { "text": "识别出缺少 Error Boundary", "passed": null, "evidence": "" },
        { "text": "指出未处理的 Promise rejection", "passed": null, "evidence": "" }
      ]
    }
  ]
}
```

几个字段的含义：

- `prompt`：给 AI 的输入，模拟真实使用场景
- `expected_output`：期望的输出方向，给评审人一个参照
- `assertions`：具体的断言列表。`passed` 初始为 `null`，跑完评测后填 `true` 或 `false`；`evidence` 填输出中的原文摘录

跑一次评测就是：把 `prompt` 分别在 `with_skill` 和 `without_skill` 两种模式下执行，然后逐条判定每个 `assertion` 是否通过，记录 evidence。最后统计 pass_rate、token 消耗、执行时间。

这就是评测的全部骨架。具体怎么批量跑、怎么自动化判定、怎么做回归测试——那是第 20 到 21 章的事。

## 带着 delta 思维往前走

这一章建立了三个概念：

1. **Delta 思维**：永远对比 with_skill 和 without_skill，衡量增量而非绝对值
2. **三维平衡**：质量、成本、效率三者取舍，不是质量越高越好
3. **强断言**：用可验证的陈述定义"好"，拿 evidence 说话

从下一章开始，我们动手创建 Skill。每写一步，你都可以回来问自己这个问题：

**我这一步改动，delta 是多少？**

能回答这个问题，你写出来的 Skill 就不会是"自我感觉良好"的产物。
