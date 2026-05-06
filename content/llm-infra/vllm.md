# 第 5 章 vLLM：工业级推理引擎深度剖析

vLLM 目前是开源 LLM 推理引擎中部署最广泛的一个。从 2023 年 UC Berkeley 的一篇论文起步，到现在（截至 2026 年初为 v0.19+），已经是多数公司跑 LLM 服务的默认选择。这一章讲清楚它为什么快、怎么用、怎么调。

## 5.1 为什么需要专门的推理引擎

用 HuggingFace Transformers 的 `model.generate()` 跑推理，能用，但上不了生产。

### 朴素推理的问题

```python
# 最朴素的推理方式
from transformers import AutoModelForCausalLM, AutoTokenizer

model = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2-7B-Instruct")
tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2-7B-Instruct")

inputs = tokenizer("Hello", return_tensors="pt").to("cuda")
outputs = model.generate(**inputs, max_new_tokens=100)
```

看起来很简单，但有三个致命问题：

**1. KV Cache 显存浪费严重**

HF generate 为每个请求预分配最大长度的 KV Cache。如果 `max_length=4096`，即使实际只生成了 50 个 token，也占着 4096 个 token 的显存。对一个 7B 模型，一个请求的 KV Cache 在 4096 长度时约需 1 GB 显存。80 GB 的 A100 最多同时处理几十个请求。

**2. 静态 Batching 吞吐量低**

HF generate 用 static batching：一个 batch 里的所有请求必须等最长的那个生成完，才能开始下一个 batch。短请求被长请求拖累。

```
Static Batching:
请求 A: ████████████░░░░░░░░  (12 token, 等到 20 token 的位置才释放)
请求 B: ████████████████████  (20 token)
请求 C: ██████░░░░░░░░░░░░░░  (6 token, 浪费 14 个位置的计算)
         ────────────────────
         所有请求必须等 B 结束
```

**3. 无法高并发**

没有请求队列、没有异步调度、没有动态 batch。100 个并发请求打过来，要么 OOM，要么排队一个一个处理。

### 吞吐量差异

实测数据（Llama-3-8B，A100-80GB，输入 256 token，输出 256 token）：

| 方案 | 吞吐量 (requests/s) | 并发请求数 | 显存利用率 |
|------|---------------------|-----------|-----------|
| HF generate（batch=1） | ~2-3 | 1 | ~25% |
| HF generate（batch=8） | ~8-12 | 8 | ~60% |
| vLLM | ~40-60 | 256+ | ~90% |

vLLM 在高并发场景下的吞吐量是 HF generate 的 **5-15 倍**。

## 5.2 PagedAttention

这是 vLLM 的核心创新，来自 2023 年的论文《Efficient Memory Management for Large Language Model Serving with PagedAttention》。

### 传统 KV Cache 的问题

KV Cache 存储每一层、每个 attention head 的 Key 和 Value 向量。随着序列增长，KV Cache 线性增长。

传统方案的做法：为每个请求预分配一块连续的显存，大小等于 max_sequence_length。

```
GPU 显存:
┌────────────────────────────────────────────────────────┐
│ 请求 A 的 KV Cache [████████░░░░░░░░░░░░]  50% 浪费   │
│ 请求 B 的 KV Cache [██░░░░░░░░░░░░░░░░░░]  90% 浪费   │
│ 请求 C 的 KV Cache [████████████████░░░░]  20% 浪费   │
│ ░░░░░░░░░░░░░░░░░░░  无法分配新请求（碎片化）         │
└────────────────────────────────────────────────────────┘
```

实际测量：传统方案中 KV Cache 的有效利用率只有 20-40%。超过一半的显存被浪费在"预留但未使用"的空间上。

### 借鉴操作系统的虚拟内存

PagedAttention 的核心思想：**把 KV Cache 拆成固定大小的"页"（block），按需分配，不要求物理连续。**

