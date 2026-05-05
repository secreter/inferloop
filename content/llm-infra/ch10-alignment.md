# 第 10 章 RLHF 与对齐

上一章我们让模型学会了领域知识（微调），但这还不够。一个微调过的模型可能回答正确率很高，却经常给出冗长、格式混乱、甚至有害的回答。

这就是"对齐"（Alignment）要解决的问题：让模型不仅"回答正确"，而且"回答得好"——有用、无害、诚实。

## 10.1 SFT → RM → PPO

### RLHF 的三阶段

OpenAI 在 InstructGPT 论文中提出的 RLHF（Reinforcement Learning from Human Feedback）分三步走：

**阶段一：SFT（Supervised Fine-Tuning）**

用高质量的指令-回答对做监督微调。这一步上一章已经讲过了。目的是让模型学会遵循指令的基本能力。

数据样例：
```json
{"prompt": "写一首关于春天的诗", "response": "春风拂面暖阳照..."}
```

数据量：通常 10K-100K 条。

**阶段二：RM（Reward Model）训练**

收集人类偏好数据：对同一个 prompt，让 SFT 模型生成多个回答，然后让人类标注员排序。用这些排序数据训练一个奖励模型（Reward Model）。

数据样例：
```json
{
  "prompt": "解释量子力学",
  "chosen": "量子力学是物理学的一个分支，研究微观粒子...[详细、准确、易懂的回答]",
  "rejected": "量子力学就是说猫可以又死又活...[不准确、过于简化的回答]"
}
```

RM 本质上是一个分类/回归模型，输入 (prompt, response)，输出一个标量分数。数据量通常需要 100K+ 条偏好对。

**阶段三：PPO（Proximal Policy Optimization）**

用 RM 作为奖励信号，通过强化学习优化 SFT 模型。PPO 的循环是：

1. 模型生成回答
2. RM 给回答打分
3. 用 PPO 算法更新模型，让它生成更高分的回答
4. 同时用 KL 散度约束，防止模型偏离 SFT 模型太远

### PPO 的直觉解释

不需要深入数学，PPO 的核心思想可以这样理解：

想象你在训练一只狗。SFT 阶段是教它基本的"坐下"、"握手"指令。PPO 阶段则是：狗做了个动作 → 你给奖励或惩罚 → 狗调整行为。RM 就是那个自动判断"做得好不好"的打分器。

PPO 加了一个关键约束：每次更新不能太大（proximal = 近端）。这就像你不希望狗为了拿到零食而学会一些奇怪的技巧——你希望它在保持正常行为的基础上变得更好。

### 为什么 RLHF 有效

关键洞察：**SFT 教模型"说什么"，RLHF 教模型"怎么说"。**

一个 SFT 模型可能知道正确答案，但它不知道：
- 用户更喜欢分步骤的回答还是直接给结论
- 什么时候该说"我不确定"
- 怎么拒绝有害请求同时保持有用
- 回答的最佳长度是多少

这些"偏好"很难通过监督学习捕捉，但人类标注员可以很容易地判断"A 比 B 好"。RLHF 正是利用了这种比较信号。

### PPO 的实际挑战

但 PPO 训练非常难搞：

1. **训练不稳定**：需要同时维护四个模型——actor（策略模型）、critic（价值模型）、reference model（参考模型）、reward model。显存压力巨大
2. **超参数敏感**：KL coefficient、clip ratio、value function coefficient... 调参空间很大
3. **奖励 hacking**：模型可能学会"骗过" RM 的方式拿高分，而不是真正变好
4. **成本高**：需要在线生成 + 打分 + 训练，整个 pipeline 复杂度很高

这些挑战催生了更简单的对齐方案。

## 10.2 DPO：更简单的对齐方案

### DPO 的核心思想

2023 年，Stanford 的 Rafailov 等人提出了 DPO（Direct Preference Optimization），核心洞察是：

> 你不需要先训练一个 Reward Model，再用 RL 优化。可以直接从偏好数据优化策略模型。

数学上，DPO 证明了：给定最优的 Reward Model，PPO 的最优策略有一个闭式解。这意味着可以把 RL 问题转化为一个简单的分类问题。

DPO 的损失函数：

$$\mathcal{L}_{DPO} = -\log\sigma\left(\beta \left[\log\frac{\pi_\theta(y^+|x)}{\pi_{ref}(y^+|x)} - \log\frac{\pi_\theta(y^-|x)}{\pi_{ref}(y^-|x)}\right]\right)$$

