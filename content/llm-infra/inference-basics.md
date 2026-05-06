# 第 4 章 模型推理：从权重文件到 API 响应

一个 LLM 模型的旅程，从磁盘上的二进制文件，到用户屏幕上逐字蹦出的回答。这一章拆解这个过程中每一个关键环节。

## 4.1 模型格式

模型训练完成后，权重需要保存到磁盘。不同的序列化格式直接影响加载速度、安全性和部署方式。

### PyTorch 原生格式（.bin / .pt）

PyTorch 使用 Python 的 pickle 协议序列化张量。这是最早也是最广泛使用的格式：

```
model.safetensors  ←  现代
pytorch_model.bin  ←  传统
model.pt           ←  PyTorch 原生 checkpoint
```

**致命问题：pickle 可以执行任意代码。** 反序列化一个恶意的 `.bin` 文件，等同于运行攻击者的 Python 脚本。2023 年就有安全研究者演示了通过 Hugging Face 模型文件植入后门的攻击。

### SafeTensors

Hugging Face 在 2023 年推出的格式，目前已经是事实标准。

核心设计：**只存储张量数据和元数据（shape、dtype、offset），不允许执行任何代码。**

```
┌──────────────────────────────────────┐
│  Header (JSON)                       │
│  - tensor name → {dtype, shape,      │
│    data_offsets: [start, end]}       │
├──────────────────────────────────────┤
│  Tensor Data (raw bytes)             │
│  - 连续存储，支持 mmap              │
│  - 零拷贝直接映射到内存             │
└──────────────────────────────────────┘
```

为什么 SafeTensors 正在成为标准：

1. **安全**：无法执行任意代码，从根本上杜绝反序列化攻击
2. **快**：支持 mmap，加载速度比 `.bin` 快 2x-5x。不需要把整个文件读入内存再反序列化
3. **跨框架**：PyTorch、TensorFlow、JAX、PaddlePaddle 都能直接加载
4. **零拷贝**：操作系统通过内存映射直接访问磁盘数据，不产生额外内存拷贝

LLaMA 3、Mistral、Qwen、DeepSeek 等主流开源模型全部默认使用 SafeTensors 发布。

### GGUF

llama.cpp 生态的专用格式。**核心特点：一个文件包含一切。**

```
┌──────────────────────────────────────┐
│  Magic Number (GGUF)                 │
├──────────────────────────────────────┤
│  Metadata (key-value pairs)          │
│  - 模型架构、参数量、量化类型        │
│  - tokenizer 配置                    │
│  - chat template                     │
│  - 训练超参数                        │
├──────────────────────────────────────┤
│  Tensor Info                         │
│  - name, shape, dtype, offset        │
├──────────────────────────────────────┤
│  Tensor Data (quantized)             │
│  - 支持 Q2_K 到 Q8_0 多种量化       │
│  - 也支持 F16/BF16/F32              │
└──────────────────────────────────────┘
```

GGUF 的优势：
- **自包含**：模型权重 + tokenizer + 配置全在一个文件里，不需要额外文件
- **量化友好**：原生支持 2-bit 到 8-bit 量化，Q4_K_M 是最常用的平衡点
- **CPU 推理优化**：llama.cpp 针对 CPU 做了大量 SIMD 优化
- **跨平台**：Windows、macOS、Linux、Android、iOS 都能跑

一个典型的量化方案选择：

| 量化类型 | 位宽 | 7B 模型大小 | 质量损失 | 适用场景 |
|---------|------|------------|---------|---------|
| Q8_0 | 8-bit | ~7.0 GB | 极小 | 质量优先 |
| Q6_K | 6-bit | ~5.5 GB | 很小 | 质量与大小平衡 |
| Q5_K_M | 5-bit | ~4.8 GB | 小 | 推荐默认 |
| Q4_K_M | 4-bit | ~4.1 GB | 可接受 | 内存有限 |
| Q3_K_M | 3-bit | ~3.3 GB | 明显 | 极端内存限制 |
| Q2_K | 2-bit | ~2.7 GB | 较大 | 实验用途 |

