# 第 9 章 微调：让通用模型变成领域专家

你手上有个 7B 的通用大模型，它什么都会一点，但在你的业务场景——比如法律合同审查、医疗问诊、代码 Review——上表现平平。怎么办？

答案是微调（Fine-tuning）。这一章我们从显存计算开始，搞清楚为什么 Full Fine-tuning 对大多数人不现实，然后深入 LoRA/QLoRA 这条主流路线，最后在单卡 A10 上跑通一个完整的微调流程。

## 9.1 Full Fine-tuning vs PEFT

### Full Fine-tuning 的显存账

先算一笔账。拿 Qwen2-7B（7.6B 参数）为例，Full Fine-tuning 时显存占用分这几块：

| 组成部分 | 计算方式 | 显存占用 |
|---------|---------|---------|
| 模型参数（bf16） | 7.6B × 2 bytes | 15.2 GB |
| 梯度（bf16） | 7.6B × 2 bytes | 15.2 GB |
| Adam 优化器状态 | 7.6B × 2 × 4 bytes（fp32 的 m 和 v） | 60.8 GB |
| 激活值（batch_size=1） | 取决于序列长度，约 | 2-8 GB |
| **总计** | | **~95 GB** |

一张 A100 80GB 都装不下。就算用 gradient checkpointing 省掉一部分激活值，你还是需要至少两张 A100。

这里的关键是 Adam 优化器。它为每个参数维护两个 fp32 的状态（一阶矩 m 和二阶矩 v），直接占了 60GB+。7B 模型如此，70B 模型就更不用想了。

### 为什么 Full FT 对大多数人不现实

不仅仅是硬件成本的问题：

1. **显存需求高**：7B Full FT 要 ~95GB，70B 要 ~950GB，需要多卡并行
2. **训练时间长**：7B 在单卡 A100 上（如果能装下）跑完一个 epoch 要好几个小时
3. **灾难性遗忘**：全量更新参数很容易把模型在通用任务上的能力搞坏
4. **存储成本**：每个微调任务都要保存一份完整的模型权重，7B 就是 15GB

对于有 8 卡 A100 集群的大厂来说，Full FT 当然可以做。但对于绝大多数团队，我们需要更实际的方案。

### PEFT：只训练极少量参数

PEFT（Parameter-Efficient Fine-Tuning）的核心思想很简单：冻结原始模型的绝大部分参数，只训练新增的少量参数。

主流的 PEFT 方法包括：

- **LoRA/QLoRA**：在冻结的权重矩阵旁边加低秩分解矩阵，最主流
- **Prefix Tuning**：在输入前加可训练的虚拟 token
- **Adapter**：在 Transformer 层之间插入小型网络
- **IA3**：用极少量参数缩放注意力和前馈层的激活值

其中 LoRA 是目前绝对的主流，后面我们重点讲它。

## 9.2 LoRA / QLoRA

### LoRA 原理：低秩分解

LoRA（Low-Rank Adaptation）的思路非常优雅。原始模型的某个权重矩阵 $W \in \mathbb{R}^{d \times k}$，在微调时我们不直接更新 $W$，而是在旁边加一个低秩分解：

$$W' = W + \Delta W = W + BA$$

其中 $B \in \mathbb{R}^{d \times r}$，$A \in \mathbb{R}^{r \times k}$，$r \ll \min(d, k)$。

举个具体例子。Qwen2-7B 的 `q_proj` 权重矩阵是 $4096 \times 4096$，有 16.8M 个参数。如果 LoRA rank 设为 16，那 $B$ 是 $4096 \times 16$，$A$ 是 $16 \times 4096$，加起来只有 131K 个参数——不到原始的 1%。

推理时，可以把 LoRA 矩阵合并回原始权重：$W' = W + BA$，不增加任何推理开销。

### 关键超参数

**rank（r）**：LoRA 矩阵的秩，最重要的超参数。

