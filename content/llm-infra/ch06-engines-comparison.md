# 第 6 章 推理引擎对比与选型

vLLM 不是唯一选择。不同场景、不同硬件、不同需求下，最优解不同。这一章把市面上主要的推理引擎都过一遍，给出选型建议。

## 6.1 TensorRT-LLM

NVIDIA 的亲儿子。如果你全是 NVIDIA GPU 且追求极致性能，它是性能天花板。

### 核心思路：编译优化

TensorRT-LLM 不是直接执行 PyTorch 模型，而是把模型编译成高度优化的 CUDA kernel。类似 C++ 代码编译成机器码，运行时没有解释开销。

```
PyTorch 模型
    │
    ▼
TensorRT-LLM 编译
    │  - 算子融合（多个小算子合成一个大 kernel）
    │  - 精度优化（FP8 / NVFP4 自动混合精度）
    │  - 内存优化（减少中间结果的显存占用）
    ▼
TensorRT Engine（二进制文件）
    │
    ▼
高效推理（比 vLLM 快 10-30%）
```

### 关键特性

- **FP8 / NVFP4 量化**：Hopper 架构（H100/H200）支持硬件级 FP8，Blackwell 架构支持 NVFP4。几乎无质量损失，推理速度翻倍
- **Speculative Decoding**：支持 EAGLE-3 等先进的投机解码算法，吞吐量提升可达 3.6x
- **In-flight Batching**：TensorRT-LLM 版本的 Continuous Batching
- **KV Cache 复用**：类似 vLLM 的 Prefix Caching

### 性能数字

Llama-3.1-8B 在 H100 上的 benchmark（batch size 3840）：
- 吞吐量：~11,000 tokens/s
- TPOT：~7.3ms
- 比 vLLM 快 10-30%（具体取决于模型和配置）

### 痛点

1. **只支持 NVIDIA GPU**：AMD、Intel、Apple Silicon 全部不行
2. **编译过程复杂**：模型需要先转换成 TensorRT 格式，编译可能花几十分钟到几小时
3. **版本迭代慢**：新模型架构支持通常比 vLLM 晚几周
4. **生态封闭**：与 NVIDIA 的 Triton Inference Server 深度绑定

### 适用场景

大规模 GPU 集群、追求极致性能、有专人维护 infra 的团队。不适合快速迭代和开发调试。

## 6.2 SGLang

UC Berkeley LMSYS 团队（也是 vLLM 的源头团队的同事）的作品。定位：比 vLLM 更适合 Agent 和结构化生成的场景。

### RadixAttention

SGLang 的核心创新。用 Radix Tree（基数树）管理 KV Cache 的前缀复用。

```
Radix Tree 示例:

                    [system prompt]
                    /              \
          [用户问题 A]           [用户问题 B]
          /         \                 |
    [追问 A1]   [追问 A2]       [追问 B1]
```

与 vLLM 的 Prefix Caching 的区别：
- vLLM 的 Prefix Caching 基于精确的 hash 匹配，前缀必须完全相同
- RadixAttention 用树结构管理，自动发现和复用最长公共前缀
- 多轮对话场景下，RadixAttention 的缓存命中率更高（75-95%）

实际效果：对于 Agent 场景（固定 system prompt + tools 定义 + 多轮调用），TTFT 降低 30-60%。

### 结构化生成（JSON Mode）

Agent 经常需要模型输出结构化 JSON。SGLang 在这方面做了深度优化。

```python
import sglang as sgl

@sgl.function
def extract_info(s, text):
    s += "Extract information from: " + text + "\n"
    s += "Output JSON:\n"
    s += sgl.gen("result",
                 regex=r'\{"name": "[^"]+", "age": \d+\}')
```

SGLang 的结构化生成比 vLLM 的 `guided_decoding` 快得多，原因是它在 token 级别做了约束传播优化，不需要在每一步都重新计算整个正则表达式的状态。

### 与 vLLM 的性能对比

SGLang 在以下场景通常比 vLLM 更快：
- 多轮对话（RadixAttention 的优势）
- 结构化输出（JSON/正则约束）
- 高前缀重叠率的工作负载

vLLM 的优势：
- 生态更成熟，社区更大
- 模型支持范围更广
- 文档和教程更完善
- 企业级支持更完善

### 部署

```bash
# 安装
pip install sglang[all]

# 启动服务（同样兼容 OpenAI API）
python -m sglang.launch_server \
    --model-path Qwen/Qwen2-7B-Instruct \
    --port 8000 \
    --tp 1
```

SGLang 同样提供 OpenAI 兼容的 API，切换成本很低。

## 6.3 Ollama / llama.cpp

本地推理的事实标准。开发调试用 Ollama，搞清楚底层用 llama.cpp。

### llama.cpp

Georgi Gerganov 在 2023 年 3 月用纯 C/C++ 实现的 LLM 推理库。一个人开始的项目，现在是最活跃的开源 LLM 项目之一。

技术特点：

