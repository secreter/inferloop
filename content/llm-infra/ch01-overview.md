# 第 1 章 全景图：LLM 技术栈的分层

## 1.1 从 HTTP 请求到 Token 生成：一次 API 调用经历了什么

先从最熟悉的东西开始。下面这段代码，前端工程师闭着眼睛都能写：

```typescript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: '什么是 KV Cache？' }],
    stream: true,
  }),
});
```

一个标准的 POST 请求。但从你按下回车到第一个 token 出现在屏幕上，中间经历了至少 7 个阶段。实际延迟大约 300ms-2s（取决于模型和负载），拆开看每一步花了多长时间：

```
你的代码                    OpenAI 基础设施                              GPU 集群
───────                    ──────────────                              ────────

HTTP POST ──→ API Gateway ──→ Load Balancer ──→ 推理引擎 ──→ GPU Prefill ──→ GPU Decode
  ~20ms         ~5ms            ~5ms             ~10ms        ~200ms         ~30ms/token
                 │                │                 │             │              │
              认证计费         选择实例          Tokenize      计算 KV Cache   逐个生成 token
              限流降级         健康检查          拼装 prompt    首次 Attention   流式返回 SSE
              请求路由         队列调度          分配显存
```

**第 1 步：API Gateway（~5ms）**

请求先打到 API Gateway。干三件事：验证 API Key、检查 rate limit、记录用量用于计费。这和你写过的任何 SaaS 后端没区别——就是 middleware。OpenAI 用的方案未公开，但业界常见的是 Kong、Envoy 或自研网关。

**第 2 步：Load Balancer（~5ms）**

请求被路由到具体的推理集群。这里的 LB 逻辑比普通 Web 服务复杂：不能简单 round-robin，因为每张 GPU 卡上可能正在处理不同长度的请求，显存占用差异很大。调度器需要感知每张卡的显存余量和当前 batch 大小。

**第 3 步：推理引擎预处理（~10ms）**

请求到达具体的推理实例（运行 vLLM、TensorRT-LLM 或 OpenAI 自研引擎）。引擎做几件事：

1. 把你的 messages 按照 chat template 拼成完整 prompt
2. 用 Tokenizer 把文本切成 token 序列（"什么是 KV Cache？" 大约 8-12 个 token）
3. 在显存中分配 KV Cache 空间
4. 把这个请求加入当前 batch（continuous batching）

**第 4 步：Prefill（~200ms，长 prompt 更久）**

这是第一个真正吃 GPU 算力的阶段。所有输入 token 并行通过 Transformer 的每一层，计算出对应的 Key 和 Value 向量并缓存起来（KV Cache）。这一步是 **compute-bound**——GPU 的计算单元跑满，显存带宽还有富余。

Prefill 的耗时和输入长度成正比（准确说是 O(n^2)，因为 Attention 计算量随 sequence length 平方增长）。100 个 token 的输入可能只要 50ms，但 10000 个 token 的输入可能要 2 秒。

**第 5 步：Decode（~30ms/token）**

从这一步开始逐个生成 token。每次只处理 1 个新 token，但需要和之前所有 token 的 KV Cache 做 Attention 计算。这一步是 **memory-bound**——每生成一个 token 都要从显存读取整个 KV Cache，GPU 的计算单元大部分时间在等数据。

生成一个 token 大约 20-50ms（取决于模型大小和 batch size），生成 200 个 token 就是 4-10 秒。

**第 6 步：Streaming 返回**

每生成一个 token，推理引擎立刻通过 SSE（Server-Sent Events）把它推回去。你在前端用 `EventSource` 或手动解析 `ReadableStream` 拿到的就是这些 token。每个 SSE 事件长这样：

```
data: {"choices":[{"delta":{"content":"KV"},"index":0}]}

data: {"choices":[{"delta":{"content":" Cache"},"index":0}]}

data: {"choices":[{"delta":{"content":" 是"},"index":0}]}
```

这就是为什么 ChatGPT 的回复是"一个字一个字蹦出来的"——不是故意做的打字机效果，是真的在一个 token 一个 token 生成。

**延迟分布小结**

| 阶段 | 耗时 | 瓶颈 |
|------|------|------|
| 网络传输 | 20-100ms | 物理距离 |
| API Gateway | ~5ms | CPU |
| Load Balancer | ~5ms | 调度逻辑 |
| 推理引擎预处理 | ~10ms | CPU（Tokenize） |
| Prefill | 50-2000ms | GPU 算力 |
| Decode（每 token） | 20-50ms | GPU 显存带宽 |

对应用工程师来说，最直接的感受是两个指标：**TTFT**（Time To First Token，首 token 延迟）和 **TPS**（Tokens Per Second，生成速度）。TTFT 主要由 Prefill 决定，TPS 主要由 Decode 决定。