### ONNX

微软主推的跨框架推理格式。模型被转换为计算图（graph），每个节点是一个算子（operator）。

ONNX 在传统 ML 和 CV 领域用得多，但在 LLM 领域存在感较弱。原因：LLM 的动态特性（变长序列、KV Cache 管理）和 ONNX 的静态图模型天然冲突。不过微软的 ONNX Runtime GenAI 在持续改进对 LLM 的支持。

### 格式对比总结

| 特性 | .bin/.pt | SafeTensors | GGUF | ONNX |
|------|---------|-------------|------|------|
| 安全性 | 差（pickle） | 优 | 优 | 优 |
| 加载速度 | 慢 | 快（mmap） | 快（mmap） | 中等 |
| 量化支持 | 无原生支持 | 无原生支持 | 原生 2-8bit | 有限 |
| GPU 推理 | PyTorch 原生 | 主流引擎支持 | llama.cpp | ONNX Runtime |
| CPU 推理 | 差 | 需配合引擎 | 优秀 | 良好 |
| 主要场景 | 训练/微调 | GPU 服务部署 | 本地/边缘部署 | 跨平台部署 |

## 4.2 模型加载过程

一个 7B 参数的模型，FP16 精度下约 14 GB。怎么把这么大的数据从磁盘搬到 GPU 显存？

### 从磁盘到显存

```
磁盘 (SSD/NVMe)
  │
  │  1. 读取文件 → 系统内存（或 mmap）
  ▼
CPU 内存 (RAM)
  │
  │  2. PCIe 传输 → GPU 显存
  ▼
GPU 显存 (VRAM)
  │
  │  3. 模型就绪，开始推理
  ▼
推理计算
```

瓶颈在哪？

- NVMe SSD 读取速度：~3-7 GB/s
- PCIe 4.0 x16 带宽：~32 GB/s
- PCIe 5.0 x16 带宽：~64 GB/s
- GPU HBM 带宽：A100 为 2 TB/s，H100 为 3.35 TB/s

一个 14 GB 的模型，从 NVMe 读取约需 2-4 秒，通过 PCIe 传到 GPU 约需 0.5 秒。实际加载时间主要花在反序列化和内存分配上。

### 内存映射（mmap）

传统加载方式：读取整个文件到内存 → 反序列化 → 拷贝到 GPU。内存峰值是模型大小的 2 倍以上。

mmap 方式：操作系统把文件直接映射到进程的虚拟地址空间。访问某个张量时，OS 按需从磁盘加载对应的 page。

```python
# 传统方式 —— 内存峰值 ~28 GB（14 GB 文件 + 14 GB 反序列化）
model = torch.load("model.bin")

# mmap 方式 —— 内存峰值约等于模型大小
# SafeTensors 默认使用 mmap
from safetensors.torch import load_file
tensors = load_file("model.safetensors")  # mmap，按需加载
```

### 模型分片（Sharding）

大模型往往被切成多个文件。一个 70B 模型在 FP16 下约 140 GB，单个文件太大不方便传输和加载。

Hugging Face 的分片规范：

```
model-00001-of-00004.safetensors   (35 GB)
model-00002-of-00004.safetensors   (35 GB)
model-00003-of-00004.safetensors   (35 GB)
model-00004-of-00004.safetensors   (35 GB)
model.safetensors.index.json       (索引文件)
```

`index.json` 记录了每个张量在哪个分片文件中：

```json
{
  "metadata": {"total_size": 150323855360},
  "weight_map": {
    "model.embed_tokens.weight": "model-00001-of-00004.safetensors",
    "model.layers.0.self_attn.q_proj.weight": "model-00001-of-00004.safetensors",
    "model.layers.0.self_attn.k_proj.weight": "model-00001-of-00004.safetensors",
    "...": "..."
  }
}
```

