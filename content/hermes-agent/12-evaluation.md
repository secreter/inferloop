# 第 12 章 评估:你的 Agent 真的在变好吗

前面三章构建了"跑得起来"(部署)、"看得到"(观测)、"防得住"(安全)的基础。这一章解决一个更难的问题:**你怎么证明 Agent 在变好**?

这个问题难在于 Agent 的"好"没有单一的客观指标。传统服务可以看 QPS、延迟、错误率;ML 模型可以看 accuracy、F1、AUC。Agent 的输出是自然语言,结果是开放的,"好"的标准随任务变化。很多团队在这里妥协为"感觉它越来越好"—— 这不是评估,这是自我安慰。

这一章讲一套可落地的 Agent 评估方法论。不是学术论文里的评估框架(那些太抽象),而是你在周末下午就能搭起来、下周一就能跑的那种评估。

## 12.1 为什么 Agent 评估不同于模型评估

先把"Agent 评估"和"模型评估"区分开。

**模型评估**关心的是:给定一个固定输入,模型的输出好不好。它的对象是 LLM 本身,用 MMLU、GSM8K、HumanEval 之类的 benchmark 跑分。

**Agent 评估**关心的是:给定一个用户目标,整个 Agent 系统(LLM + 工具 + 记忆 + skill + 调度)能不能完成它。它的对象是**系统**,不是模型。

这个区别带来几个实际后果:

**后果一:不能只看单次输入输出**。一个 Agent 任务可能经过 20 步 LLM 调用、10 次工具调用、3 次 memory 读取。只看"最终输出"会漏掉过程里的大量信号。好的 Agent 评估要同时看最终结果和执行路径。

**后果二:可复现性难**。严格来说,LLM 本身是可以被"逼成确定性"的 —— 设 `temperature=0` 再传一个固定的 `seed`(OpenAI、Anthropic、Gemini 都支持),同一份 prompt 在大多数情况下能得到同一个输出。但即便这样,Agent 系统整体仍然不可完全复现,因为:

- **工具调用依赖外部状态**:`gh issue list` 今天和明天返回不一样,`date` 工具每次不同,文件系统状态变
- **记忆每次都在变**:同一个任务第二次跑时,前一次的 trajectory 和新写入的 memory 已经改变了 context
- **provider 端的非确定性**:即使 `temperature=0 + seed`,不同节点的 cache 命中、批次调度也会带来细微差异

结论是:**LLM 是可以做到近似确定的,但 Agent 系统不是**。评估框架必须设计成"对这些变化容忍"的 —— 用硬断言覆盖"必须不变"的部分(文件创建、命令执行),用软断言覆盖"质量范围"的部分(输出的语气、结构),不要追求 bit-level 一致。

**后果三:成本高**。跑一次完整的 Agent 评估可能比跑一次模型 benchmark 贵一个数量级 —— 一次评估跑 100 个 task,每个 task 平均 20 次 LLM 调用,就是 2000 次调用。这意味着**评估不能每次 commit 都跑**,只能定期跑。

**后果四:维度多**。Agent 的"好"至少包含:任务成功率、结果质量、执行效率(步骤数、耗时、token)、成本、安全(有没有副作用)、用户体验(回复流畅度)。这些维度不能被压成一个数。

## 12.2 四个核心指标

尽管维度多,但有四个指标是任何 Agent 评估都应该关注的:

**指标一:任务成功率(Task Success Rate)**

定义:在测试集里能"完成用户目标"的任务占比。

"完成"的判断可以是:

- **程序化判断**:比如"帮我创建一个 GitHub issue" → 检查 API 是否成功创建了 issue
- **LLM 判断**:LLM-as-a-Judge,让另一个模型看最终输出和原始目标,判断是否达成
- **人工判断**:团队里的人工打分(样本量小但最可靠)

组合使用最好:能程序化判断的就程序化,做不到的就 LLM 判断,对关键任务再加一次人工复核。

**指标二:记忆命中率(Memory Hit Rate)**

定义:在测试集里,需要用到历史上下文的任务中,Agent 正确检索到相关记忆的比例。

这个指标要专门设计测试用例。例子:

- 第 1 个任务:告诉 Agent "我喜欢喝黑咖啡,不要加糖"
- 第 20 个任务(中间插入其他任务):说"我想去趟咖啡厅",看 Agent 是否记得偏好
- 第 50 个任务(更远):说"帮我点一杯咖啡",再看

记忆命中率反映的是"记忆系统的持久力"。如果这个指标随时间衰减,说明 memory 的淘汰策略过于激进,或反思 prompt 没有正确提炼偏好。

**指标三:技能质量指标(Skill Quality Metric)**

定义:针对每个 skill,计算它的首次成功率、平均执行步数、平均消耗 token、近 30 天的失败次数。

