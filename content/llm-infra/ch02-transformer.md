# 第 2 章 Transformer 架构：工程师视角

## 2.1 不讲数学，讲数据流

Transformer 本质上就是一个函数：输入一串 token ID，输出下一个 token 的概率分布。中间经过的每一步，输入输出都是确定 shape 的 tensor。用 Llama 2 7B 的真实参数来走一遍：

```
模型参数（Llama 2 7B）:
- vocab_size = 32000       # 词表大小
- hidden_dim = 4096        # 隐藏层维度
- n_layers = 32            # Transformer 层数
- n_heads = 32             # Attention 头数
- head_dim = 128           # 每个头的维度 (4096 / 32)
- intermediate_dim = 11008 # FFN 中间层维度
```

假设输入是 "什么是 KV Cache"，经 Tokenizer 切成 6 个 token：

```
输入文本: "什么是 KV Cache"
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Step 1: Tokenize                                         │
│ "什么是 KV Cache" → [20345, 12876, 476, 8067, 28747, 5765] │
│ 输出 shape: [6]  (6 个 token ID)                          │
└──────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Step 2: Token Embedding + Positional Encoding            │
│ 每个 token ID 查表得到一个 4096 维向量                     │
│ 再加上位置编码（Llama 2 用 RoPE，不是加法而是旋转）         │
│ 输出 shape: [6, 4096]                                    │
└──────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Step 3: 32 × Transformer Block (重复 32 次)               │
│                                                          │
│   ┌────────────────────────────────────────────┐         │
│   │ 3a. RMSNorm                                │         │
│   │     [6, 4096] → [6, 4096]                  │         │
│   ├────────────────────────────────────────────┤         │
│   │ 3b. Multi-Head Self-Attention (GQA)        │         │
│   │     Q: [6, 4096] → [6, 32, 128]           │         │
│   │     K: [6, 4096] → [6, 32, 128]           │         │
│   │     V: [6, 4096] → [6, 32, 128]           │         │
│   │     Attention 计算后: [6, 32, 128]          │         │
│   │     投影回: [6, 4096]                       │         │
│   ├────────────────────────────────────────────┤         │
│   │ 3c. Residual Connection                    │         │
│   │     x = x + attention_output               │         │
│   ├────────────────────────────────────────────┤         │
│   │ 3d. RMSNorm                                │         │
│   │     [6, 4096] → [6, 4096]                  │         │
│   ├────────────────────────────────────────────┤         │
│   │ 3e. FFN (SwiGLU)                           │         │
│   │     [6, 4096] → [6, 11008] → [6, 4096]    │         │
│   ├────────────────────────────────────────────┤         │
│   │ 3f. Residual Connection                    │         │
│   │     x = x + ffn_output                     │         │
│   └────────────────────────────────────────────┘         │
│                                                          │
│ 输出 shape: [6, 4096]                                    │
└──────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Step 4: Final RMSNorm + Linear Head                      │
│ [6, 4096] → RMSNorm → [6, 4096] → Linear → [6, 32000]  │
│ 最后一个位置的 logits: [32000]  (词表上的概率分布)          │
└──────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│ Step 5: Sampling                                         │
│ 对 [32000] 维 logits 做 softmax + temperature scaling    │
│ 然后 top-p/top-k 采样，输出 1 个 token ID                 │
│ 比如: 15043 → decode → "是"                              │
└──────────────────────────────────────────────────────────┘
```

关键信息：整个模型就是矩阵乘法（GEMM）+ 少量逐元素操作（norm、activation）。Llama 2 7B 的 70 亿参数，绝大部分在 Attention 的 QKV 投影矩阵和 FFN 的权重矩阵里。

**参数分布（Llama 2 7B，每层）：**

| 组件 | 参数量 | 占比 |
|------|--------|------|
| Q/K/V 投影 (Wq, Wk, Wv) | 4096 x 4096 x 3 = 50.3M | 23.5% |
| Output 投影 (Wo) | 4096 x 4096 = 16.8M | 7.8% |
| FFN (gate, up, down) | 4096 x 11008 x 3 = 135.3M | 63.2% |
| RMSNorm | 4096 x 2 = 8K | ~0% |

每层约 202M 参数，32 层 = 6.5B，加上 Embedding 层（32000 x 4096 = 131M）和 LM Head（131M），总计约 6.7B。

## 2.2 Tokenization

Tokenizer 是模型和人类语言之间的翻译器。它把文本切成 token（子词单元），每个 token 对应词表里的一个 ID。