### Hugging Face accelerate 加载大模型

accelerate 库解决一个核心问题：模型比单卡显存大时怎么办？

```python
from accelerate import init_empty_weights, load_checkpoint_and_dispatch

# 1. 先创建一个空壳模型（不分配实际内存）
with init_empty_weights():
    model = AutoModelForCausalLM.from_config(config)

# 2. 自动把层分配到不同设备
model = load_checkpoint_and_dispatch(
    model,
    checkpoint="path/to/model",
    device_map="auto",          # 自动分配到多卡 + CPU + 磁盘
    max_memory={
        0: "24GiB",             # GPU 0 最多用 24 GB
        1: "24GiB",             # GPU 1 最多用 24 GB
        "cpu": "64GiB"          # CPU 内存
    },
    no_split_module_classes=["LlamaDecoderLayer"]  # 一个 layer 不能拆到两个设备
)
```

`device_map="auto"` 的分配策略：优先填满 GPU，放不下的放 CPU 内存，再放不下的放磁盘（offload）。推理时数据在设备间自动搬运，但跨设备通信会显著拖慢速度。

## 4.3 Prefill vs Decode

LLM 推理分两个截然不同的阶段。理解这两个阶段是理解所有推理优化的基础。

### Prefill 阶段

用户输入 prompt 后，模型需要一次性处理所有输入 token。这一步叫 Prefill（也叫 prompt processing）。

```
输入: "用 TypeScript 写一个快排算法"  →  12 个 token

Prefill:
- 12 个 token 并行通过所有 Transformer 层
- 计算每个 token 的 Key 和 Value，存入 KV Cache
- 输出第一个生成 token 的概率分布
```

**特征：Compute-bound（计算密集）。** 所有 token 并行计算，GPU 的算力是瓶颈。矩阵乘法的 FLOPS 与 token 数量成正比。

### Decode 阶段

拿到第一个 token 后，进入自回归生成。每一步只处理上一步生成的 1 个 token。

```
Decode 第 1 步: 输入 1 个新 token → 输出下一个 token 的概率
Decode 第 2 步: 输入 1 个新 token → 输出下一个 token 的概率
...
直到生成 EOS 或达到 max_tokens
```

**特征：Memory-bound（带宽密集）。** 每步只有 1 个 token，计算量极小，但需要从显存读取整个模型权重 + 全部 KV Cache。GPU 的显存带宽是瓶颈。

### 性能数字

以 Llama-3-8B 在 A100-80GB 上的典型表现：

```
Prefill:
- 1024 个输入 token：~30ms
- 4096 个输入 token：~100ms
- 吞吐量：~40,000 tokens/s
- GPU 利用率：70-90%（计算密集，算力被充分利用）

Decode:
- 每个 token：~15-25ms
- 吞吐量（单请求）：~40-65 tokens/s
- GPU 利用率：5-15%（大量时间在等显存数据搬运）
```

一个关键洞察：**Decode 阶段每生成 1 个 token，需要读取一遍完整的模型权重。** 8B 模型在 FP16 下是 16 GB，A100 的 HBM 带宽是 2 TB/s，所以理论上限是 2000/16 ≈ 125 tokens/s。实际因为还要读 KV Cache，真实数字更低。

### TTFT vs TPS

这两个指标分别衡量两个阶段：

```
用户发送请求
  │
  ├──── Prefill ────┤
  │                 │
  │    TTFT         │  第一个 token 到达
  │    (Time To     │
  │    First Token) ├── Decode ──── Decode ──── Decode ──── ...
  │                 │     │          │          │
  │                 │  token 2    token 3    token 4
  │                 │
  │                 │  TPS (Tokens Per Second)
  │                 │  = 生成速度，用户体感的"打字速度"
```