这个指标是**长期的**,不是一次评估的数字。它需要持续收集数据,画成趋势图。你要找的是:

- 有哪些 skill 的成功率在下降(drift 信号)
- 有哪些 skill 的步骤数在增加(复杂度膨胀)
- 有哪些 skill 从来没被调用过(可能是没人需要,或者 matching 出了问题)

**指标四:回归通过率(Regression Pass Rate)**

定义:用一组"已经验证过的好任务"作为回归测试集,每次升级(改 prompt、改 skill、升级 Hermes 版本)跑一遍,计算通过率。

回归测试集是最重要的投资。它的作用是:**防止"修好一个问题的同时弄坏三个本来好的"**。如果没有回归测试集,你的 Agent 会在不断的修改中进入"东墙补西墙"的状态,永远无法稳定。

## 12.3 构建你的回归测试集

回归测试集是评估系统的核心资产。这一节给一个可落地的构建流程。

**步骤 1:种子任务**

从你的使用历史里挑 20–30 个"你当时觉得做得好"的任务。这些任务的 prompt 复制到一个文件里:

```yaml
# eval/regression-seeds.yaml
tasks:
  - id: 001
    prompt: "帮我整理本周的 GitHub PR,按仓库分类"
    expected_result_contains: ["仓库", "PR", "标题"]
    expected_min_length: 100
    max_steps: 20
    max_cost_usd: 0.15

  - id: 002
    prompt: "读一下 docs/design.md,提炼三个核心观点"
    expected_result_contains: []
    expected_min_length: 50
    needs_llm_judge: true
    judge_criteria: "回答应该列出 3 个观点,每个观点简洁明确,不超过两句话"

  # ... 更多任务
```

**步骤 2:断言(Assertions)**

每个 task 配一组断言。断言分两类:

- **硬断言**:程序可直接判断。例如"回复包含某个字符串"、"步骤数不超过 N"、"成本不超过 $0.X"、"某个文件被创建"
- **软断言**:需要 LLM-as-a-Judge。例如"回复的结构合理"、"没有事实错误"、"对用户问题有实质回答"

硬断言要尽量多。它们不耗 LLM 成本,可以每次跑。软断言留给"必须评估质量"的关键任务。

**步骤 3:运行框架**

一个简单的运行框架可以用 Bun + TypeScript 写(约 200 行),本书配套仓库的 `integrations/eval-runner/` 有一份参考实现。核心流程:

```typescript
async function runRegression(seedsFile: string) {
  const tasks = loadSeeds(seedsFile);
  const results: TaskResult[] = [];

  for (const task of tasks) {
    const result = await runSingleTask(task);
    results.push(result);
  }

  const report = buildReport(results);
  saveReport(report, `eval/reports/${new Date().toISOString()}.json`);
  printSummary(report);
}

async function runSingleTask(task: Task): Promise<TaskResult> {
  // 1. 在干净的 sandbox 里启动一个 Hermes 实例(用独立的 workdir)
  const hermes = await startHermes({ workdir: makeTempDir() });

  // 2. 把任务的 prompt 发给 Hermes
  const startTime = Date.now();
  const output = await hermes.sendAndWait(task.prompt);
  const duration = Date.now() - startTime;

  // 3. 运行硬断言
  const hardAssertions = checkHardAssertions(task, output);

  // 4. 运行软断言(LLM-as-a-Judge)
  let softAssertions = null;
  if (task.needs_llm_judge) {
    softAssertions = await llmJudge(task, output);
  }

  // 5. 收集指标(成本、步数、等)
  const metrics = await hermes.getMetrics();

  // 6. 清理
  await hermes.stop();

  return { task, output, hardAssertions, softAssertions, metrics, duration };
}
```

**步骤 4:跑一次 baseline**

在 Hermes 当前状态下跑一次完整的回归,记录所有指标。这是你的 **baseline**。之后所有变更都要和这个 baseline 比较。

**步骤 5:定期运行**

回归评估不需要每次 commit 都跑,但应该至少在这三个时间点跑:

- 升级 Hermes 主版本前后
- 修改核心 prompt 或配置后
- 每周一次作为"健康检查"

每次跑完对比:

- 成功率有没有变化?
- 新增了哪些失败?
- 原本成功的任务有没有变慢或变贵?

任何"变差"的信号都要调查。

## 12.4 记忆命中率测试的设计

记忆命中率比其他指标更难测,因为它需要**跨任务的时间结构**。单次评估跑完就结束的逻辑不适用。

一种可行做法:**"记忆情景剧本"(Memory Scenario)**。

一个 scenario 是一串有序的对话,中间散布"需要回忆"的检查点。例子:

```yaml
scenario: coffee-preference
steps:
  - type: statement
    prompt: "我喜欢喝黑咖啡,不加糖,最好是浅烘焙的豆子"
    assertion: none

  - type: unrelated_noise
    prompts:
      - "帮我查一下明天北京的天气"
      - "写一段 Python 代码反转字符串"
      - "今天有什么新闻"

  - type: recall_check
    prompt: "推荐一家咖啡厅给我"
    assertion: "回答中应该提到或体现出黑咖啡、浅烘焙的偏好"
    judge: llm

  - type: long_delay
    skip_sessions: 10  # 跳过 10 个独立会话,模拟一段时间过去

  - type: recall_check
    prompt: "我想点一杯咖啡,你帮我想想"
    assertion: "回答应该记得用户的咖啡偏好"
    judge: llm
```

跑这个 scenario 的时候,evaluator 会在两个 recall_check 处分别检查 Agent 是否"记得"最初的偏好。第二个 check 在 10 个会话之后,测试的是**长期记忆**而不是短期。

一组有代表性的 scenario 可以覆盖各种记忆情境:偏好、事实、项目进度、人际关系、历史决策。维护 10–20 个这样的 scenario,定期跑,就能追踪记忆系统随时间的稳定性。

## 12.5 用 LLM 做 Judge:注意事项

LLM-as-a-Judge 是现在最流行的软评估方法,但它有几个坑:

**坑一:Judge 模型和被评模型是同一个**。自己评自己会有系统性偏差。最佳做法是用不同家的模型(被评用 Claude,judge 用 GPT,或反之)。

**坑二:Judge 的 Prompt 不稳定**。每次 judge 的打分标准有微妙差异。对策:**judge prompt 要版本化**,不同版本的 judge 得到的分数不能直接比较。

**坑三:Judge 倾向于"给高分"**。LLM 有"讨好"的倾向,多数回复都会被判成"尚可"。对策:**要求 judge 输出结构化的判断**(例如必须在"好 / 一般 / 差"里选一个,不能含糊),而不是给 0–100 的连续分。

**坑四:Judge 被输出的"自信度"误导**。LLM 写得很自信但内容是错的,judge 可能被语气骗过去。对策:**judge prompt 里明确要求"检查事实准确性,不要只看语气"**。

**坑五:成本被低估**。judge 要跑完整的回归测试集,每个任务一次 judge,成本不低。对策:**只对需要软判断的任务跑 judge,硬断言能覆盖的就不用 judge**。

一个 judge prompt 的示范:

```
你是一个 Agent 输出质量评估员。我会给你:
- 用户的原始请求
- 评估标准
- Agent 的实际输出

你的任务是判断输出是否满足评估标准。请按以下格式输出:

verdict: pass | fail | partial
confidence: high | medium | low
reasoning: <一句话说明为什么>
issues: [<如果有问题,列出具体问题>]

不要含糊其辞,不要给中性评价。如果你不确定,选 partial 并在 reasoning 里说明不确定的原因。

---

用户请求: {{prompt}}

评估标准: {{criteria}}

Agent 输出:
{{output}}
```

这个 prompt 可以作为起点,根据你的评估需求调整。

## 12.6 A/B 测试:对比两个版本

回归测试告诉你"新版本有没有比老版本差"。A/B 测试告诉你"新版本是不是比老版本好"。

A/B 测试的基本流程:

1. **冻结一组测试任务**(从真实使用中抽样)
2. **分别用 A 配置和 B 配置跑这些任务**
3. **对每个任务,比较 A 和 B 的输出**
4. **让 judge(或人工)选"更好的那个"**
5. **统计 B 比 A 好的比例**

比如你在调 memory 的反思 prompt,改了一个版本。跑 50 个任务,judge 判断 B 比 A 好的比例是 32/50 = 64%,你就能说"新版本大概率更好"。比例只有 26/50 时,说明新版本没显著改进,可能要回滚。

A/B 的价值在于**对比视角**。回归测试只告诉你"没变差",A/B 告诉你"有没有变好"。两者结合,才能有方向地迭代。

**A/B 的成本**:每次跑两倍的任务。对回归测试集用 A/B 就是两倍成本。所以 A/B 不建议在整个回归集上跑,挑一个小的 "A/B 子集"(10–20 个任务)就行。

## 12.7 对抗测试与红队评估

除了"正常任务",还要做"异常任务"。

**对抗测试**关心的是:在有人故意给 Agent 出难题或使坏时,它的表现如何。准备一组"对抗任务":

- **Prompt Injection 测试**:你在 prompt 里藏一条恶意指令,看 Agent 会不会被骗
- **歧义测试**:用户的请求有多种合理解读,看 Agent 会不会乱猜
- **矛盾测试**:用户的要求和 memory 里的偏好矛盾,看 Agent 怎么处理
- **边界测试**:要求超出 Agent 能力范围的事,看它会不会老实承认"我做不了"