### BPE 算法的直觉

BPE（Byte Pair Encoding）的核心思想极其简单：

1. 从单个字符开始（或 byte）
2. 统计相邻 pair 出现的频率
3. 把出现最频繁的 pair 合并成新 token
4. 重复，直到词表达到目标大小

```
初始:  l o w e r    (5个字符)
第1轮: lo w e r     (lo 合并，因为 l+o 最频繁)
第2轮: low e r      (lo+w 合并)
第3轮: lower        (low+er 合并)
```

最终效果：高频词（"the"、"is"）会成为一个 token，低频词会被拆成几个子词。"unhappiness" 可能被拆成 "un" + "happiness"，甚至 "un" + "happ" + "iness"。

### 三种主流 Tokenizer

| 特性 | tiktoken (OpenAI) | SentencePiece (Google) | HF Tokenizers |
|------|-------------------|----------------------|---------------|
| 算法 | BPE (byte-level) | BPE / Unigram | BPE / WordPiece / Unigram |
| 实现语言 | Rust + Python | C++ + Python | Rust + Python |
| 速度 | 极快 | 快 | 极快 |
| 用户 | GPT-4, GPT-4o | Llama, T5, Gemma | BERT, 各种 HF 模型 |
| 中文处理 | byte-level fallback | 原生支持 | 取决于具体模型 |

### 中文分词的特殊性

中文对 Tokenizer 是个挑战。英文有天然的空格分隔词，中文没有。不同 Tokenizer 对中文的处理差异很大：

```
输入: "大语言模型的推理优化"

tiktoken (GPT-4):     ["大语言", "模型", "的", "推理", "优化"]          → 5 tokens
SentencePiece (Llama): ["大", "语言", "模型", "的", "推", "理", "优化"] → 7 tokens
```

Token 数量直接影响成本和速度——同样的中文内容，Llama 可能比 GPT-4 多消耗 30-50% 的 token。这也是为什么 Qwen、Yi 等中文大模型会特意扩充中文词表。

Qwen2 的词表有 151,646 个 token，其中大量是中文常用词和短语，同样的中文输入只需要更少的 token。

代码示例见 `examples/ch02-transformer/01_tokenizer_compare.py`。

## 2.3 Attention 的计算成本

### O(n^2) 从何而来

Self-Attention 的核心操作：每个 token 要和所有其他 token 计算相关性。用矩阵运算表示：

`@` 是 Python 的矩阵乘法运算符，相当于 `np.matmul(X, Wq)`。前端同学可以理解为高维数组的点积。

```
Q = X @ Wq    # [n, d] @ [d, d] → [n, d]
K = X @ Wk    # [n, d] @ [d, d] → [n, d]
V = X @ Wv    # [n, d] @ [d, d] → [n, d]

Scores = Q @ K^T     # [n, d] @ [d, n] → [n, n]   ← 这步是 O(n²)
Scores = Scores / sqrt(d)
Weights = softmax(Scores)  # [n, n]
Output = Weights @ V       # [n, n] @ [n, d] → [n, d]
```

`Q @ K^T` 生成一个 [n, n] 的矩阵——n 是 sequence length。这意味着：
- n = 4K 时，矩阵大小 = 16M 个元素
- n = 32K 时，矩阵大小 = 1024M 个元素
- n = 128K 时，矩阵大小 = 16384M 个元素

**32K context 的计算量是 4K 的 64 倍**（(32K/4K)^2 = 64）。这就是长 context 推理又慢又贵的根本原因。

实际数字（Llama 2 7B，单层，单头，FP16）：

| Sequence Length | Attention 矩阵大小 | 显存占用 | FLOPs |
|-----------------|-------------------|----------|-------|
| 2K | 4M | 8MB | 1.07B |
| 4K | 16M | 32MB | 4.29B |
| 32K | 1024M | 2GB | 274.9B |
| 128K | 16384M | 32GB | 4398B |

注意这只是**单层单头**的数字。Llama 2 7B 有 32 层 x 32 头 = 1024 个 attention 计算。

### Multi-Head Attention

为什么要 Multi-Head 而不是一个大的 Attention？

把 4096 维的向量拆成 32 个头，每个头 128 维。每个头独立做 Attention，关注不同的特征模式——有的头可能关注语法关系，有的关注语义相似性，有的关注位置距离。

计算量不变（32 个 128 维头的总计算量 = 1 个 4096 维头的计算量），但表达能力更强，因为多个头可以学到不同的 attention pattern。

