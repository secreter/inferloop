# Description 的触发艺术

## 一个不被触发的 Skill 等于不存在

你写了一个 code-review Skill，测了几遍，审查意见精准、格式漂亮。推给团队，同事兴冲冲打开 Claude Code，说了一句：

"帮我看看这个 PR"

没触发。AI 给了一个通用的代码审查回复，完全没加载你的 Skill。

同事又试了一句："这段代码写得怎么样？"

还是没触发。

为什么？因为你的 description 写的是 `"A code review tool for pull requests"`。用户说的是"看看"、"写得怎么样"，和你写的"code review"、"pull requests"对不上。

这里有一个很多人没意识到的事实：**用户不会记住 slash command**。他们不会输入 `/code-review`，他们会用自己的话说需求。如果 description 不能让 AI 在这些自然表述下触发 Skill，你写的东西就是个摆设。

Description 不是文档说明。它是触发机制。

## 触发是怎么工作的

理解触发机制才能写好 description。流程很简单：

1. 所有 Skill 的 `description` 始终在 AI 的上下文中（Level 1 加载）
2. AI 收到用户消息后，扫描所有 description，判断是否应该触发某个 Skill
3. 触发后才加载完整的 SKILL.md 正文（Level 2）

关键在第 1 步：description 是始终在场的。它和其他所有 Skill 的 description 一起，占用上下文的大约 1%（最少 8000 字符的预算）。AI 就是靠这些 description 来做"该不该用这个 Skill"的决策。

所以 description 的写作目标很明确——**让 AI 在该触发时触发，在不该触发时别触发**。

## 适度激进

大部分人写 description 太保守。来看几个版本：

```yaml
# ❌ 太模糊
description: "A code review tool"
```

AI 看到这个，心里想：什么时候算 code review？用户说"帮我看看代码"算吗？说"这个函数有没有 bug"算吗？不确定，那就不触发吧。

```yaml
# ❌ 只覆盖了一种场景
description: "Code review skill for reviewing pull requests"
```

好一点，但只管 PR。用户说"看看这段代码"不涉及 PR，不触发。

```yaml
# ✅ 覆盖了各种真实表述
description: "审查代码的质量、安全性和可维护性。当用户说 review、审查、检查代码、看看这个 PR、帮我 check 一下、这段代码有问题吗时使用。"
```

这个版本把用户可能的说法直接列了出来。AI 看到用户说"帮我 check 一下"，在 description 里找到了完全匹配的表述，触发概率大幅提升。

**策略是宁可多触发几次再收窄，不要一开始就太窄。** 触发了但不该触发，你可以调整 description 收窄范围。从来不触发，你连问题在哪都不知道。

但也有边界。这种就过头了：

```yaml
# ❌ 万能触发器
description: "Use this for anything related to code quality, testing, debugging, refactoring, or development best practices"
```

这把代码相关的操作全包了。用户说"帮我写个测试"——触发了，但你的 Skill 是做审查的，不是写测试的。误触发多了，AI 的行为反而会变混乱。

## 写作公式

一个好的 description 遵循这个结构：

```
[做什么] + [什么时候用，列举具体的用户表述]
```

前半句说能力，后半句说触发场景。触发场景要用用户的自然语言写，不是技术术语。

几个例子：

```yaml
# 部署 Skill
description: "部署应用到生产环境或预发环境。当用户说发布、上线、deploy、推到 prod、部署一下时使用。"

# 翻译 Skill
description: "翻译文档或代码注释。当用户说翻译、translate、帮我翻成英文、把这段中文转成英文时使用。"

# 数据库迁移 Skill
description: "生成和执行数据库 migration。当用户说加个字段、改表结构、migrate、建个新表时使用。"
```

多语言团队要特别注意：如果你的团队中英文混用，description 里两种语言的说法都要覆盖。"帮我 review 一下"和"帮我审查一下"是同一个意图，但 AI 不一定能跨语言推断。

## 触发评测法：20 条查询测试

写完 description，怎么知道好不好？测。

准备两组查询，各 10 条。