1. **纯 C/C++**：无 Python 依赖，编译后一个二进制文件搞定。极致的可移植性
2. **CPU 推理优化**：AVX2/AVX-512/ARM NEON 等 SIMD 指令集优化，CPU 上也能跑得动
3. **GGUF 格式**：原生量化支持，Q4_K_M 量化下 7B 模型只需 ~4GB 内存
4. **GPU 加速**：支持 CUDA、Metal（Apple Silicon）、Vulkan、SYCL（Intel）
5. **跨平台**：Linux、macOS、Windows、Android、iOS、ChromeOS

一个 7B 模型在不同硬件上的 decode 速度（Q4_K_M 量化）：

| 硬件 | TPS | 备注 |
|------|-----|------|
| M2 Max (GPU) | ~80 | Metal 加速 |
| M2 Max (CPU) | ~25 | 纯 CPU |
| RTX 4090 | ~120 | CUDA |
| RTX 3060 12GB | ~55 | CUDA |
| i9-13900K (CPU) | ~15 | AVX2 |
| Raspberry Pi 5 | ~2-3 | ARM NEON |

llama.cpp 也提供了 server 模式，兼容 OpenAI API：

```bash
# 编译
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp && cmake -B build && cmake --build build --config Release

# 启动 server
./build/bin/llama-server \
    -m models/qwen2-7b-instruct-q4_k_m.gguf \
    --host 0.0.0.0 \
    --port 8080 \
    -ngl 99    # 所有层放 GPU
```

### Ollama

llama.cpp 的用户友好封装。把"下载模型 + 量化 + 配置 + 运行"简化成一条命令。

```bash
# 安装（macOS/Linux）
curl -fsSL https://ollama.com/install.sh | sh

# 运行模型（自动下载 + 启动）
ollama run qwen2:7b

# 作为 API 服务（自动启动后台服务）
curl http://localhost:11434/api/chat -d '{
    "model": "qwen2:7b",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
}'
```

Ollama 的最新特性（2025-2026）：
- **桌面应用**：macOS、Windows 原生 GUI，支持拖拽 PDF/图片
- **MLX 加速**：Apple Silicon 上 prompt 处理速度提升 1.6x，生成速度提升约 2x
- **Thinking Mode**：支持推理模型的思考链可见性控制
- **结构化输出**：JSON Schema 支持
- **工具调用**：Streaming 中的实时函数调用

Ollama 还兼容 OpenAI API（`/v1/chat/completions`），可以直接用 OpenAI SDK 调用。

### 适用场景

- **开发调试**：本地跑个小模型测 prompt、测 Agent 逻辑，不需要 GPU 服务器
- **个人使用**：Mac 上跑 7B 模型做日常助手，体验很好
- **边缘部署**：嵌入式设备、手机、离线场景
- **CI/CD 测试**：在 CPU-only 的 CI 环境中做模型相关的集成测试

**不适合**：高并发的线上服务。Ollama 的并发能力和吞吐量远不如 vLLM/SGLang。

## 6.4 MLC-LLM

机器学习编译（Machine Learning Compilation）方案，陈天奇团队的作品。

### 核心思路

用 Apache TVM 编译器把模型编译到不同后端：CUDA、Metal、Vulkan、WebGPU、OpenCL。一次编译，多端运行。

```
PyTorch / HuggingFace 模型
        │
        ▼
   MLC-LLM 编译
        │
   ┌────┼────┬────────┬──────────┐
   ▼    ▼    ▼        ▼          ▼
 CUDA  Metal Vulkan  WebGPU   OpenCL
 (PC)  (Mac) (跨平台) (浏览器)  (移动端)
```

### 跨平台部署

- **iOS / Android**：编译成原生库，集成到 App 中。配合 React Native 可以用 JS API 调用
- **浏览器**：WebLLM 项目，通过 WebGPU 在浏览器中运行 LLM，无需服务器
- **嵌入式**：支持各种 ARM 设备

### 实际表现

MLC-LLM 的性能通常介于 llama.cpp 和 vLLM 之间。在特定硬件（如 Apple Silicon）上，MLC 的编译优化可以比 llama.cpp 快 10-20%。

WebLLM 在浏览器中的表现（Chrome + WebGPU）：
- Llama-3-8B-Q4：~25-35 tokens/s（高端 GPU）
- Phi-3-mini-Q4：~40-50 tokens/s

### 适用场景

- 需要在浏览器中运行 LLM（隐私敏感场景）
- 移动端原生 LLM 集成
- 跨平台统一部署
- 对 TVM 编译栈有经验的团队

### 局限

- 编译过程复杂，文档有限
- 社区比 vLLM/llama.cpp 小得多
- 新模型支持速度较慢
- 生产级部署案例较少

## 6.5 HuggingFace TGI