### GQA（Grouped Query Attention）

标准 Multi-Head Attention 里，Q、K、V 各有 32 个头。GQA 的改进：Q 保持 32 个头，但 K 和 V 只用 8 个头（每 4 个 Q 头共享 1 组 KV）。

```
MHA (Multi-Head Attention):
  Q: 32 heads    K: 32 heads    V: 32 heads

GQA (Grouped Query Attention, 8 KV heads):
  Q: 32 heads    K: 8 heads     V: 8 heads
  每 4 个 Q head 共享 1 个 KV head

MQA (Multi-Query Attention):
  Q: 32 heads    K: 1 head      V: 1 head
  所有 Q head 共享 1 个 KV head
```

GQA 的好处：
1. **KV Cache 缩小 4 倍**（从 32 头降到 8 头），显存压力大幅降低
2. **推理速度提升**——Decode 阶段是 memory-bound，KV Cache 越小，读取越快
3. **精度损失很小**——实验表明 GQA-8 和 MHA 的效果差异不到 1%

Llama 2 70B、Llama 3 全系列、Mistral、Qwen2 都用了 GQA。可以说 GQA 已经是现代 LLM 的标配。

## 2.4 KV Cache

### 为什么需要 KV Cache

LLM 生成文本是自回归的（autoregressive）：每次生成一个 token，然后把它拼到输入后面，再生成下一个。

不用 KV Cache 的做法：

```
第 1 步: 输入 [A, B, C]         → 计算全部 Attention → 生成 D
第 2 步: 输入 [A, B, C, D]     → 重新计算全部 Attention → 生成 E
第 3 步: 输入 [A, B, C, D, E] → 又重新计算全部 Attention → 生成 F
```

每一步都在重复计算前面 token 的 K 和 V。这些值不会变（因为前面的 token 没变），纯粹浪费。

用 KV Cache：

```
第 1 步: 输入 [A, B, C]     → 计算 K_ABC, V_ABC 并缓存 → 生成 D
第 2 步: 只输入 [D]          → 计算 K_D, V_D，和缓存的 KV 拼接 → 生成 E
第 3 步: 只输入 [E]          → 计算 K_E, V_E，和缓存的 KV 拼接 → 生成 F
```

每步只需处理 1 个新 token，之前的 KV 直接从缓存读取。Decode 阶段的计算量从 O(n) 降到 O(1)（不考虑 Attention 本身和缓存的乘法）。

### KV Cache 的显存占用

公式：

```
KV Cache 大小 = 2 × n_layers × n_kv_heads × head_dim × seq_len × batch_size × bytes_per_param
```

其中 2 是因为 K 和 V 各一份。

Llama 2 7B（FP16，n_kv_heads=32）的 KV Cache 大小：

| Seq Length | Batch Size = 1 | Batch Size = 8 | Batch Size = 32 |
|------------|----------------|-----------------|------------------|
| 512 | 256 MB | 2 GB | 8 GB |
| 2048 | 1 GB | 8 GB | 32 GB |
| 4096 | 2 GB | 16 GB | 64 GB |

计算过程（以 seq_len=2048, batch=1 为例）：
```
2 × 32 layers × 32 heads × 128 dim × 2048 seq × 1 batch × 2 bytes(FP16)
= 2 × 32 × 32 × 128 × 2048 × 2
= 1,073,741,824 bytes
≈ 1 GB
```

模型权重本身（FP16）占 13.5 GB。A100 80GB 显存里，模型权重占 13.5 GB，剩下 66.5 GB 给 KV Cache 和其他开销。如果 batch size = 32、seq_len = 4096，KV Cache 就要 64 GB——几乎占满。

这就是为什么 **KV Cache 管理是推理引擎的核心问题**。vLLM 的 PagedAttention 就是为了解决 KV Cache 的显存碎片化问题。

如果用 GQA（比如 Llama 3 8B 只有 8 个 KV 头），KV Cache 直接缩小到 1/4：

```
Llama 2 7B (32 KV heads): seq_len=2048, batch=1 → 1 GB
Llama 3 8B (8 KV heads):  seq_len=2048, batch=1 → 256 MB
```

同样的显存，Llama 3 能跑 4 倍的 batch size 或 4 倍的 context length。

代码示例见 `examples/ch02-transformer/03_kv_cache_demo.py`。

## 2.5 动手：最小 GPT 训练

> 这一节需要 Python 和 PyTorch 基础。如果你还不熟悉，可以先跳过，读完[第 0 章](../ch00-python-quickstart/README.md)和第 3 章后再回来。