- `r=8`：最常用的起步值，适合简单任务
- `r=16`：更好的效果，大多数场景的甜蜜点
- `r=32-64`：复杂任务或追求最佳效果时使用
- `r=128+`：接近 Full FT 的效果，但训练成本也上去了

**alpha（lora_alpha）**：缩放系数，最终的 LoRA 贡献是 $\frac{\alpha}{r} \times BA$。

- 经验法则：`alpha = 2 × rank`
- 比如 `rank=16, alpha=32`

**target_modules**：对哪些层加 LoRA。

```python
# 最常见：只对 attention 的 q/v 投影加 LoRA
target_modules = ["q_proj", "v_proj"]

# 更好的效果：对所有线性层加 LoRA
target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                  "gate_proj", "up_proj", "down_proj"]
```

加的层越多，可训练参数越多，效果通常越好，但显存和训练时间也相应增加。实践中，对所有线性层加 LoRA（`target_modules="all-linear"`）往往是性价比最高的选择。

### QLoRA：量化 + LoRA

QLoRA 的核心创新是：把基础模型量化到 4-bit，然后在量化模型上做 LoRA。

具体来说：

1. 用 NF4（NormalFloat4）量化基础模型，显存从 15GB 降到 ~4GB
2. LoRA 的 adapter 矩阵保持 bf16 精度
3. 计算时，量化权重反量化到 bf16 做矩阵乘法
4. 梯度只更新 LoRA 参数（bf16）

显存对比（Qwen2-7B，rank=16，所有线性层）：

| 方法 | 模型参数 | 可训练参数 | 优化器状态 | 总显存 |
|-----|---------|----------|----------|-------|
| Full FT (bf16) | 15.2 GB | 15.2 GB | 60.8 GB | ~95 GB |
| LoRA (bf16) | 15.2 GB | ~160 MB | ~640 MB | ~18 GB |
| QLoRA (4-bit) | ~4 GB | ~160 MB | ~640 MB | ~7 GB |

QLoRA 让你在一张消费级 RTX 4090 (24GB) 甚至 RTX 3090 上就能微调 7B 模型。这意味着个人开发者也能在自己的机器上微调大模型了。

效果上，QLoRA 和 LoRA 的差距在大多数任务上很小（1-2% 以内），但显存节省非常显著。

## 9.3 数据准备

微调的效果，50% 取决于数据质量。

### 常见数据格式

**Alpaca 格式**（最常见）：

```json
{
  "instruction": "将以下英文翻译成中文",
  "input": "The weather is nice today.",
  "output": "今天天气很好。"
}
```

**ShareGPT 格式**（多轮对话）：

```json
{
  "conversations": [
    {"from": "human", "value": "帮我写一个 Python 快排"},
    {"from": "gpt", "value": "好的，以下是快速排序的实现...\n```python\ndef quicksort(arr):\n    ..."},
    {"from": "human", "value": "能加个注释吗？"},
    {"from": "gpt", "value": "当然，以下是带注释的版本...\n```python\ndef quicksort(arr):\n    # ..."}
  ]
}
```

**OpenAI 格式**（messages）：

```json
{
  "messages": [
    {"role": "system", "content": "你是一个法律助手"},
    {"role": "user", "content": "什么是竞业禁止条款？"},
    {"role": "assistant", "content": "竞业禁止条款是指..."}
  ]
}
```

### 数据质量 > 数据数量

这一点有大量实证支持：

- **LIMA 论文**（Meta，2023）：只用 1000 条精心挑选的数据，就能让 LLaMA-65B 达到接近 GPT-4 的对话质量
- **Alpaca 论文**（Stanford）：52K 条 GPT-3.5 生成的数据，效果就相当不错
- 实际经验：**500-2000 条高质量数据 > 50000 条低质量数据**

什么是"高质量"？

1. **准确性**：答案必须正确，这是底线
2. **完整性**：回答覆盖了问题的关键方面
3. **格式一致性**：所有样本遵循相同的回答风格和格式
4. **多样性**：覆盖目标场景的不同类型问题
5. **难度分布**：简单、中等、困难的问题都要有

### 数据清洗技巧

实际项目中，你拿到的原始数据往往很脏。几个实用的清洗步骤：

```python
# 1. 去重：用 MinHash 或 exact match 去重
# 重复数据会让模型过拟合到特定模式

