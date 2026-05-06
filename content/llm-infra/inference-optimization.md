# 第 8 章 推理加速技术

上一章解决了"怎么把模型塞进更小的显存"，这一章解决"怎么让模型跑得更快"。

推理加速的本质是在不改变（或极少改变）输出质量的前提下，减少计算量或提高硬件利用率。这里介绍五个核心技术，按照实际工程中的重要程度排序。

## 8.1 FlashAttention

### 标准 Attention 的问题

回顾第 2 章的 Attention 计算：

```
Q @ K^T → [n, n] 矩阵 → softmax → @ V → 输出
```

中间的 `[n, n]` 矩阵是问题的根源。以 Llama 2 7B 单层单头为例：

| Sequence Length | Attention 矩阵大小 | 显存 (FP16) |
|----------------|-------------------|------------|
| 2K | 4M | 8 MB |
| 8K | 64M | 128 MB |
| 32K | 1024M | 2 GB |
| 128K | 16384M | 32 GB |

乘以 32 层 × 32 头，32K context 下光是 Attention 中间矩阵就要 2TB 显存——显然不可能真的这么存。实际中 PyTorch 会逐步计算释放，但 HBM（GPU 高带宽显存）的读写次数依然是 O(n²)。

GPU 的内存层次：

```
┌──────────────┐
│   SRAM       │  每个 SM 约 192KB (A100)
│   (~20 MB)   │  带宽: ~19 TB/s
├──────────────┤
│   HBM        │  80 GB (A100)
│   (显存)     │  带宽: 2 TB/s
├──────────────┤
│   主内存      │  几百 GB
│   (CPU RAM)  │  带宽: ~50 GB/s
└──────────────┘
```

SRAM 比 HBM 快近 10 倍，但小得多。标准 Attention 的做法是在 HBM 中计算完整的 `[n, n]` 矩阵，来回搬运数据。FlashAttention 的思路：能不能在 SRAM 里分块算完，根本不把完整的 `[n, n]` 写回 HBM？

### FlashAttention 的核心思想

三个关键词：**tiling**（分块）、**kernel fusion**（算子融合）、**recomputation**（重计算）。

```
标准 Attention（多次 HBM 读写）:
  Q, K, V 在 HBM
  → 读 Q, K 到 SRAM, 算 S = Q @ K^T, 写 S 回 HBM
  → 读 S, 算 P = softmax(S), 写 P 回 HBM
  → 读 P, V, 算 O = P @ V, 写 O 回 HBM
  总共 6 次大规模 HBM 读写

FlashAttention（一次搞定）:
  把 Q, K, V 按 block 切分
  → 每次读一小块 Q, K, V 到 SRAM
  → 在 SRAM 中算完局部的 attention + softmax + 输出
  → 用 online softmax 算法把局部结果正确合并
  → 只把最终结果 O 写回 HBM
  HBM 读写次数从 O(n²) 降到 O(n)
```

"online softmax" 是 FlashAttention 能工作的数学基础——它允许在不知道全局最大值的情况下，逐块计算 softmax 并得到正确结果。这不是近似，结果和标准 Attention 在数值上完全一致（忽略浮点精度差异）。

### 演进：FlashAttention 1 → 2 → 3

| 版本 | 主要改进 | 相比 v1 加速 |
|------|---------|-------------|
| v1 (2022) | 基础 tiling + online softmax | 基准 |
| v2 (2023) | 优化并行度，减少 non-matmul FLOPs | 2x |
| v3 (2024) | 利用 H100 的异步 TMA 和 FP8 | 1.5-2x over v2 |

FlashAttention 2 的关键优化：v1 在 batch 和 head 两个维度并行，v2 额外在 sequence length 维度并行，GPU 利用率从 v1 的 ~50% 提升到 ~70%。

### 实际使用

好消息是你不需要手动调用 FlashAttention。PyTorch 2.0+ 的 `F.scaled_dot_product_attention` 默认会选择最优的 attention 实现：

```python
import torch.nn.functional as F

# PyTorch 自动选择 FlashAttention（如果硬件支持）
output = F.scaled_dot_product_attention(query, key, value)
```

vLLM、HuggingFace Transformers 等框架内部已经全面使用 FlashAttention。你要做的只是确保 PyTorch 版本 ≥ 2.0，GPU 支持（A100/H100/RTX 3090+）。

实际效果（A100, Llama 2 7B, batch=1）：