Andrej Karpathy 的 [nanoGPT](https://github.com/karpathy/nanoGPT) 是理解 Transformer 最好的学习材料。整个 GPT-2 的训练代码只有 300 行左右。

这里基于 nanoGPT 的思路做一个更简化的版本——字符级 GPT。不用 BPE tokenizer，直接用字符作为 token。这样可以去掉 tokenizer 的复杂度，专注理解 Transformer 本身。

### 核心结构

```python
class MiniGPT(nn.Module):
    def __init__(self, vocab_size, n_embd, n_head, n_layer, block_size):
        # Token Embedding: vocab_size → n_embd
        self.token_embedding = nn.Embedding(vocab_size, n_embd)
        # Position Embedding: block_size → n_embd
        self.position_embedding = nn.Embedding(block_size, n_embd)
        # N 个 Transformer Block
        self.blocks = nn.ModuleList([Block(n_embd, n_head) for _ in range(n_layer)])
        # Final LayerNorm + Linear Head
        self.ln_f = nn.LayerNorm(n_embd)
        self.lm_head = nn.Linear(n_embd, vocab_size)
```

每个 Block 包含两步：

```python
class Block(nn.Module):
    def forward(self, x):
        x = x + self.attention(self.ln1(x))   # Attention + Residual
        x = x + self.ffn(self.ln2(x))          # FFN + Residual
        return x
```

Attention 的实现（单头简化版）：

```python
class SelfAttention(nn.Module):
    def forward(self, x):
        B, T, C = x.shape              # batch, seq_len, embedding_dim
        q = self.query(x)              # [B, T, C]
        k = self.key(x)                # [B, T, C]
        v = self.value(x)              # [B, T, C]

        # Attention scores
        scores = q @ k.transpose(-2, -1) * (C ** -0.5)  # [B, T, T]
        # Causal mask: 不能看到未来的 token
        scores = scores.masked_fill(self.mask[:T, :T] == 0, float('-inf'))
        weights = F.softmax(scores, dim=-1)
        out = weights @ v              # [B, T, C]
        return out
```

关键点：
1. **Causal Mask**：下三角矩阵，确保每个 token 只能看到它前面的 token。这就是 "decoder-only" 架构的本质。
2. **Residual Connection**：`x = x + attention(x)`。没有残差连接，深层网络根本训练不起来。
3. **LayerNorm**：稳定训练过程。Pre-norm（norm 在 attention 前面）比 Post-norm 更稳定，现代模型都用 Pre-norm。

### 训练循环

```python
for step in range(max_steps):
    # 随机取一个 batch
    xb, yb = get_batch('train')      # [B, T], [B, T]

    # Forward pass
    logits = model(xb)                # [B, T, vocab_size]

    # Cross-entropy loss
    loss = F.cross_entropy(
        logits.view(-1, vocab_size),  # [B*T, vocab_size]
        yb.view(-1)                   # [B*T]
    )

    # Backward + Update
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
```

在 Shakespeare 数据集（~1MB 文本）上训练几分钟，loss 能降到 1.5 以下，生成的文本虽然不太通顺但已经有 Shakespeare 的风格了。

完整代码见 `examples/ch02-transformer/04_nano_gpt_train.py`。

---

**延伸阅读：**

- [karpathy/nanoGPT](https://github.com/karpathy/nanoGPT) - 300 行实现 GPT-2 训练
- [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/) - Jay Alammar 的经典图解
- [Llama 2 论文](https://arxiv.org/abs/2307.09288) - Meta 的技术报告，对理解 GQA 很有帮助
- [FlashAttention 论文](https://arxiv.org/abs/2205.14135) - IO-aware attention，第 3 章会详细讲

## 代码示例

| 示例 | 说明 | 硬件要求 |
|------|------|---------|
| [01_tokenizer_compare.py](../../examples/ch02-transformer/01_tokenizer_compare.py) | 对比 BPE/SentencePiece/tiktoken | CPU |
| [02_attention_visualize.py](../../examples/ch02-transformer/02_attention_visualize.py) | 可视化 Attention 权重 | CPU |
| [03_kv_cache_demo.py](../../examples/ch02-transformer/03_kv_cache_demo.py) | KV Cache 有无对比 | GPU (any) |
| [04_nano_gpt_train.py](../../examples/ch02-transformer/04_nano_gpt_train.py) | 基于 nanoGPT 的最小训练 | GPU 8GB+ |