## 1.2 技术栈分层

整个 LLM 基础设施可以分成 5 层。从上到下，离用户越来越远，离硬件越来越近：

```
┌─────────────────────────────────────────────────────────┐
│                      应用层 (Application)                │
│   ChatBot / Copilot / RAG 应用 / Agent                  │
│   Next.js, Vercel AI SDK, Streamlit                     │
├─────────────────────────────────────────────────────────┤
│                      编排层 (Orchestration)              │
│   Prompt 管理 / Chain / Agent 框架 / Tool Calling        │
│   LangChain, LlamaIndex, Dify, Coze                    │
├─────────────────────────────────────────────────────────┤
│                      服务层 (Serving)                    │
│   推理引擎 / API Server / Batch 调度 / 负载均衡          │
│   vLLM, TensorRT-LLM, Triton, SGLang                   │
├─────────────────────────────────────────────────────────┤
│                      优化层 (Optimization)               │
│   量化 / 剪枝 / 蒸馏 / Attention 优化 / 并行策略         │
│   GPTQ, AWQ, FlashAttention, DeepSpeed, Megatron-LM    │
├─────────────────────────────────────────────────────────┤
│                      硬件层 (Hardware)                   │
│   GPU / 互联 / 存储 / 网络                               │
│   NVIDIA A100/H100/B200, NVLink, InfiniBand             │
└─────────────────────────────────────────────────────────┘
```

前端/全栈工程师通常在最上面两层工作。这本书的目标是带你理解中间三层——服务层、优化层和硬件层，因为这三层决定了你的应用的响应速度、成本和可靠性。

一个类比：你写过 Node.js Web 应用，知道 Express 是框架、V8 是引擎、libuv 是事件循环、Linux 是操作系统、CPU 是硬件。你不需要能写 V8，但你得知道 event loop 怎么工作才能写出高性能的代码。LLM 技术栈也一样——你不需要训练模型，但你得理解推理引擎的工作原理，才能做好 Agent 工程。

## 1.3 各层的核心职责、关键指标和代表项目

### 应用层

**职责：** 直接面向终端用户，把 LLM 能力包装成产品。处理 UI 交互、用户会话管理、结果展示。

**关键指标：**
- 端到端延迟（用户感知的等待时间）
- 可用性（SLA 99.9%+）
- 用户体验（流式输出的流畅度、错误处理）

**代表项目：**

| 项目 | 说明 |
|------|------|
| Vercel AI SDK | TypeScript-first 的 LLM 应用框架，streaming 支持极好 |
| Streamlit | Python 快速原型，适合 demo |
| Gradio | 类似 Streamlit，HuggingFace 生态 |
| Open WebUI | 开源 ChatGPT 替代前端 |

### 编排层

**职责：** 管理 Prompt、组织调用链路、实现 Tool Calling 和 Agent 逻辑。这层是 Agent 工程师的主战场。

**关键指标：**
- Prompt 命中率和质量（RAG 的 recall/precision）
- Agent 任务完成率
- Token 消耗成本
- 端到端 Chain 延迟

**代表项目：**

| 项目 | 说明 |
|------|------|
| LangChain | 最流行的 LLM 编排框架，生态大但抽象层多 |
| LlamaIndex | 专注 RAG 场景，数据索引能力强 |
| Dify | 开源 LLMOps 平台，可视化编排 |
| CrewAI | 多 Agent 协作框架 |
| Semantic Kernel | 微软的 LLM 编排框架 |

### 服务层

**职责：** 把训练好的模型跑起来，对外提供推理 API。处理请求调度、batch 管理、显存分配、模型加载。

**关键指标：**
- TTFT（Time To First Token）：首 token 延迟
- TPS（Tokens Per Second）：吞吐量
- QPS：每秒处理请求数
- GPU 利用率
- 每千 token 成本

**代表项目：**

| 项目 | 说明 |
|------|------|
| vLLM | 当前最流行的开源推理引擎，PagedAttention 显存管理 |
| TensorRT-LLM | NVIDIA 官方方案，性能最优但灵活性低 |
| SGLang | UC Berkeley 出品，RadixAttention，结构化生成性能好 |
| Triton Inference Server | NVIDIA 的模型服务框架，支持多种后端 |
| Ollama | 本地部署方案，开发者友好 |
| llama.cpp | C++ 实现，CPU 推理首选 |

### 优化层

**职责：** 让模型跑得更快、占用更少显存。不改变模型能力（或尽量少损失），但大幅提升推理效率。

**关键指标：**
- 压缩比（INT4 量化 = 模型体积缩小到原来的 1/4）
- 精度损失（量化后 benchmark 得分的下降幅度）
- 推理加速比
- 显存节省量

**代表项目：**