**应该触发的 10 条**（用各种说法、各种场景）：

```
1. "帮我看看这个 PR"
2. "review src/components/UserCard.tsx"
3. "这段代码写得怎么样"
4. "我刚写完一个 hook，你帮我检查下有没有问题"
5. "check this function for potential bugs"
6. "这个模块的代码质量怎么样"
7. "帮我 review 一下最近的改动"
8. "看看这段逻辑有没有安全问题"
9. "这个实现有没有什么坑"
10. "审查一下 utils 目录下的代码"
```

**不应该触发的 10 条**（容易误触发的近似场景）：

```
1. "帮我写一个组件"          ← 写代码，不是审查
2. "这个函数怎么调用"        ← 使用说明，不是审查
3. "重构一下这段代码"        ← 重构，不是审查
4. "帮我加个单元测试"        ← 写测试，不是审查
5. "这个 bug 怎么修"         ← 修 bug，不是审查
6. "解释一下这段代码的逻辑"  ← 解释，不是审查
7. "把这个函数的性能优化一下" ← 优化，不是审查
8. "帮我写个 API 接口"       ← 开发，不是审查
9. "生成这个 schema 的类型"  ← 生成代码，不是审查
10. "debug 一下为什么报错了" ← 调试，不是审查
```

逐条测试，记录触发结果。应触发的没触发，说明 description 覆盖不够；不该触发的触发了，说明范围太宽。反复调整，直到两组都满意。

这和第 4 章的 delta 思维一脉相承——你在衡量的是 description 的精准度。

## 三种调用模式

除了 description 的措辞，还有一层控制：Skill 的调用模式配置。

| 配置 | 用户能调用 | AI 能自动触发 | 适用场景 |
|------|-----------|-------------|---------|
| 默认 | 是 | 是 | 大部分 Skill |
| `disable-model-invocation: true` | 是 | 否 | 有副作用的操作（部署、发消息） |
| `user-invocable: false` | 否 | 是 | 背景知识，用户不需要直接调用 |

第二种特别重要。像部署、发送通知这种有副作用的 Skill，你不希望 AI 因为用户随口一句"发一下"就自动触发。设成 `disable-model-invocation: true`，用户必须显式地用 `/deploy` 来调用。

第三种适合那些"AI 应该知道但用户不需要关心"的 Skill，比如团队编码规范、项目上下文信息。

## 实战：从初版到优化版

看一个完整的迭代过程。

**初版**：

```yaml
description: "Review code for quality issues"
```

测试结果：20 条查询中，应触发 10 条只触发了 4 条，不该触发 10 条误触发 0 条。精准但太窄。

**第二版**，扩大覆盖面：

```yaml
description: "审查代码的质量和安全性。当用户说 review、看看代码、检查代码、帮我 check 一下时使用。"
```

测试结果：应触发 10 条触发了 7 条，误触发 1 条（"重构一下这段代码"被触发了）。覆盖面上来了，但有一条误触发。

**第三版**，微调边界：

```yaml
description: "审查代码的质量、安全性和可维护性，给出审查意见但不修改代码。当用户说 review、审查、检查代码、看看这个 PR、帮我 check 一下、这段代码有问题吗、代码质量怎么样时使用。不用于写代码、重构或修 bug。"
```

测试结果：应触发 10 条触发了 9 条，误触发 0 条。加了"不修改代码"和排除场景的说明后，AI 能更好地区分"审查"和"重构"。

三轮迭代，每轮改几个词，效果从 40% 到 90%。

## 反模式

最后说一个常见的坑。

有人图省事，把 description 写成大而全的触发器：

```yaml
description: "Use this skill whenever the user mentions anything about code quality, testing, debugging, refactoring, or development best practices"
```

看起来覆盖面很广，实际效果很差。因为太多不相关的查询都会触发它——用户问怎么写测试，触发了你的 code-review Skill；用户想 debug，也触发了。AI 加载了一堆审查指令去做调试的事，输出反而更差。

**description 的目标是精准，不是广泛。** 宁可列 10 个具体的触发短语，也不要写一句模糊的万能描述。