翻译成人话：让模型在 chosen 回答上的概率（相对于参考模型）比在 rejected 回答上的概率更高。就这么简单。

### 实际使用

用 TRL 库做 DPO 训练，代码简洁到令人发指：

```python
from trl import DPOTrainer, DPOConfig
from datasets import load_dataset

dataset = load_dataset("trl-lib/ultrafeedback_binarized", split="train")

trainer = DPOTrainer(
    model="Qwen/Qwen2-7B",
    args=DPOConfig(
        output_dir="./output",
        num_train_epochs=1,
        per_device_train_batch_size=4,
        learning_rate=1e-6,
        beta=0.1,
        bf16=True,
        gradient_checkpointing=True,
    ),
    train_dataset=dataset,
)
trainer.train()
```

数据格式也很简单，就是 `prompt`、`chosen`、`rejected` 三个字段。

### DPO vs PPO

| 维度 | PPO | DPO |
|-----|-----|-----|
| 需要 Reward Model | 是 | 否 |
| 需要在线生成 | 是 | 否 |
| 训练稳定性 | 差，需要大量调参 | 好，几乎开箱即用 |
| 显存需求 | 4 个模型 | 2 个模型（policy + reference） |
| 训练速度 | 慢（生成+打分+训练） | 快（直接训练） |
| 效果上限 | 理论上更高 | 实践中几乎持平 |
| 适用场景 | 大厂、充足资源 | 大多数团队 |

DPO 最大的优势是简单。不需要训练单独的 RM，不需要在线采样，不需要复杂的 RL 训练循环。对于 90% 的对齐需求，DPO 就够了。

### 更新的对齐方法

DPO 之后，社区又提出了很多变体：

**ORPO（Odds Ratio Preference Optimization）**：把 SFT 和对齐合并成一步，不需要 reference model。更简单，但效果在某些任务上略差。

**SimPO（Simple Preference Optimization）**：用序列平均对数概率作为隐式奖励，不需要 reference model，训练更高效。

**KTO（Kahneman-Tversky Optimization）**：不需要成对偏好数据，只需要"好"和"坏"的标签。在数据收集上更灵活。

**IPO（Identity Preference Optimization）**：解决 DPO 可能过拟合偏好数据的问题，加入正则化。

这些方法各有优劣，但 DPO 依然是最成熟、使用最广泛的选择。

## 10.3 对齐税

对齐不是免费的午餐。

### 能力下降

经过 RLHF/DPO 对齐的模型，在某些"原始能力"上会出现下降：

- **数学推理**：对齐后的模型更倾向于给出"安全"的回答，可能不愿意做复杂推理
- **代码生成**：过度对齐会让模型在生成代码时过于保守
- **创造性写作**：对齐后可能变得"太正经"

这被称为"对齐税"（Alignment Tax）。Meta 在 Llama 2 的论文中报告，RLHF 后模型在某些 benchmark 上的分数确实下降了 1-3 个百分点。

### 安全与能力的 Tradeoff

这是一个真实的工程决策：

- 对齐太少：模型可能生成有害内容、暴露偏见
- 对齐太多：模型变得"太安全"，拒绝回答正常问题

经典案例：早期的 ChatGPT 会拒绝回答"怎么做炸鸡"（因为"炸"字触发了安全机制）。这就是过度对齐的典型表现。

### 过度对齐的问题

过度对齐（Over-alignment）的表现：

1. **过度拒绝**：对正常问题也回复"我不能帮助你做这件事"
2. **过度免责**：每个回答都加上"请注意，这不构成专业建议..."
3. **过度谨慎**：不愿意给出明确观点，总是说"这取决于..."
4. **套话太多**：开头永远是"好的！这是一个很好的问题"

在实际业务中，对齐的程度需要根据场景调整。一个内部代码助手不需要和面向消费者的聊天机器人一样的安全等级。

## 10.4 Agent 场景的对齐

前面讨论的对齐主要针对"对话"场景——模型生成一段文本，好不好由人来判断。但 Agent 场景完全不同：模型不只是说话，还要**做事**——调用 API、写文件、发邮件、操作数据库。做错了的代价比说错了大得多。

### Agent 对齐的独特挑战

和对话对齐相比，Agent 对齐面临几个额外的难题：

**Tool Calling 准确率**

Agent 需要正确选择工具，还要正确构造参数。这不是"大致正确"就行的——你调 `delete_user(user_id=123)` 的时候，user_id 传错了就是生产事故。

Tool calling 的出错模式比文本生成丰富得多：选错工具、参数类型错误、缺少必填参数、参数值超出范围、不该调用时调用了（比如用户只是在问"如果我删掉这个会怎样"，模型真去删了）。