| 项目 | 说明 |
|------|------|
| FlashAttention | IO-aware 的 Attention 实现，减少 HBM 访问 |
| GPTQ | Post-training 量化，INT4/INT8 |
| AWQ | Activation-aware 量化，精度损失更小 |
| DeepSpeed | 微软的分布式训练/推理框架 |
| Megatron-LM | NVIDIA 的大规模并行训练框架 |
| bitsandbytes | 4-bit 量化库，QLoRA 的基础 |

### 硬件层

**职责：** 提供算力和存储。GPU 选型、集群网络拓扑、存储方案直接决定了上层能做什么。

**关键指标：**
- TFLOPS（算力）
- 显存容量和带宽（GB, GB/s）
- 卡间互联带宽（NVLink: 900GB/s on H100）
- 性价比（$/TFLOPS/hour）

**代表硬件：**

| 硬件 | FP16 TFLOPS | 显存 | 显存带宽 | 适用场景 |
|------|-------------|------|----------|----------|
| A100 80GB | 312 | 80GB HBM2e | 2.0 TB/s | 当前主力，性价比高 |
| H100 80GB | 990 | 80GB HBM3 | 3.35 TB/s | 新一代旗舰 |
| H200 | 990 | 141GB HBM3e | 4.8 TB/s | 大显存，长 context |
| B200 | 2250 | 192GB HBM3e | 8.0 TB/s | 最新一代，FP4 支持 |
| L40S | 366 | 48GB GDDR6X | 864 GB/s | 推理性价比之选 |

## 1.4 作为应用工程师，你已经具备的和需要补齐的

好消息是，你已经有不少直接可迁移的技能。

**你已有的（直接可用）：**

| 技能 | 在 LLM Infra 中的对应 |
|------|----------------------|
| HTTP/REST API 设计 | 推理服务的 API 协议（OpenAI 兼容格式） |
| SSE / WebSocket / Streaming | 流式推理输出，就是你熟悉的 SSE |
| JSON 解析和数据处理 | Structured Output、Tool Calling 的响应解析 |
| async/await 异步编程 | 推理请求的并发处理（Python 的 asyncio 和 Node 的 async 思路一样） |
| Docker / 容器化 | 推理服务部署，vLLM 就是跑在容器里 |
| 监控 / 可观测性 | GPU 监控用 Prometheus + Grafana，你肯定用过 |
| 负载均衡概念 | LLM serving 的请求调度，原理一样但策略不同 |

**你需要补齐的：**

| 技能 | 重要程度 | 本书覆盖 | 说明 |
|------|----------|----------|------|
| Python 基础 | 必须 | 贯穿全书 | LLM 生态 95% 是 Python，不会 Python 寸步难行 |
| PyTorch 基础 | 重要 | 第 2-3 章 | 不需要从头训练模型，但要能读懂模型代码 |
| GPU / CUDA 概念 | 重要 | 第 3 章 | 不需要写 CUDA，但要理解显存、算力、带宽的关系 |
| Transformer 架构 | 重要 | 第 2 章 | 知道数据怎么流过模型，才能理解各种优化 |
| 量化基础 | 实用 | 第 7 章 | INT8/INT4 量化直接影响部署成本 |
| 分布式计算概念 | 进阶 | 第 11 章 | Tensor Parallel、Pipeline Parallel |
| Linux 系统编程 | 有帮助 | 零散涉及 | 排查 GPU 驱动、CUDA 版本问题时需要 |

**一个实际的学习路径建议：**

```
Week 1-2: Python 基础 + PyTorch Tensor 操作
           ↓
Week 3-4: 读本书第 2-3 章，理解 Transformer 和 GPU 基础
           ↓
Week 5-6: 本地部署一个 7B 模型（用 Ollama 或 vLLM）
           ↓
Week 7-8: 读本书第 7-8 章，理解量化和推理优化
           ↓
Week 9+:  尝试用 vLLM 搭建自己的推理服务
```

说白了，做 LLM 工程得换一套思路：前端工程师习惯"CPU 够用、内存便宜、网络是瓶颈"，但到了 LLM 这边，现实是"GPU 极贵、显存极紧、计算是瓶颈"。资源约束完全不同，这会改变你做技术决策的方式。

一个具体例子：在前端，你可能不会纠结一个 JSON 对象占了 1MB 内存。但在 LLM 推理中，一个 batch 里多一个 2048 长度的请求，KV Cache 就多占约 512MB 显存（Llama 2 7B，FP16）。这种量级的差异会贯穿整本书。

---

**延伸阅读：**

- [Chip Huyen - Building LLM applications for production](https://huyenchip.com/2023/04/11/llm-engineering.html)
- [vLLM Blog - 官方技术博客](https://blog.vllm.ai/)
- [NVIDIA H100 Datasheet](https://www.nvidia.com/en-us/data-center/h100/)