| 指标 | 衡量阶段 | 影响因素 | 优化方向 |
|------|---------|---------|---------|
| TTFT | Prefill | 输入长度、GPU 算力 | Prefix Caching、Chunked Prefill |
| TPS | Decode | 模型大小、显存带宽 | 量化、Speculative Decoding |

对用户体验的影响：
- **TTFT > 2s**：用户明显感觉"卡了一下"
- **TPS < 15**：用户感觉比人类打字还慢（人类阅读速度约 250 词/分钟 ≈ 5 tokens/s，但用户期望 AI 更快）
- **TPS > 50**：大多数用户觉得"很流畅"

## 4.4 采样策略

模型输出的是 vocabulary 上的概率分布（logits），采样策略决定如何从这个分布中选出下一个 token。

### Greedy Decoding

最简单：每次选概率最高的 token。

```python
next_token = torch.argmax(logits, dim=-1)
```

优点：确定性，结果可复现。缺点：输出单调，容易陷入重复循环。

### Temperature

在 softmax 之前除以温度系数 T：

```python
# T < 1: 分布更尖锐，更确定
# T = 1: 原始分布
# T > 1: 分布更平坦，更随机
probs = softmax(logits / temperature)
```

实际效果（假设 top-3 token 的原始概率是 0.5, 0.3, 0.2）：

| Temperature | Token A | Token B | Token C |
|-------------|---------|---------|---------|
| 0.1 | 0.997 | 0.003 | 0.000 |
| 0.5 | 0.76 | 0.18 | 0.06 |
| 1.0 | 0.50 | 0.30 | 0.20 |
| 2.0 | 0.37 | 0.33 | 0.30 |

### Top-k Sampling

只保留概率最高的 k 个 token，其余设为 0，重新归一化后采样。

```python
# top_k = 50: 只从 top 50 个 token 中采样
values, indices = torch.topk(logits, k=50)
# 把不在 top-k 中的 logits 设为 -inf
logits[logits < values[..., -1]] = -float('inf')
probs = softmax(logits)
next_token = torch.multinomial(probs, num_samples=1)
```

问题：k 是固定的。如果概率高度集中在 3 个 token 上，top-50 会引入太多噪声；如果分布很平坦，top-50 可能不够。

### Top-p（Nucleus Sampling）

动态选择 token 子集：按概率降序排列，累积概率达到 p 时截断。

```python
sorted_probs, sorted_indices = torch.sort(probs, descending=True)
cumulative_probs = torch.cumsum(sorted_probs, dim=-1)
# 移除累积概率超过 p 的 token
mask = cumulative_probs - sorted_probs > top_p
sorted_probs[mask] = 0
sorted_probs /= sorted_probs.sum()  # 重新归一化
```

Top-p = 0.9 意味着：从包含 90% 总概率的最小 token 集合中采样。分布尖锐时可能只有 2-3 个 token，分布平坦时可能有几百个。

### Repetition Penalty

防止模型重复生成相同内容。对已经出现过的 token 施加惩罚：

```python
for token_id in set(generated_tokens):
    if logits[token_id] > 0:
        logits[token_id] /= repetition_penalty  # 降低正 logit
    else:
        logits[token_id] *= repetition_penalty  # 让负 logit 更负
```

`repetition_penalty = 1.0` 表示不惩罚，`1.1` 是常用值，`1.5` 以上开始明显影响输出质量。

还有一种变体叫 frequency_penalty 和 presence_penalty（OpenAI API 用的）：
- `presence_penalty`：只要 token 出现过就惩罚，不管出现几次
- `frequency_penalty`：惩罚力度与出现次数成正比

### 生产环境常用配置

```yaml
# 代码生成
temperature: 0.0          # 或者极低如 0.1
top_p: 1.0
# 确定性输出，代码需要正确而不是创意

# 通用对话
temperature: 0.7
top_p: 0.9
repetition_penalty: 1.05
# 平衡质量和多样性

# 创意写作
temperature: 1.0
top_p: 0.95
repetition_penalty: 1.1
# 允许更多随机性

# Agent / 工具调用
temperature: 0.0
# 工具调用需要严格格式，不能有随机性
```