每一类准备 3–5 个样例,作为对抗测试集。对抗测试通过率应该 > 80%。低于这个值说明 Agent 的"反脆弱"能力不足。

**红队评估**更重 —— 让一个同事(或者另一个 LLM 扮演红队)尝试"攻击"你的 Agent,看多久能让它出错、能让它出多大的错。这在做安全关键的 Agent 时是必备的。第 11 章已经给过红队清单,不再重复。

## 12.8 给 mini-hermes 准备一份评估集(预告)

第 15、16 章会从零实现一个 mini-hermes。那时候你会需要一份评估集来验证你的实现是否正确。这里先剧透一下 mini-hermes 的评估集设计:

```yaml
# mini-hermes/eval/basic.yaml
tasks:
  - id: hello
    prompt: "你好,介绍一下你自己"
    hard_assertions:
      - min_length: 20
      - max_cost_usd: 0.02

  - id: tool-use-file
    prompt: "在当前目录创建一个 hello.txt 文件,写入 hello world"
    hard_assertions:
      - file_exists: ./hello.txt
      - file_contains: ["hello world"]
      - max_steps: 5

  - id: memory-add
    prompt: "我的名字叫李雷"
    hard_assertions:
      - memory_contains: "李雷"

  - id: memory-recall
    depends_on: memory-add
    prompt: "你还记得我叫什么吗?"
    hard_assertions:
      - output_contains: ["李雷"]

  - id: skill-creation
    prompt: "帮我生成今天的日期报告,格式是 yyyy-MM-dd。以后我说'今日日期'你就这样做"
    hard_assertions:
      - skill_created_matching: "date-report"
      - output_matches: "\\d{4}-\\d{2}-\\d{2}"

  - id: skill-reuse
    depends_on: skill-creation
    prompt: "给我今日日期"
    hard_assertions:
      - skill_used: "date-report"
      - output_matches: "\\d{4}-\\d{2}-\\d{2}"
```

这组任务覆盖了 mini-hermes 的核心能力:基础对话、工具调用、记忆读写、技能生成、技能复用。跑完这些任务通过率达到 80% 以上,你的 mini-hermes 就算合格了。

## 12.9 评估的节奏

评估不是一次性的动作。它应该有持续的节奏:

- **每次改 prompt / skill / 核心配置**:跑一次快速回归(10 个关键任务,耗时 5 分钟)
- **每周**:跑一次完整回归(50+ 任务,耗时 30 分钟)
- **每月**:跑一次完整回归 + A/B(对比过去一个月的变化)+ 红队检查
- **每季度**:重新审视评估集,加入新任务,删除不再有代表性的任务

节奏比"偶尔跑一次大评估"更重要。偶尔跑一次只能告诉你"此刻状态",持续跑能告诉你"趋势"。趋势才是评估的终极价值 —— **你不是为了知道现在 Agent 有多好,而是为了知道它在变好还是变坏**。

## 12.10 陷阱清单

**陷阱一:只看最终输出,不看执行过程**。一个任务可能"输出看起来对",但 Agent 为此走了 50 步弯路、花了 $2。忽略过程的评估是残缺的。

**陷阱二:LLM-as-a-Judge 当成真理**。Judge 是辅助,不是终审。关键任务还是要人工抽样复核。

**陷阱三:评估集里全是"容易"的任务**。你的回归集通过率 100% 不代表系统好,可能只代表集里太简单。要持续加入"上次失败过的真实任务"来维持难度。

**陷阱四:在生产环境跑评估**。会污染真实数据 —— 评估任务的 memory 和 skill 改动会影响真实用户。必须在独立的 workdir 里跑。

**陷阱五:不记录评估的版本**。"上周跑的时候通过率 78%" 是什么配置跑的?用了哪个 Hermes 版本?哪个 skill 集?没有版本记录,历史数据没法比较。

**陷阱六:把"评估"和"训练数据"混淆**。评估集的任务不应该出现在 Agent 的 memory 或 skill 里(否则是 data leakage)。每次跑评估用独立的干净 workdir。

**陷阱七:盲目追求高通过率**。为了让评估通过把 assertions 放宽,这是自欺欺人。放宽的断言应该有明确理由。

**陷阱八:忘记评估成本本身**。每次全回归跑掉 $5 的 LLM 成本,一个月 $150 光评估。必须把评估成本列入预算,并在通过率稳定时降低跑评估的频率。

到这里第四部分结束。你应该对"生产级 Agent 该做什么"有了一个完整的地图:看(观测)、防(安全)、证(评估)。接下来第五部分进入更轻松的内容 —— 先和其他 Agent 范式做一次深度对比,再通过三个端到端案例把前面所有知识串起来。