| Seq Length | 标准 Attention | FlashAttention 2 | 加速 | 显存节省 |
|-----------|---------------|------------------|------|---------|
| 2K | 12 ms | 5 ms | 2.4x | 4x |
| 8K | 180 ms | 35 ms | 5.1x | 16x |
| 32K | OOM | 420 ms | ∞ | - |

32K 的 case 最能说明问题：标准 Attention 直接 OOM，FlashAttention 轻松跑完。

代码示例见 `examples/ch08-inference-optimization/01_flash_attention_demo.py`。

## 8.2 Speculative Decoding

### Decode 的瓶颈

第 2 章讲过，Decode 阶段是 memory-bound：每生成一个 token，GPU 要从显存读取整个模型的权重（7B 模型 = 14 GB @ FP16），但实际计算量很小（只处理 1 个 token）。GPU 的算力大量闲置，利用率可能不到 10%。

换个角度看：大模型生成 1 个 token 要 30ms，小模型可能只要 5ms。但两者大部分时间都在等显存读取，真正算的时间差别没那么大。

### 核心思想：猜测 + 验证

Speculative Decoding 的思路简单粗暴：

1. 用一个小模型（draft model）快速生成 K 个候选 token（比如 K=5）
2. 把这 K 个 token 一次性送给大模型（target model）并行验证
3. 大模型从左到右检查，接受匹配的 token，在第一个不匹配的位置生成正确的 token
4. 丢弃不匹配位置之后的所有候选

```
Draft model (Qwen2-0.5B):
  快速生成: [A, B, C, D, E]     耗时 ~25ms (5 × 5ms)

Target model (Qwen2-7B):
  并行验证: [A, B, C, D, E]     耗时 ~35ms (一次 forward)
  结果:      ✓  ✓  ✓  ✗
  接受 [A, B, C]，在位置 4 生成正确 token [D']

收获: 一步得到 4 个 token (3 accepted + 1 generated)
耗时: 25 + 35 = 60ms
标准方式: 4 × 30 = 120ms
加速: 2x
```

为什么验证 5 个 token 和验证 1 个差不多快？因为这 5 个 token 可以像 Prefill 一样并行计算——而 Prefill 是 compute-bound，算 5 个和算 1 个的时间差异很小（GPU 算力有富余）。

### 加速比取决于接受率

Draft model 的输出越接近 Target model，接受率越高，加速越明显：

| 接受率 | 预期加速比 (K=5) | 适用场景 |
|--------|-----------------|---------|
| 50% | ~1.3x | 不相关的 draft model |
| 70% | ~1.8x | 同系列小模型 |
| 80% | ~2.2x | 相关度高的 draft model |
| 90% | ~2.8x | 非常匹配，或简单任务 |

选 draft model 的原则：
- **同系列**：Qwen2-0.5B 做 Qwen2-7B 的 draft，效果好
- **不能太大**：draft model 的开销不能超过节省的时间
- **任务相关**：代码生成这类确定性高的任务，接受率更高

### vLLM 中的使用

```bash
# 启动 vLLM，开启 speculative decoding
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2-7B \
    --speculative-model Qwen/Qwen2-0.5B \
    --num-speculative-tokens 5
```

不需要改客户端代码，对外接口完全一样。

vLLM 还支持 **ngram speculation**——不用额外的 draft model，而是从已有的输出中匹配重复的 n-gram 模式来猜测。对于包含重复模式的文本（比如代码、格式化数据），效果不错：

```bash
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2-7B \
    --speculative-model [ngram] \
    --ngram-prompt-lookup-max 4 \
    --num-speculative-tokens 5
```

代码示例见 `examples/ch08-inference-optimization/02_speculative_decoding.py`。

## 8.3 KV Cache 压缩与管理

第 2 章计算过，Llama 2 7B 在 seq_len=4096、batch=32 时，KV Cache 就要 64 GB 显存。KV Cache 管理是推理引擎的核心问题之一。

### 量化 KV Cache

最直接的方案：把 KV Cache 从 FP16 量化到 FP8 或 INT8。

```
FP16 KV Cache: 每个元素 2 bytes
FP8 KV Cache:  每个元素 1 byte  → 显存减半
```

vLLM 支持 FP8 KV Cache：

```bash
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2-7B \
    --kv-cache-dtype fp8
```

精度损失极小——KV Cache 的数值范围通常比权重更窄，量化友好。多数 benchmark 显示 FP8 KV Cache 的质量几乎无损。

### Sliding Window Attention

Mistral 7B 引入的方案：每个 token 只和最近 W 个 token 做 Attention（W=4096）。