**格式遵从**

Agent 的输出必须严格符合结构化格式（通常是 JSON），否则下游系统解析不了。这和第 8 章讲的约束解码是同一个问题的不同层面：约束解码从推理引擎层面保证格式，对齐训练则从模型权重层面提升格式遵从率。两者互补——对齐训练让模型"想"输出正确格式，约束解码在它"想"错的时候兜底。

**拒绝该拒绝的**

一个对话模型拒绝回答有害问题，最坏的结果是用户不满意。但一个 Agent 如果不该执行时执行了——比如用户开玩笑说"把生产数据库清了"，模型真去跑 `DROP TABLE`——后果就是灾难性的。Agent 的对齐需要更强的"知道什么时候该说不"的能力。

**多步推理的一致性**

Agent 的一次任务可能包含 10+ 步操作。模型需要在整条执行路径上保持一致：不能第 3 步决定用方案 A，第 7 步又切换到方案 B；不能前面说"我来帮你创建文件"，后面又问"你要创建什么文件"。这种长程一致性是单轮对齐训练很难覆盖的。

### Tool Calling 的对齐数据构造

Agent 对齐的核心难度在数据。你需要大量高质量的 tool calling 样本，而且正例和负例都要有。

**正例**：给定用户意图和可用工具列表，模型正确选择工具并构造参数。

```json
{
  "prompt": "帮我查一下北京明天的天气",
  "tools": ["get_weather", "send_email", "search_docs"],
  "chosen": {
    "tool": "get_weather",
    "arguments": {"city": "北京", "date": "2025-03-16"}
  }
}
```

**负例**的类型更多样：

```json
{
  "rejected_examples": [
    {"error": "wrong_tool", "tool": "search_docs", "arguments": {"query": "北京天气"}},
    {"error": "wrong_params", "tool": "get_weather", "arguments": {"city": "北京"}},
    {"error": "unnecessary_call", "context": "用户只是在闲聊提到天气，不需要调用工具"}
  ]
}
```

数据从哪来？三个来源：

1. **人工标注**：最准确但最贵。适合构造高价值的边缘 case（比如"该拒绝"的场景）
2. **API 日志挖掘**：从线上 Agent 的执行日志中，把成功的 trajectory 作为正例，失败的作为负例。这是最大的数据来源
3. **强模型生成弱模型的训练数据**：用 GPT-4 / Claude 对你的 tool schema 生成大量 tool calling 样本，用来训练自己的 7B/14B 模型。成本可控，质量不错

### Trajectory-level DPO

传统 DPO 是在单轮级别做偏好对比：同一个 prompt，chosen response vs rejected response。但 Agent 的"好坏"往往不是一步决定的，而是整条执行路径（trajectory）的质量。

Trajectory-level DPO 的数据格式：

```json
{
  "task": "帮用户把 CSV 数据导入数据库",
  "chosen_trajectory": [
    {"step": 1, "action": "read_file('data.csv')", "result": "成功读取 1000 行"},
    {"step": 2, "action": "validate_schema(data, table_schema)", "result": "schema 匹配"},
    {"step": 3, "action": "batch_insert(data, 'target_table')", "result": "导入成功"}
  ],
  "rejected_trajectory": [
    {"step": 1, "action": "read_file('data.csv')", "result": "成功读取 1000 行"},
    {"step": 2, "action": "insert_row(data[0], 'target_table')", "result": "逐行插入，太慢"},
    {"step": 3, "action": "insert_row(data[1], 'target_table')", "result": "继续逐行..."}
  ]
}
```

chosen trajectory 做了 schema 验证然后批量导入，rejected trajectory 跳过了验证且用了低效的逐行插入。这种"路径级别"的偏好信号，比单步的 tool calling 偏好更能教会模型做出全局更优的决策。

实现上，需要把整条 trajectory 拼成一个长序列，然后对整个序列做 DPO loss。这对序列长度有要求——10 步的 trajectory 可能有 4000-8000 tokens，训练时要注意 context length 和显存。

### 实际建议

Agent 对齐不是一步到位的事，推荐分阶段来：

**阶段一：Prompt Engineering + Few-shot**

先别急着训练。用好的 system prompt 加几个 few-shot 示例，就能把 tool calling 准确率拉到 85-90%。这个阶段的重点是定义清楚 tool schema——参数的 description 写得越精确，模型犯错越少。

**阶段二：SFT 微调**