## 4.5 Streaming 输出

LLM 生成一个 500 token 的回答，如果等全部生成完再返回，用户要等 10-15 秒。Streaming 让 token 一边生成一边发送，TTFT 后用户立刻看到内容。

### Server-Sent Events（SSE）

LLM API 几乎都用 SSE 实现 streaming。SSE 是 HTTP 协议的一部分，服务端单向推送事件流。

```
Client:
  GET /v1/chat/completions
  Accept: text/event-stream

Server:
  HTTP/1.1 200 OK
  Content-Type: text/event-stream

  data: {"choices":[{"delta":{"content":"Hello"}}]}

  data: {"choices":[{"delta":{"content":" world"}}]}

  data: {"choices":[{"delta":{"content":"!"}}]}

  data: [DONE]
```

为什么选 SSE 而不是 WebSocket？
- **简单**：基于标准 HTTP，不需要额外的握手协议
- **单向足够**：LLM 场景是服务端单向推送，不需要双向通信
- **兼容性好**：所有 HTTP 客户端都支持，CDN/代理/负载均衡器天然支持
- **自动重连**：浏览器 EventSource API 内置重连机制

### 从推理引擎到用户的 Pipeline

```
推理引擎（vLLM/SGLang）         API Server          Client
  │                              │                   │
  │  生成 token_1               │                   │
  ├──────────────────────────────►                   │
  │                              │  SSE: token_1     │
  │                              ├───────────────────►
  │  生成 token_2               │                   │  用户看到 token_1
  ├──────────────────────────────►                   │
  │                              │  SSE: token_2     │
  │                              ├───────────────────►
  │  ...                         │                   │  用户看到 token_2
  │                              │                   │
  │  生成 token_n + EOS          │                   │
  ├──────────────────────────────►                   │
  │                              │  SSE: [DONE]      │
  │                              ├───────────────────►
```

关键实现细节：

1. **Detokenization**：模型输出的是 token ID，需要转成文本。但有些 token 不是完整字符（比如 UTF-8 多字节字符被拆成多个 token），需要缓冲和拼接
2. **背压控制**：如果客户端消费速度跟不上生成速度，需要控制发送频率
3. **取消请求**：用户关闭页面时，需要通知推理引擎停止生成，释放 GPU 资源

一个最简的 FastAPI streaming 实现：

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import asyncio
import json

app = FastAPI()

async def generate_stream(prompt: str):
    """模拟 LLM streaming 生成"""
    tokens = ["Hello", " ", "world", "!", " How", " can", " I", " help", "?"]
    for token in tokens:
        chunk = {
            "choices": [{
                "delta": {"content": token},
                "finish_reason": None
            }]
        }
        yield f"data: {json.dumps(chunk)}\n\n"
        await asyncio.sleep(0.05)  # 模拟生成延迟

    yield "data: [DONE]\n\n"

@app.post("/v1/chat/completions")
async def chat_completions(request: dict):
    prompt = request.get("messages", [{}])[-1].get("content", "")
    return StreamingResponse(
        generate_stream(prompt),
        media_type="text/event-stream"
    )
```

客户端用 OpenAI SDK 消费：

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:8000/v1',
  apiKey: 'not-needed',
});

const stream = await client.chat.completions.create({
  model: 'my-model',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);  // 逐字输出
}
```

---

**本章小结**

模型推理的完整链路：磁盘上的权重文件 → 加载到显存 → Prefill 处理输入 → Decode 逐 token 生成 → 采样选择 token → Streaming 发送给用户。每个环节都有优化空间，后续章节会逐一深入。理解 Prefill 和 Decode 的区别是最核心的知识点 —— 几乎所有推理引擎的优化都围绕这两个阶段展开。

> 示例代码：`examples/ch04-inference-basics/`
