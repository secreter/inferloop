# 5 分钟，评测你的第一个 Skill

前三部分你学了怎么写 Skill、怎么在团队里用 Skill。但有一个问题始终悬着：你怎么知道你的 Skill 真的有用？

不是"跑一下感觉还行"，是用数据证明它有用。

## 场景

公司要求所有源文件头部都有 license header。每次 PR 都有人忘，reviewer 每次都要手动检查。你决定写个 Skill 来做这件事。

## Skill

创建 `.claude/skills/file-header-check/SKILL.md`：

```yaml
---
name: file-header-check
description: "检查源代码文件是否包含 license header。当用户提到'检查 header'、'license 检查'、'文件头检查'时使用。"
---

检查指定目录下所有 .ts 和 .tsx 文件的头部，验证是否包含以下格式的 license header：

// Copyright (c) 2025 Acme Corp. All rights reserved.
// Licensed under the MIT License.

对于缺少 header 的文件：
- 列出文件路径
- 自动在文件头部插入 header（在 import 语句之前）

对于 header 格式不对的文件（年份错误、公司名错误）：
- 列出文件路径和当前 header
- 给出修正建议
```

10 行指令，很简单。但问题来了——这个 Skill 到底有没有用？AI 本来就知道怎么检查文件头啊。

## 写评测

创建 `.claude/skills/file-header-check/evals.json`：

```json
[
  {
    "name": "detect-missing-header",
    "description": "检测缺少 license header 的文件",
    "prompt": "检查 src/ 目录下的文件头",
    "workspace": "test-workspace-missing-header",
    "assertions": [
      "输出中包含 src/utils/format.ts",
      "输出中包含 src/components/Button.tsx",
      "输出中不包含 src/index.ts（该文件已有正确 header）"
    ]
  },
  {
    "name": "fix-wrong-year",
    "description": "检测并修正年份错误的 header",
    "prompt": "检查 src/ 目录下的文件头",
    "workspace": "test-workspace-wrong-year",
    "assertions": [
      "指出 src/api/client.ts 的 header 年份是 2023 而非 2025",
      "给出修正后的 header 内容"
    ]
  }
]
```

两个测试用例，一共 5 条断言。

## 跑评测看差异

分别跑 with_skill 和 without_skill，结果：

**没有 Skill 时**，给 AI 同样的 prompt "检查 src/ 目录下的文件头"：

- 它会检查文件头——但检查标准不确定。有时它查 license，有时它查 copyright，格式要求每次都不一样
- pass_rate：0.40（5 条断言通过了 2 条）
- 漏掉了年份错误的文件，没给出修正内容

**有 Skill 时**：

- 按照固定的 header 格式检查，找到了所有缺失和错误的文件
- pass_rate：1.0（5 条断言全部通过）
- Delta：+0.60

Delta 是 0.60——这个 Skill 的价值很明确。AI 不是不会检查文件头，但它缺乏你团队的具体标准。Skill 补上了这个缺失。

## 有意思的地方

这个例子极简，但它演示了评测的完整结构：

1. **准备 workspace**：包含已知问题的测试文件
2. **定义断言**：具体的、可验证的预期结果
3. **对比跑**：with_skill vs without_skill
4. **看 delta**：不是看绝对质量，而是看 Skill 带来了多少增量

这正是第 4 章讲过的核心概念。但在第 4 章我们只讲了思维模型，没有展开方法论。

接下来两章，我们要把评测这件事彻底讲透：怎么设计评测用例、怎么评判输出质量、怎么把评测集成到 CI 让每次 Skill 修改都自动验证。