# 2. 长度过滤：太短的回答通常质量差
data = [d for d in data if len(d["output"]) > 50]

# 3. 格式检查：确保数据格式正确
# 比如需要 JSON 输出的任务，检查输出是否是合法 JSON

# 4. 用 LLM 打分：用 GPT-4 对数据质量打分
# 保留评分 > 4/5 的样本

# 5. 人工抽查：随机抽 100 条看看质量
```

### 构造指令微调数据的方法

最常用的几种方式：

1. **人工标注**：质量最高，成本也最高。适合核心场景的种子数据
2. **GPT-4 生成**：给 GPT-4 一些示例，让它生成更多。质量不错，注意合规
3. **从已有数据转换**：把文档、FAQ、客服记录转成指令-回答对
4. **Self-Instruct**：让模型自己生成指令，然后人工筛选

实际项目推荐组合策略：先人工标注 200-500 条高质量种子数据，然后用 GPT-4 扩展到 2000-5000 条，最后人工审核一轮。

## 9.4 训练框架

### HuggingFace Transformers + PEFT

最基础的方式，适合想深入理解细节的同学。核心代码就这几步：

```python
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer
from peft import LoraConfig, get_peft_model, TaskType

# 1. 加载模型
model = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2-7B", torch_dtype=torch.bfloat16)
tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2-7B")

# 2. 配置 LoRA
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules="all-linear",
    lora_dropout=0.05,
    task_type=TaskType.CAUSAL_LM,
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# trainable params: 83,886,080 || all params: 7,699,898,368 || trainable%: 1.09

# 3. 训练
training_args = TrainingArguments(
    output_dir="./output",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.1,
    bf16=True,
    logging_steps=10,
    save_strategy="epoch",
    gradient_checkpointing=True,
)
trainer = Trainer(model=model, args=training_args, train_dataset=dataset)
trainer.train()
```

完整代码见 `examples/ch09-finetuning/01_lora_from_scratch.py`。

### LLaMA-Factory：一站式微调框架

如果你不想写那么多代码，LLaMA-Factory 是目前最好的选择。它把所有常见的微调场景封装成了 YAML 配置：

```yaml
### model
model_name_or_path: Qwen/Qwen2-7B
template: qwen

### method
stage: sft
do_train: true
finetuning_type: lora
lora_rank: 16
lora_alpha: 32
lora_target: all

### dataset
dataset: my_custom_data
cutoff_len: 2048

### output
output_dir: ./output/qwen2-7b-lora