```
逻辑视图（每个请求看到的连续 KV Cache）:
请求 A: [Block 0][Block 1][Block 2][Block 3]

物理视图（GPU 显存中的实际存储，不连续）:
┌──────────────────────────────────────────────┐
│ [A-B2] [B-B0] [A-B0] [C-B1] [A-B3] [B-B1]  │
│ [C-B0] [A-B1] [Free] [Free] [C-B2] [Free]   │
└──────────────────────────────────────────────┘

Block Table（逻辑块 → 物理块的映射）:
请求 A: {0→2, 1→7, 2→0, 3→4}
请求 B: {0→1, 1→5}
请求 C: {0→6, 1→3, 2→10}
```

每个 block 存储固定数量的 token（默认 16 个）的 KV 向量。新 token 生成时追加到最后一个 block，block 满了再分配新 block。

### 显存利用率提升

PagedAttention 带来的改进：

- **内部碎片**：只有最后一个 block 可能有未填满的空间，浪费 < 4%（传统方案浪费 60-80%）
- **外部碎片**：block 是固定大小的，没有外部碎片
- **有效利用率**：从 20-40% 提升到 **>96%**
- **并发量**：同样显存下能同时处理的请求数增加 2-4 倍

还有一个附带好处：**共享前缀的请求可以共享 block。** 比如 100 个请求用同一个 system prompt，这些请求的 KV Cache 前面部分指向相同的物理 block，只需要一份存储。这就是 Prefix Caching 的基础。

## 5.3 Continuous Batching

PagedAttention 解决显存问题，Continuous Batching 解决吞吐量问题。

### Static Batching 的浪费

```
时间 →
Static Batch 1:
  请求 A: ████████ (done)
  请求 B: ████████████████████ (done)
  请求 C: ████ (done, 但要等 B)
  ────────────────────── batch 结束，才能处理新请求

Static Batch 2:
  请求 D: ██████████████ (done)
  请求 E: ██ (done, 等 D)
```

请求 C 在第 4 步就生成完了，但 GPU 上它的"座位"空着，直到 B 生成完。

### Continuous Batching

请求完成后立刻退出 batch，空出的位置立刻被等待中的新请求填入。

```
时间 →
Step  1: [A][B][C]     ← 三个请求同时处理
Step  2: [A][B][C]
Step  3: [A][B][C]
Step  4: [A][B][D]     ← C 完成，D 立刻加入
Step  5: [A][B][D]
Step  6: [E][B][D]     ← A 完成，E 立刻加入
Step  7: [E][B][D]
Step  8: [E][F][D]     ← B 完成，F 立刻加入
...
```

GPU 始终在满负荷处理请求，没有"等待"的浪费。

实际效果：同样硬件下，Continuous Batching 相比 Static Batching 可以提升 **2-5x** 的吞吐量。长短请求混合的场景下差距更大。

vLLM 的调度器在每个 decode step 都会检查：
1. 有没有请求完成了？释放其 KV Cache block
2. 有没有等待中的请求？为其分配 block，加入 batch
3. 当前显存够不够？不够就 preempt（暂停）低优先级请求

## 5.4 部署实战

### 安装

```bash
# 推荐用 pip，需要 CUDA 12.1+
pip install vllm

# 验证安装
python -c "import vllm; print(vllm.__version__)"
```

vLLM 对环境要求：
- Python 3.9+
- CUDA 12.1+（推荐 12.4+）
- GPU 算力 7.0+（V100 及以上）
- 足够的 GPU 显存（模型大小 + KV Cache）

### 国内模型下载

国内直接从 HuggingFace 下载模型速度很慢，推荐两种方案：

**方案 1: HF 镜像**
```bash
export HF_ENDPOINT=https://hf-mirror.com
huggingface-cli download Qwen/Qwen2-7B --local-dir ./models/Qwen2-7B
```

**方案 2: ModelScope（阿里的模型平台）**
```bash
pip install modelscope
python -c "from modelscope import snapshot_download; snapshot_download('Qwen/Qwen2-7B', cache_dir='./models')"
```

下载完后启动 vLLM 时指向本地路径：
```bash
python -m vllm.entrypoints.openai.api_server --model ./models/Qwen2-7B
```

### 单卡部署 Qwen2-7B

```bash
# 启动 OpenAI 兼容的 API 服务
vllm serve Qwen/Qwen2-7B-Instruct \
    --host 0.0.0.0 \
    --port 8000 \
    --max-model-len 4096 \
    --gpu-memory-utilization 0.9
```