```
标准 Attention (seq_len=32K):
  每个 token 看前面所有 32K token
  KV Cache: 32K × 每 token 大小

Sliding Window (W=4096):
  每个 token 只看前面 4096 token
  KV Cache: 4096 × 每 token 大小（固定）
```

KV Cache 大小不再随 sequence length 增长，而是固定为 W。但代价是长距离依赖能力减弱——超过窗口大小的 token 之间无法直接交互。

实际影响没有理论上那么大，因为信息可以通过多层传递：第 1 层看 4K 窗口，但 32 层叠加后，信息可以传播 32 × 4K = 128K 的有效距离。

### StreamingLLM

更极端的方案：只保留**前几个 token**（attention sink）和**最近的窗口**。

```
完整 KV Cache:  [t1, t2, t3, t4, ..., t998, t999, t1000]
StreamingLLM:    [t1, t2, t3, t4,  ..., t996, t997, t998, t999, t1000]
                  ↑ sink tokens          ↑ recent window
                  (前 4 个)              (最近 1000 个)
```

研究发现，Transformer 的前几个 token 总是获得异常高的 attention score（即使内容无关），它们充当了"注意力锚点"。丢掉这些 token 会导致输出质量急剧下降，但保留它们 + 最近的窗口就能维持不错的质量。

StreamingLLM 让模型可以处理无限长的输入流（比如实时对话），KV Cache 大小固定，不会 OOM。但它不是万能的——被窗口淘汰的信息就真的丢了。

### H2O (Heavy Hitter Oracle)

更精细的淘汰策略：不是简单地按位置淘汰，而是追踪每个 token 的累积 attention score，淘汰分数最低的 token。

直觉：有些 token 很重要（被频繁 attend），有些是"填充词"。与其均匀保留最近的窗口，不如保留最重要的 token。

H2O 在保留相同数量 KV 的情况下，比固定窗口的质量更好。但实现更复杂，需要额外维护 attention score 的统计。

## 8.4 Prefix Caching

### 场景

Agent 应用中，每个请求都带着相同的 system prompt：

```
请求 1: [system_prompt(2000 tokens)] + "帮我搜索天气"(10 tokens)
请求 2: [system_prompt(2000 tokens)] + "读取这个文件"(8 tokens)
请求 3: [system_prompt(2000 tokens)] + "发一封邮件"(7 tokens)
...
```

每次都重新 Prefill 那 2000 个 token 的 system prompt，纯属浪费。

### vLLM 的 Automatic Prefix Caching (APC)

vLLM 把 KV Cache 按 block 管理（参考第 5 章 PagedAttention）。APC 的做法：对 token 序列的每个 block 算一个 hash，如果新请求的前缀 hash 匹配已有 cache，直接复用。

```bash
# 启用 APC
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2-7B \
    --enable-prefix-caching
```

效果取决于 prefix 长度和请求量：

| System Prompt 长度 | 每请求节省的 Prefill | 100 QPS 下节省的 GPU 算力 |
|-------------------|--------------------|-----------------------|
| 500 tokens | ~25 ms | ~2.5 秒/秒的 GPU 时间 |
| 2000 tokens | ~100 ms | ~10 秒/秒的 GPU 时间 |
| 5000 tokens | ~250 ms | ~25 秒/秒的 GPU 时间 |

Agent 场景下 system prompt 往往包含大量 tool description，轻松超过 2000 tokens。APC 可以把 TTFT 从 200ms 降到 20ms（只需要 Prefill 用户的短 query）。

Anthropic 和 OpenAI 的 API 也提供了 Prompt Caching 功能，原理类似。Anthropic 的 Prompt Caching 对缓存命中的 input token 打 9 折（只收 10% 的价格），这对大量调用同一 system prompt 的 Agent 来说省很多钱。

代码示例见 `examples/ch08-inference-optimization/03_prefix_caching_demo.py`。

## 8.5 结构化输出的约束解码

### Agent 为什么需要结构化输出

Agent 调用 tool 时需要生成 JSON：

```json
{"tool": "search_web", "arguments": {"query": "vLLM latest version"}}
```

靠 prompt 引导（"请输出 JSON 格式"）不够可靠——模型可能加 markdown 代码块、多输出一段解释、或者 JSON 格式不合法。对 Agent 来说，一个非法 JSON 就意味着 tool 调用失败，需要重试，浪费 token 和时间。

### 约束解码的原理

在每一步 token 生成时，根据目标格式（JSON Schema / 正则表达式），屏蔽掉不合法的 token：