### train
per_device_train_batch_size: 4
gradient_accumulation_steps: 4
learning_rate: 2e-4
num_train_epochs: 3
lr_scheduler_type: cosine
warmup_ratio: 0.1
bf16: true
flash_attn: fa2
gradient_checkpointing: true
```

然后一行命令开训：

```bash
llamafactory-cli train config.yaml
```

LLaMA-Factory 支持 100+ 模型、LoRA/QLoRA/Full FT、SFT/DPO/PPO/ORPO 等多种训练方式，还内置了 Web UI。对于大多数微调任务，推荐直接用它。

### Unsloth

**Unsloth** — 高效微调加速库，号称比 HuggingFace PEFT 快 2 倍、省 60% 显存。通过手写 Triton kernel 优化了 LoRA 的前向和反向传播。如果你在单卡上做 QLoRA 微调，Unsloth 是值得尝试的选择。安装：`pip install unsloth`。

### 关键训练参数

**learning_rate**：LoRA 通常用 `1e-4` 到 `5e-4`，QLoRA 用 `2e-4` 是常见起点。Full FT 要小很多，通常 `1e-5` 到 `5e-5`。

**num_train_epochs**：微调不需要太多 epoch。1-3 个 epoch 通常就够了。数据量小（<1000 条）时可以多跑几个 epoch（3-5），但要注意过拟合。

**per_device_train_batch_size × gradient_accumulation_steps**：有效 batch size = batch_size × accumulation_steps × gpu_count。通常 16-64 是合理范围。

**warmup_ratio**：建议 0.05-0.1，让学习率在开始时缓慢上升。

### Loss 曲线解读

训练过程中最重要的监控指标就是 loss 曲线：

- **正常曲线**：快速下降 → 缓慢下降 → 趋于平稳
- **过拟合信号**：train loss 持续下降，但 eval loss 开始上升
- **学习率太大**：loss 剧烈波动，甚至发散（出现 NaN）
- **学习率太小**：loss 下降非常慢，几乎不动
- **数据质量问题**：loss 很快降到一个值就不再下降了

实际经验：如果 3B 条件下 loss 降到 0.8-1.2 左右是正常的。如果 loss 降到 0.3 以下，大概率过拟合了。

## 9.5 实战：用 QLoRA 微调 Qwen2-7B

这一节我们在单卡 A10 (24GB) 上完整跑通一个微调流程。

### Step 1：准备数据

我们准备一个简单的指令微调数据集（中文问答场景），格式如下：

```json
{"messages": [{"role": "user", "content": "什么是梯度下降？"}, {"role": "assistant", "content": "梯度下降是一种优化算法..."}]}
```

详见 `examples/ch09-finetuning/data/sample_train.jsonl`。

### Step 2：QLoRA 训练

核心配置：

```python
# 4-bit 量化配置
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

# LoRA 配置
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules="all-linear",
    lora_dropout=0.05,
    task_type=TaskType.CAUSAL_LM,
)
```

训练大约 30 分钟可以跑完 3 个 epoch（1000 条数据）。显存占用约 6-7GB，A10 绰绰有余。

完整代码见 `examples/ch09-finetuning/02_qlora_train.py`。

### Step 3：合并 LoRA 权重

训练完成后，LoRA adapter 是单独保存的（通常只有几十 MB）。如果要用 vLLM 部署，需要先把 adapter 合并回基础模型：

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM

# 加载基础模型（全精度）
base_model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen2-7B", torch_dtype=torch.bfloat16
)

# 加载 LoRA adapter
model = PeftModel.from_pretrained(base_model, "./output/qwen2-7b-qlora")

# 合并权重
merged_model = model.merge_and_unload()

# 保存合并后的模型
merged_model.save_pretrained("./output/qwen2-7b-merged")
```

完整代码见 `examples/ch09-finetuning/03_merge_lora.py`。

### Step 4：用 vLLM 部署

合并后的模型就是一个标准的 HuggingFace 模型，直接用 vLLM 部署：

```bash
vllm serve ./output/qwen2-7b-merged \
    --tensor-parallel-size 1 \
    --max-model-len 4096 \
    --port 8000
```

然后用标准的 OpenAI API 格式访问：

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "./output/qwen2-7b-merged",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### 或者：用 LLaMA-Factory 一步到位

如果用 LLaMA-Factory，整个流程更简单。配置文件见 `examples/ch09-finetuning/04_llamafactory_config.yaml`，一行命令搞定训练。

---

## 小结

| 方法 | 可训练参数占比 | 7B 显存需求 | 适用场景 |
|-----|-------------|----------|---------|
| Full FT | 100% | ~95 GB | 有大量 GPU 资源 |
| LoRA | ~1% | ~18 GB | 有 A100/A10 |
| QLoRA | ~1% | ~7 GB | 消费级 GPU |

对于大多数实际项目，QLoRA 是最佳起点。等到效果不够好、需要进一步优化时，再考虑 LoRA（bf16）或 Full FT。

下一章我们讲对齐——怎么让微调后的模型不仅"能力强"，而且"回答得好"。