在你自己的 tool schema 上做 SFT。收集 1000-5000 条高质量的 tool calling 样本，用 LoRA 微调。目标是让模型熟悉你的工具集，把准确率从 90% 拉到 95%+。

**阶段三：DPO 优化边缘 Case**

SFT 之后，模型在常见场景下已经很好了，但边缘 case 还会出错——比如工具之间有功能重叠时选哪个、参数有歧义时怎么处理。收集这些 hard case 的偏好对，用 DPO 做精细优化。

**评估指标**

Agent 对齐的评估比对话对齐更直接，因为有明确的"对错"标准：

| 指标 | 含义 | 目标 |
|-----|------|------|
| Tool Selection Accuracy | 选对工具的比例 | > 95% |
| Parameter Exact Match | 参数完全正确的比例 | > 90% |
| Unnecessary Call Rate | 不该调用时调用的比例 | < 5% |
| Task Completion Rate | 端到端任务完成率 | > 80% |

其中 Task Completion Rate 是最终指标，但前三个指标能帮你定位问题出在哪个环节。

## 10.5 评估

训练完了怎么知道模型变好了？这是 LLM 领域最难的问题之一。

### 自动评估的局限

传统 NLP 指标在 LLM 时代基本不够用：

**Perplexity**：衡量模型对文本的"困惑度"。问题是：perplexity 低不代表回答好。一个总是输出"我不知道"的模型 perplexity 可能很低。

**BLEU/ROUGE**：衡量生成文本和参考文本的重合度。问题是：好的回答有很多种说法，和参考文本不一样不代表不好。

这些指标可以作为参考，但不能作为唯一标准。

### LLM-as-Judge

目前最流行的自动评估方式是用一个强力 LLM（通常是 GPT-4）来评判：

```python
judge_prompt = """
请评估以下 AI 助手的回答质量，从 1-5 分打分。

评分标准：
- 5 分：准确、完整、格式好、有帮助
- 4 分：基本正确，有小瑕疵
- 3 分：部分正确，有明显遗漏
- 2 分：大部分不正确或不相关
- 1 分：完全错误或有害

用户问题：{question}
AI 回答：{answer}

请给出评分和理由。
"""
```

LLM-as-Judge 的优势：

- 成本低（相比人工评估）
- 速度快
- 可以大规模运行
- 和人类判断的相关性不错（约 80% 一致率）

局限性：

- 对自家模型有偏好（GPT-4 倾向于给 GPT 系列更高分）
- 对格式和长度有偏好（更长的回答通常得分更高）
- 在专业领域可能不可靠

### 人工评估

最可靠但最贵的方式。几个实用建议：

1. **A/B 测试**：给标注员看两个模型的回答（隐藏模型名），让他们选更好的
2. **评分维度**：分多个维度打分（准确性、有用性、安全性、格式），而不是只给总分
3. **标注员一致性**：用 Cohen's Kappa 或 Fleiss' Kappa 衡量标注员之间的一致性，低于 0.4 说明任务定义有问题
4. **样本量**：至少 200-500 条评估数据，覆盖不同难度和类型

### 开源评估工具

**lm-evaluation-harness**（EleutherAI）是最广泛使用的开源评估框架：

```bash
lm_eval --model hf \
    --model_args pretrained=./my-model \
    --tasks mmlu,hellaswag,arc_challenge \
    --batch_size 8 \
    --output_path ./eval_results
```

它支持几百个评估任务，包括：

- **MMLU**：57 个学科的多选题，衡量知识面
- **HellaSwag**：常识推理
- **ARC**：科学问答
- **TruthfulQA**：真实性评估
- **HumanEval**：代码生成
- **GSM8K**：数学推理

实际项目中，建议组合使用：

1. 先用 lm-eval 跑几个通用 benchmark，确认模型没有退化
2. 用 LLM-as-Judge 在你的业务场景上评估
3. 最终用人工评估做 sanity check

完整代码见 `examples/ch10-alignment/` 目录。

---

## 小结

| 方法 | 复杂度 | 数据需求 | 效果 | 推荐度 |
|-----|-------|---------|------|-------|
| SFT | 低 | 指令-回答对 | 基础 | 必做 |
| DPO | 中 | 偏好对 | 好 | 强烈推荐 |
| PPO | 高 | 偏好对 + RM | 最好（理论上） | 有资源再做 |
| ORPO | 低 | 偏好对 | 不错 | 可以试试 |

对于绝大多数团队，SFT + DPO 就是最佳实践。先用 SFT 教会模型领域知识，再用 DPO 优化回答质量。

下一章我们讲分布式训练——当一张卡不够用时怎么办。