```
当前已生成: {"name": "Al
目标 schema: {"name": string, "age": integer}

此时合法的下一步:
  ✓ 任意字符 (继续字符串)
  ✓ " (结束字符串)
  ✗ } (字符串未结束)
  ✗ , (字符串未结束)
  ✗ 数字 (在字符串内)

实现: 把不合法 token 的 logit 设为 -∞ → softmax 后概率为 0
```

这个过程用一个有限状态机（FSM）驱动。JSON Schema 先被编译成正则表达式，正则再编译成 FSM。每生成一个 token，FSM 前进一步，输出当前状态下合法的 token 集合。

### 性能开销

约束解码的开销主要在两处：
1. **FSM 编译**：把 JSON Schema 编译成 FSM，一次性开销，通常 < 100ms
2. **每步 token masking**：查 FSM 获取合法 token，设置 logit mask。开销很小，< 0.1ms/step

总体对推理速度的影响通常 < 5%，但换来 100% 合法的输出。

### 工具和框架

**outlines** — 最早的约束解码库，支持 JSON Schema、正则、选择约束：

```python
from outlines import models, generate
from pydantic import BaseModel

class ToolCall(BaseModel):
    tool: str
    arguments: dict

model = models.transformers("Qwen/Qwen2-7B")
generator = generate.json(model, ToolCall)
result = generator("Call a tool to search for: latest vLLM version")
# result 一定是合法的 ToolCall 对象
```

**vLLM 内置 Guided Decoding** — 直接在 API 参数中指定：

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="na")

response = client.chat.completions.create(
    model="Qwen/Qwen2-7B",
    messages=[{"role": "user", "content": "帮我搜索天气"}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "tool_call",
            "schema": {
                "type": "object",
                "properties": {
                    "tool": {"type": "string"},
                    "arguments": {"type": "object"}
                },
                "required": ["tool", "arguments"]
            }
        }
    }
)
```

**SGLang 的约束解码** — 性能最好。SGLang 优化了 FSM 的编译和执行：batch 内共享 FSM 状态，减少重复计算。在需要大量 JSON 输出的 Agent 场景中，SGLang 的 constrained decoding 比 vLLM 快 2-3x。

### 选型建议

| 方案 | 适用场景 | 特点 |
|------|---------|------|
| vLLM guided decoding | 生产部署，通过 API 使用 | 开箱即用，性能不错 |
| SGLang | 高并发 Agent 场景 | 约束解码性能最好 |
| outlines | 研究/原型/自定义模型 | 灵活，支持本地模型 |
| 云 API (OpenAI/Anthropic) | 直接用云服务 | 最简单，JSON mode 即可 |

对 Agent 工程师来说，如果你用云 API，直接用 JSON mode 就行。如果自部署，vLLM 或 SGLang 都内置了约束解码，比自己在应用层 parse + retry 可靠得多。

代码示例见 `examples/ch08-inference-optimization/04_constrained_decoding.py`。

---

## 本章小结

五个技术的定位：

| 技术 | 解决的问题 | 是否需要手动配置 | 加速效果 |
|------|-----------|----------------|---------|
| FlashAttention | Attention 显存和速度 | 不需要（PyTorch 自动） | 2-4x |
| Speculative Decoding | Decode 阶段 GPU 利用率低 | 需要选 draft model | 1.5-3x |
| KV Cache 压缩 | KV Cache 显存占用 | 简单配置 | 显存减半 |
| Prefix Caching | 重复 prefix 的计算浪费 | 一行配置开启 | TTFT 降 80%+ |
| 约束解码 | 输出格式不合法 | API 参数指定 | 无加速，但避免重试 |

对 Agent 工程师来说，最应该关注的是 **Prefix Caching** 和 **约束解码**——它们直接影响 Agent 的成本和可靠性。FlashAttention 已经是默认开启的，享受就好。Speculative Decoding 在 TTFT 不敏感但 TPS 重要的场景（长文本生成）价值最大。

**延伸阅读：**

- [FlashAttention 论文](https://arxiv.org/abs/2205.14135) — Tri Dao et al.
- [FlashAttention-2 论文](https://arxiv.org/abs/2307.08691)
- [Speculative Decoding 论文](https://arxiv.org/abs/2211.17192) — Leviathan et al.
- [StreamingLLM 论文](https://arxiv.org/abs/2309.17453) — Xiao et al.
- [outlines GitHub](https://github.com/dottxt-ai/outlines)
- [vLLM Guided Decoding 文档](https://docs.vllm.ai/en/latest/features/structured_outputs.html)