HuggingFace 官方的推理引擎 [Text Generation Inference](https://github.com/huggingface/text-generation-inference)，Rust 实现。和 HF 生态深度集成，支持 FlashAttention、Continuous Batching、量化模型。如果你的工作流重度依赖 HuggingFace（模型托管、Inference Endpoints），TGI 是最无缝的选择。性能介于 vLLM 和朴素推理之间，社区活跃度不如 vLLM 和 SGLang。

## 6.6 选型指南

### 对比大表

| 特性 | vLLM | TensorRT-LLM | SGLang | llama.cpp/Ollama | MLC-LLM | TGI |
|------|------|---------------|--------|-----------------|---------|-----|
| **性能** | ★★★★ | ★★★★★ | ★★★★ | ★★★ | ★★★ | ★★★½ |
| **易用性** | ★★★★ | ★★ | ★★★★ | ★★★★★ | ★★ | ★★★★ |
| **模型支持** | ★★★★★ | ★★★ | ★★★★ | ★★★★ | ★★★ | ★★★★ |
| **GPU 支持** | NVIDIA, AMD | NVIDIA only | NVIDIA, AMD | NVIDIA, AMD, Apple, Intel | 全平台 | NVIDIA, AMD |
| **CPU 推理** | 有限 | 不支持 | 有限 | 优秀 | 有限 | 不支持 |
| **量化** | AWQ, GPTQ, FP8 | FP8, NVFP4, INT4/8 | AWQ, GPTQ, FP8 | GGUF 2-8bit | Q4, Q8 | AWQ, GPTQ, BnB |
| **OpenAI API** | 原生支持 | 通过 Triton | 原生支持 | 原生支持 | 有限 | 兼容 |
| **Streaming** | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| **结构化输出** | 支持 | 有限 | 优秀 | 支持 | 有限 | 支持 |
| **多模态** | 支持 | 支持 | 支持 | 支持 | 有限 | 支持 |
| **社区活跃度** | 极高 | 中等 | 高 | 极高 | 中等 | 中等偏高 |
| **适合团队** | 通用 | 大厂 infra 团队 | Agent 开发者 | 个人/小团队 | 跨平台开发者 | HF 生态用户 |
| **最新版本（截至 2026 年初）** | v0.19+ | v1.0+ | v0.5+ | 持续更新 | v0.1+ | v3.x+ |

### 决策树

```
你的场景是什么？
│
├─ 线上服务（高并发）
│  │
│  ├─ 只有 NVIDIA GPU，追求极致性能
│  │  └─ → TensorRT-LLM
│  │
│  ├─ Agent 场景，大量结构化输出
│  │  └─ → SGLang
│  │
│  └─ 通用场景，需要稳定可靠
│     └─ → vLLM（推荐默认选择）
│
├─ 本地开发/调试
│  │
│  ├─ 快速上手，不想折腾
│  │  └─ → Ollama
│  │
│  └─ 需要定制，了解底层
│     └─ → llama.cpp
│
├─ 边缘/移动端部署
│  │
│  ├─ 手机 App 内嵌 LLM
│  │  └─ → MLC-LLM
│  │
│  ├─ 浏览器端运行
│  │  └─ → WebLLM (MLC)
│  │
│  └─ 嵌入式/IoT
│     └─ → llama.cpp
│
└─ 研究/实验
   └─ → vLLM 或 SGLang（看具体方向）
```

### 实际建议

**大多数团队的最优路径：**

1. **开发阶段**：用 Ollama 在本地跑模型，快速迭代 prompt 和 Agent 逻辑
2. **测试阶段**：用 vLLM 在 GPU 服务器上跑，验证性能和正确性
3. **生产阶段**：vLLM 或 SGLang，根据具体场景选择

**几个具体判断点：**

- 如果你的 Agent 有长 system prompt + 大量工具定义（>2000 token），SGLang 的 RadixAttention 会比 vLLM 的 Prefix Caching 更有优势
- 如果你需要严格的 JSON Schema 输出，SGLang 的结构化生成性能明显更好
- 如果你用 NVIDIA H100/H200 且有专人运维，TensorRT-LLM 的性能值得那些额外的复杂度
- 如果你的用户在端侧（手机/桌面），Ollama 是最省心的分发方案

**避坑提示：**

- 不要在 CPU 上用 vLLM。vLLM 的 CPU 支持是实验性的，性能远不如 llama.cpp
- 不要在单卡上用过大的 tensor-parallel-size。TP=1 时无通信开销，很多时候单卡跑满比 2 卡分拆更快
- 不要忽视 Ollama 的局限性。它适合开发和个人使用，但不要用它扛生产流量
- TensorRT-LLM 的模型转换可能失败或产生精度问题，务必做好回归测试

---

**本章小结**

没有银弹。vLLM 是默认选择，SGLang 在 Agent 场景有优势，TensorRT-LLM 是性能天花板但门槛高，Ollama/llama.cpp 是本地推理标配，MLC-LLM 解决跨平台问题。根据你的实际场景选择，不要过度追求性能而忽视了开发效率和运维复杂度。

> 示例代码：`examples/ch06-engines-comparison/`
