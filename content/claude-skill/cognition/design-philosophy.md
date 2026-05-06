# 第 2 章 Skill 的设计哲学

## 一条被忽视的指令

上个月我在一个代码审查 Skill 里写了这么一条：

```
MUST ALWAYS check for null values before accessing nested properties.
```

全大写，够醒目了吧？结果跑了十几轮测试，AI 该漏检的还是漏检。我甚至加了感叹号，加了"CRITICAL"前缀，毫无改善。

我一开始觉得是模型不行。后来我把这条指令改成了：

```
访问嵌套属性前检查 null。我们的 production 代码里因为 `user.profile.avatar`
这类链式访问导致过 3 次 P0 事故，Sentry 上标记为 "Cannot read property of undefined"。
TypeScript 的可选链（?.）不够，因为我们需要在 null 时走降级逻辑而不是静默返回 undefined。
```

效果立刻不一样了。AI 不仅开始检查 null，还能在某些场景下主动判断"这里其实不需要检查，因为上游已经做了校验"。

这件事让我意识到：写 Skill 不是写规则手册。你面对的不是一个需要被条条框框约束的执行器，而是一个理解力很强、但完全没有你的业务上下文的同事。你不需要对他吼"必须这样做"，你需要告诉他"我们为什么这样做"。

skill-creator——Anthropic 官方出品的那个"用来创建 Skill 的 Skill"——在它自己的 SKILL.md 里把这条经验写得很直白：

> Try hard to explain the **why** behind everything you're asking the model to do. If you find yourself writing ALWAYS or NEVER in all caps, that's a yellow flag — reframe and explain the reasoning.

这不是客气话。这是从大量迭代中沉淀出来的工程结论。本章要拆解的，就是 skill-creator 背后的六条设计原则。

## 原则一：Theory of Mind > Rigid Rules

你可能在各种 prompt engineering 教程里见过这种写法：

```markdown
## Rules
- MUST use TypeScript strict mode
- NEVER use any type
- ALWAYS add error handling for async operations
```

早期模型对全大写确实更敏感。但现在的大模型——特别是经过 RLHF 对齐的模型——对这种命令式语气反而容易产生两个问题：一是注意力稀释，当你有 20 条 MUST 的时候，每条的权重都在下降；二是丧失灵活性，AI 会机械执行而不去判断上下文。

对比一下：

```markdown
❌ MUST ALWAYS use try-catch for async operations
```

```markdown
✅ 用 try-catch 包裹异步操作。我们的错误监控（Sentry）只能捕获被 catch 的异常，
   未包裹的 Promise rejection 会变成沉默失败，运维团队看不到任何告警。
```

第二种写法的好处不只是"更礼貌"。当 AI 知道原因是 Sentry 的捕获机制时，它能自己推断出：单元测试里的异步操作不需要 try-catch，因为测试框架有自己的错误处理；但 API handler 里的绝对要包裹，因为那是 Sentry 监控的核心路径。

你给了 why，AI 就能处理你没列举的边界情况。你只给了 what，AI 就只能做你说的那些——多一步不走，少一步不觉得有问题。

skill-creator 自己的 SKILL.md 有 470 多行，里面没有一个全大写的 MUST。它的每条指令都带着工程理由。比如它不是说"MUST run baseline tests"，而是解释为什么要跑基线："The user is iterating on only a few examples...if the skill works only for those examples, it's useless."

## 原则二：渐进式信息披露

你不会在新同事入职第一天就把团队所有文档链接甩给他。你会先告诉他"我们是做什么的"，等他上手了再介绍代码规范，遇到具体问题了再指向架构文档。

Skill 的加载机制也是这个思路，分三级：

**Level 1（始终在上下文里）**：frontmatter 里的 `name` + `description`，大约 100 词。AI 靠这一层决定要不要触发这个 Skill。

**Level 2（触发时加载）**：SKILL.md 的正文，建议控制在 500 行以内。这是完整的工作指令。

**Level 3（按需加载）**：`references/`、`scripts/`、`assets/` 目录下的文件。用到才读，不用不碰。

```
my-skill/
├── SKILL.md          ← Level 1（frontmatter）+ Level 2（正文）
├── scripts/
│   └── aggregate.py  ← Level 3，执行时才加载
└── references/
    ├── aws.md        ← Level 3，处理 AWS 场景时才读
    └── gcp.md        ← Level 3，处理 GCP 场景时才读
```

这个分层的实际影响比你想的大。我见过有人写了 2000 行的 SKILL.md，把所有平台的配置说明、所有边界情况的处理方案全塞在正文里。结果比一个 300 行的精简版效果更差——不是因为内容有问题，是因为信息密度太高时，模型对关键指令的执行准确率会下降。

skill-creator 自身就是个好样本：它的 SKILL.md 控制在 500 行以内，但通过 `agents/` 目录下的 `grader.md`、`comparator.md`、`analyzer.md` 和 `scripts/` 目录下的评测脚本，支撑了一整套评测流水线。正文只说"什么时候读 agents/grader.md"，而不是把 grader 的全部逻辑内联进来。

## 原则三：精益指令

我有个习惯，写完 Skill 之后会去读 AI 的执行 transcript——不是只看最终输出，而是看它中间的推理过程和工具调用序列。

读 transcript 能发现两类问题：

**第一类：AI 每次都自然做到了的事。** 比如你写了"use proper indentation"，但 AI 生成代码时从来就没乱过缩进。这条指令占着 token，没产生任何价值。删掉。