模型会自动从 Hugging Face 下载。首次启动需要几分钟，后续启动约 30-60 秒。

启动成功后：

```bash
# 测试
curl http://localhost:8000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
        "model": "Qwen/Qwen2-7B-Instruct",
        "messages": [{"role": "user", "content": "Hello!"}],
        "max_tokens": 100
    }'
```

### 多卡部署：Tensor Parallelism

模型太大放不进单卡？用 tensor parallelism 把模型切到多张卡上。

```bash
# 2 卡部署 —— 每张卡装一半模型
vllm serve Qwen/Qwen2-72B-Instruct \
    --tensor-parallel-size 2 \
    --max-model-len 4096 \
    --gpu-memory-utilization 0.9

# 4 卡部署
vllm serve Qwen/Qwen2-72B-Instruct \
    --tensor-parallel-size 4 \
    --max-model-len 8192

# 跨机器部署（8 卡 × 2 机器）
# TP=8（每机器内），PP=2（跨机器）
vllm serve deepseek-ai/DeepSeek-V3 \
    --tensor-parallel-size 8 \
    --pipeline-parallel-size 2
```

Tensor Parallelism 的经验法则：
- `tensor-parallel-size` 必须能整除模型的 attention head 数
- 通常设为单机 GPU 数量（2/4/8）
- 跨机器用 Pipeline Parallelism，因为 TP 需要高带宽的 NVLink

### 关键启动参数

```bash
vllm serve <model> \
    # 基础配置
    --host 0.0.0.0 \
    --port 8000 \
    --served-model-name my-model \        # API 中的模型名称
    --api-key sk-xxx \                    # 设置 API key

    # 性能参数
    --max-model-len 8192 \                # 最大上下文长度
    --gpu-memory-utilization 0.90 \       # GPU 显存利用率上限
    --max-num-seqs 256 \                  # 最大并发请求数
    --max-num-batched-tokens 8192 \       # 一次 prefill 的最大 token 数

    # 量化
    --quantization awq \                  # 使用 AWQ 量化模型
    --dtype auto \                        # 数据类型，auto 会自动选择

    # 并行
    --tensor-parallel-size 2 \            # Tensor 并行度
    --pipeline-parallel-size 1 \          # Pipeline 并行度

    # 高级优化
    --enable-prefix-caching \             # 开启 Prefix Caching
    --enable-chunked-prefill              # 开启 Chunked Prefill
```

## 5.5 性能调优

### gpu-memory-utilization

控制 vLLM 使用多少比例的 GPU 显存。默认 0.9（90%）。

```
GPU 显存分配:
┌──────────────────────────────────────┐
│  模型权重 (固定)              ~40%   │
├──────────────────────────────────────┤
│  KV Cache (动态)              ~50%   │  ← gpu-memory-utilization 控制的部分
├──────────────────────────────────────┤
│  预留 (CUDA context + 碎片)   ~10%   │
└──────────────────────────────────────┘
```

- `0.9`：默认值，适合大多数场景
- `0.95`：激进，显存紧张时可以尝试，但可能 OOM
- `0.7-0.8`：保守，适合同一张卡还要跑其他任务时

KV Cache 越大 → 能同时处理的请求越多 → 吞吐量越高。

### max-model-len

限制模型能处理的最大序列长度（输入 + 输出）。

```bash
# 模型原始支持 32768，但实际业务用不到那么长
# 降低 max-model-len 可以减少 KV Cache 预分配，腾出显存给更多并发
vllm serve Qwen/Qwen2-7B-Instruct --max-model-len 4096
```

设置策略：
- 分析实际请求的 token 长度分布，取 P99 作为 max-model-len
- 比如 99% 的请求都在 4096 token 以内，就设 4096 而不是默认的 32768
- 减少 max-model-len 从 32K 到 4K，同等显存下并发量可以提升 4-8 倍

### Prefix Caching

多个请求共享相同前缀时（相同的 system prompt），可以复用 KV Cache。

```bash
vllm serve Qwen/Qwen2-7B-Instruct --enable-prefix-caching
```

典型场景：
- 所有请求带同一个 system prompt（Agent 场景很常见）
- 多轮对话中前面的轮次相同
- RAG 场景中多个请求查询相同的文档片段

效果：对于有长 system prompt 的 Agent 应用，Prefix Caching 可以降低 TTFT 30-70%。

### Chunked Prefill

把长 prompt 的 prefill 拆成多个小块，和 decode 交替执行。避免一个超长 prefill 阻塞其他请求的 decode。

```bash
vllm serve Qwen/Qwen2-7B-Instruct --enable-chunked-prefill
```

在混合长短请求的场景下，Chunked Prefill 显著改善短请求的延迟，避免被长请求"卡住"。

## 5.6 OpenAI Compatible API

vLLM 提供完全兼容 OpenAI API 的接口，这意味着你已有的代码几乎不用改。

### 支持的接口

```
POST /v1/chat/completions    ← 对话补全
POST /v1/completions         ← 文本补全
POST /v1/embeddings          ← 文本嵌入
GET  /v1/models              ← 模型列表
```

### 直接替换 base_url

```python
from openai import OpenAI

# 原来调 OpenAI
# client = OpenAI(api_key="sk-xxx")

# 改成调 vLLM，只需要改 base_url
client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="not-needed",  # vLLM 默认不需要 key
)

response = client.chat.completions.create(
    model="Qwen/Qwen2-7B-Instruct",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain PagedAttention in 3 sentences."},
    ],
    temperature=0.7,
    max_tokens=200,
    stream=True,
)

for chunk in response:
    content = chunk.choices[0].delta.content
    if content:
        print(content, end="", flush=True)
```

### 对接 Agent 应用

对于用 OpenAI SDK 构建的 Agent 应用，切换到 vLLM 只需要：

```typescript
// TypeScript / Node.js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://your-vllm-server:8000/v1',
  apiKey: 'not-needed',
});

// 后面的代码完全不用改
const response = await client.chat.completions.create({
  model: 'Qwen/Qwen2-7B-Instruct',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

vLLM 支持的 OpenAI 兼容特性：
- `stream: true` — Streaming 输出
- `tools` — 函数调用 / 工具调用
- `response_format: { type: "json_object" }` — JSON 模式
- `logprobs` — 返回 token 的 log 概率
- `n` — 一次生成多个回复
- `stop` — 自定义停止词

不兼容的地方：
- `seed` 参数在分布式推理时不保证完全确定性
- 部分模型的 tool calling 格式可能与 OpenAI 有细微差异
- 不支持 OpenAI 特有的 `gpt-4-vision-preview` 等模型名

### Tool Calling

Agent 工程师最关心的功能。vLLM 支持 OpenAI 格式的 tool calling，前提是模型本身支持（Qwen2、Llama 3.1+ 等）：

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="na")

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定城市的天气信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名称"},
                },
                "required": ["city"],
            },
        },
    }
]

response = client.chat.completions.create(
    model="Qwen/Qwen2-7B-Instruct",
    messages=[{"role": "user", "content": "北京今天天气怎么样？"}],
    tools=tools,
    tool_choice="auto",
)

# 模型会返回 tool_calls
message = response.choices[0].message
if message.tool_calls:
    call = message.tool_calls[0]
    print(f"调用工具: {call.function.name}")
    print(f"参数: {call.function.arguments}")
```

启动 vLLM 时需要指定 tool calling 模式：

```bash
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2-7B-Instruct \
    --enable-auto-tool-choice \
    --tool-call-parser hermes
```

`--tool-call-parser` 的选择取决于模型。Qwen2 用 `hermes`，Llama 3.1 用 `llama3_json`。具体支持列表见 vLLM 文档。

---

**本章小结**

vLLM 通过 PagedAttention 解决显存碎片问题，通过 Continuous Batching 解决吞吐量问题，通过 OpenAI 兼容 API 解决接入成本问题。这三个特性是它成为行业标准的关键。生产部署时，最重要的调优参数是 `max-model-len`（根据实际业务设置）和 `enable-prefix-caching`（Agent 场景必开）。

> 示例代码：`examples/ch05-vllm/`