**第二类：AI 每次都忽略了的事。** 这时候本能反应是加粗、加大写、加感叹号。但正确做法是回到原则一——改写方式，解释原因，或者直接给一个输入输出的示例。

代码里有个概念叫死代码（dead code），就是永远不会被执行到的分支。Skill 里也有"死指令"——AI 要么天然就会做、要么怎么强调都不做的指令。两种情况的处理一样：删掉。

skill-creator 的文档里有句话说得精准：

> Remove things that aren't pulling their weight. Read the transcripts, not just the final outputs — if the skill is making the model waste time doing unproductive things, try getting rid of those parts.

fewer, better instructions often outperform exhaustive rules。这不是抽象道理，是从反复跑评测中得出的经验数据。

## 原则四：泛化 > 过拟合

写过机器学习模型的人都知道过拟合的陷阱。Skill 开发有一模一样的问题。

典型场景：你写了 3 个测试用例，然后反复调 Skill 直到这 3 个用例完美通过。某个用例是关于 React useEffect 的，于是你加了一条：

```markdown
❌ 如果文件是 .tsx 且包含 useEffect，检查依赖数组是否完整
```

这条指令对你那个测试用例确实管用。但你的 Skill 上线后会被调用无数次，面对的不只是 useEffect。useMemo、useCallback、自定义 Hooks 里的依赖声明都有同样的问题。正确的写法是：

```markdown
✅ 检查所有 React Hooks 的依赖声明是否完整。遗漏依赖会导致闭包陈旧（stale closure），
   组件拿到的是过期的 state 或 props 值，这类 bug 在 code review 里非常容易漏掉，
   因为代码表面上看不出任何问题。
```

skill-creator 对这一点的表述很直接：

> We're trying to create skills that can be used a million times across many different prompts. Rather than put in fiddly overfitty changes, if there's some stubborn issue, try branching out and using different metaphors or recommending different patterns.

当某个测试用例失败时，不要急着加一条针对性修补。先问自己：这个失败暴露的根因是什么？能不能用一条更通用的指令覆盖这个问题以及它的同类问题？

## 原则五：无惊喜原则

这条说起来简单：Skill 的实际行为不应该让用户感到意外。

具体到工程层面有三个要求：

**描述和行为一致。** 如果 description 说"审查代码质量"，Skill 就不应该偷偷去修改文件。如果 Skill 会调用外部 API（比如发消息到 Slack），必须在 description 里明确说明。

**不包含恶意代码。** 这看起来是废话，但 Skill 生态一旦开放，就会有人尝试在 SKILL.md 里塞入 prompt injection。skill-creator 专门提到这一点："skills must not contain malware, exploit code, or any content that could compromise system security."

**有副作用的操作要设防。** Skill 配置里有个 `disable-model-invocation: true` 选项，用于防止 AI 在用户不知情的情况下自动触发某些 Skill。如果你的 Skill 会发邮件、写数据库、调用付费 API，考虑启用这个开关，让用户显式触发。

无惊喜原则的本质是信任。用户把工作流交给 Skill，是因为他信任 Skill 会做且只做他预期的事。打破一次信任，用户就不会再用了。

## 原则六：Description 要"适度激进"

大部分 Skill 的 description 写得太保守。比如：

```yaml
❌ description: A code review tool
```

这 5 个词传达的信息量太少，AI 在决定是否触发时很容易跳过它。用户说"帮我看看这个 PR 有没有问题"——AI 不觉得这和"a code review tool"有关。

更好的写法：

```yaml
✅ description: >
    审查代码质量和安全性。当用户提到 review、审查、检查代码、
    看看这个 PR、帮我 check 一下、这段代码有没有问题时触发。
```

skill-creator 在这一点上用了一个很准确的词——"pushy"：

> Claude has a tendency to "undertrigger" skills. To combat this, make descriptions a little bit "pushy."

但"适度"两个字很关键。如果你写成"Use this for anything related to code"，那所有涉及代码的操作都会误触发你的 Skill，反而干扰正常工作流。

边界在哪？把你的 Skill 会处理的典型用户表述列出来，放进 description。但不要泛化到"所有跟代码有关的事"。description 不是广告语，是触发条件的声明。

## 六条原则之间的关系

这六条原则不是独立的清单，它们之间有一条暗线：**写 Skill 就像带一个新加入团队的同事。**

你不会给新人一本 500 页的内部手册让他入职第一天全部读完——这是渐进式披露。你不会用全大写邮件命令他"MUST ALWAYS follow coding standards"——这是 Theory of Mind，你知道解释理由比发号施令更有效。你会根据他实际犯的错来调整带教重点，而不是事无巨细全部提前讲一遍——这是精益指令。你不会因为他在某个特定项目上犯了错就立一条只适用于那个项目的规矩——这是泛化。你不会让他做任何你没告诉他的事——这是无惊喜。你会清楚地告诉别人他能帮什么忙，让需要帮助的人能找到他——这是 description 的适度激进。

skill-creator 是这些原则最好的注脚。它是一个"创建 Skill 的 Skill"，自己就是自己的产物。它的 SKILL.md 不用全大写，解释每条指令的工程理由，正文控制在 500 行以内但通过引用文件支撑完整流程，持续在迭代中删减不起作用的指令。它不是在教你六条抽象原则，它是在用自己的存在证明这些原则确实管用。

下一章我们进入动手环节——从零开始写一个能跑的 Skill。
