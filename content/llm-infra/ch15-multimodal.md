# 第 15 章 多模态模型的基础设施

前面十四章我们一直在跟文本打交道。但现实世界不只有文字——用户会发图片问"这是什么虫子"，会丢一段语音让 Agent 帮忙翻译，甚至会传一段视频让模型做摘要。2025 年以来，多模态能力已经从"锦上添花"变成了"生产刚需"。

这一章我们聊聊：当模型不再只吃文本的时候，Infra 层面到底多了哪些麻烦事。

## 15.1 Vision-Language 模型的推理

### VLM 的基本架构

Vision-Language Model (VLM) 的核心思路出奇地简单：把一个 Vision Encoder 和一个 LLM 拼在一起。图片经过 Vision Encoder（通常是 ViT 变体）变成一组 visual tokens，然后和文本 tokens 一起送进 LLM 做自回归生成。

典型的架构长这样：

```
Image → Vision Encoder (ViT) → Projection Layer → Visual Tokens
                                                        ↓
Text Prompt → Tokenizer → Text Tokens → [Visual Tokens + Text Tokens] → LLM → Output
```

不同的模型在"怎么把图片信息塞进 LLM"这件事上各有各的做法：

- **LLaVA** 系列：用一个简单的 MLP 做 projection，把 ViT 输出投影到 LLM 的 embedding 空间。优点是架构简洁，训练成本低。
- **Qwen-VL / Qwen2.5-VL**：阿里的方案，支持动态分辨率输入。Qwen2.5-VL 在 A100 上用 vLLM 跑图片推理能做到约 20.89 req/s（concurrency=50, 7B 模型），视频则降到 7.35 req/s。
- **InternVL 系列**：上海 AI Lab 的开源 VLM，InternVL3.5 在多个 benchmark 上表现强劲（MMVet 76.6, MMStar 65.0）。小模型 InternVL3.5-2B 在吞吐和延迟上表现出色，适合对性能敏感的场景。

### 图片预处理：分辨率和 patch 数量

VLM 推理中，一个经常被忽视但影响巨大的因素是图片预处理。

ViT 会把图片切成固定大小的 patch（通常是 14×14 或 16×16 像素），每个 patch 变成一个 token。一张 224×224 的图片会产生 256 个 visual tokens，而 448×448 就变成 1024 个。

这意味着什么？

- **分辨率翻倍，token 数量翻四倍**。一张 1344×1344 的高分辨率图片可能产生 9216 个 visual tokens，比一整段文本 prompt 还长。
- **显存占用和计算量随 token 数二次增长**（因为 attention 是 O(n²)）。
- 实际生产中，你会看到图片请求的 TTFT（Time To First Token）比纯文本请求高 3-10 倍。

动态分辨率是当前的主流方案。Qwen2.5-VL 支持将图片按原始比例切分成多个 tile，每个 tile 独立编码，避免了强制 resize 导致的信息损失。但 tile 越多，token 越多，计算越贵。

**实际建议**：在生产环境中，对用户上传的图片做预处理——限制最大分辨率（比如长边不超过 1344），在清晰度和推理成本之间找平衡。

### vLLM 对 VLM 的支持

vLLM 从 2024 年底开始逐步支持多模态模型，到 2025 年的 V1 版本已经相当成熟。几个关键能力：

1. **Encoder Cache**：Visual encoder 的输出会缓存在 GPU 上。如果同一张图片在多个请求中出现（比如同一张图的不同问题），不需要重复编码。
2. **Encoder-aware Scheduler**：调度器知道每个请求里多模态 embedding 的位置，能更好地管理显存。
3. **支持的模型列表不断扩大**：LLaVA、Qwen-VL、InternVL、Phi-3-Vision、Pixtral 等主流 VLM 都已支持。

用 vLLM 跑 VLM 推理的基本方式：

```python
from vllm import LLM, SamplingParams

llm = LLM(
    model="Qwen/Qwen2.5-VL-7B-Instruct",
    trust_remote_code=True,
    max_model_len=4096,
    gpu_memory_utilization=0.9,
)

# 图片通过 multi_modal_data 传入
outputs = llm.generate(
    [{
        "prompt": "<|im_start|>user\n<image>\n这张图片里有什么？<|im_end|>\n<|im_start|>assistant\n",
        "multi_modal_data": {"image": image},
    }],
    sampling_params=SamplingParams(max_tokens=256, temperature=0.7),
)
```

2025 年 11 月，vLLM 社区还发布了 **vLLM-Omni**，专门支持全模态模型推理——不只输入多模态，输出也可以是图片、音频。它把 vLLM 的高效显存管理扩展到了 Diffusion Transformer 等非自回归模型上。

### 与纯文本 LLM 推理的性能差异

来看一组实际数据（A100 40GB, vLLM, concurrency=50）：

| 模型 | 图片 req/s | 视频 req/s | 纯文本 req/s（估算） |
|------|-----------|-----------|-------------------|
| Qwen2.5-VL-7B | 20.89 | 7.35 | ~45-60 |
| InternVL3.5-4B | 更高 | - | ~70-90 |
| InternVL3.5-2B | 最高 | - | ~100+ |

几个值得注意的点：

1. **视频推理吞吐大幅低于图片**，因为视频会采样多帧，每帧都要编码。
2. **TTFT 显著增加**：纯文本的 TTFT 通常在 50-200ms，VLM 的图片请求可能到 500ms-2s。
3. **显存使用更不可预测**：文本请求的 token 数相对稳定，但一张高分辨率图片可能突然吃掉几个 GB 的显存。

这对 Infra 意味着什么？你的 auto-scaler 和请求限流策略需要考虑模态差异。不能简单地用"每秒请求数"来限流，得按"每秒 token 数"或"每秒计算量"来算。

## 15.2 语音模型的服务化

### Whisper：语音识别的工业标准

OpenAI 的 Whisper 模型几乎统治了开源语音识别领域。Whisper large-v3 有 1.55B 参数，支持 100+ 种语言，在大多数语言上的 Word Error Rate (WER) 都能做到很低。

但原始的 Whisper 推理非常慢。一段 30 秒的音频，用 large-v3 在 A100 上推理需要约 3-5 秒。这对离线转录还行，但对实时场景完全不够用。

**faster-whisper** 是目前生产环境的首选方案。它用 CTranslate2 引擎重新实现了 Whisper，相比原版：

- 推理速度快 4 倍
- 显存占用更低
- 支持 int8/float16 量化
- API 兼容原版 Whisper

用 faster-whisper 部署一个语音识别服务：

```python
from faster_whisper import WhisperModel

model = WhisperModel("large-v3", device="cuda", compute_type="float16")

# 转录一段音频
segments, info = model.transcribe("audio.wav", beam_size=5)
for segment in segments:
    print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
```

**生产部署的关键参数**：

- `compute_type`：float16 是速度和精度的最佳平衡点，int8 可以进一步省显存但可能有精度损失
- `beam_size`：beam_size=5 是默认值，设为 1 可以快 30% 但精度下降
- `vad_filter`：开启 VAD（Voice Activity Detection）过滤，自动跳过静音段，对长音频效果显著

Whisper large-v3 turbo 是 2024 年底发布的精简版，参数量更小但速度快很多，适合对延迟敏感的场景。有团队报告在优化后实现了亚秒级延迟。

### TTS 模型：语音合成的部署

语音合成（Text-to-Speech）这几年进步巨大。从早参数的拼接合成到现在的神经网络 TTS，合成质量已经接近真人。

当前主流的开源 TTS 方案：

- **VITS / VITS2**：端到端的 TTS 模型，推理速度快，适合实时场景
- **CosyVoice**（阿里）：支持中英文，音色克隆效果好
- **ChatTTS**：专为对话场景优化，支持韵律控制
- **Fish Speech**：开源社区的新秀，支持多语言和音色克隆

TTS 部署的核心指标是 **Real-Time Factor (RTF)**：合成 1 秒音频需要多少秒计算时间。RTF < 1 意味着能实时合成，RTF < 0.3 才算舒适。

### 实时语音对话的架构

实时语音对话是 2025 年最热门的应用场景之一。经典的架构是三段式 pipeline：

```
用户语音 → STT（语音识别）→ LLM（文本生成）→ TTS（语音合成）→ 播放给用户
```

每一段都有延迟，累加起来就是用户感知到的响应时间。人类对话的自然响应窗口是 300-500ms，超过 1 秒就会觉得"卡"。

一个典型的延迟预算（2025-2026 年优化后的目标）：

| 环节 | 目标延迟 | 说明 |
|------|---------|------|
| VAD + 音频采集 | ~50ms | 检测用户是否说完 |
| STT 转录 | ~150ms | Streaming STT，不等说完就开始转 |
| LLM TTFT | ~400ms | 第一个 token 的生成时间 |
| TTS 首个音频块 | ~150ms | 流式合成，不等全部文本就开始 |
| 网络开销 | ~50ms | 各环节间的传输 |
| **总计** | **~800ms** | 还是偏高，但可接受 |

**关键优化手段**：

1. **全链路流式处理**：STT 输出 partial transcript 就送给 LLM，LLM 输出几个 token 就送给 TTS。不要等任何一个环节完全结束。
2. **Streaming STT**：用 WebSocket 持续发送音频片段，实时返回部分转录结果。可以比等用户说完快 200-400ms。
3. **投机执行**：根据部分转录预测可能的回复，提前开始生成。用户说"帮我查一下明天北京的..."，不用等后面就可以开始准备天气查询。
4. **端到端语音模型**：跳过 STT→LLM→TTS 的三段式 pipeline，直接做 Speech-to-Speech。OpenAI 的 GPT-4o 语音模式、开源的 Ultravox 和 Moshi 都在走这条路，延迟可以压到 200-300ms。

端到端模型是未来趋势，但目前三段式 pipeline 在可控性和调试便利性上仍有优势——你可以单独升级任何一个环节。

## 15.3 多模态 Agent 的 Infra 挑战

当 Agent 需要同时处理图片、语音、视频和文本时，Infra 的复杂度会指数级上升。

### 多模态输入的预处理 pipeline

一个多模态 Agent 收到一个请求，可能包含：
- 一段文本指令
- 两张图片
- 一段 30 秒的语音

这些需要不同的预处理：

```python
# 伪代码：多模态预处理 pipeline
async def preprocess(request):
    tasks = []

    if request.images:
        # 图片：resize、归一化、转 tensor
        tasks.append(process_images(request.images, max_resolution=1344))

    if request.audio:
        # 音频：重采样到 16kHz、转文本（STT）
        tasks.append(transcribe_audio(request.audio))

    if request.video:
        # 视频：抽帧、每帧做图片预处理
        tasks.append(extract_and_process_frames(request.video, fps=1))

    # 并行执行所有预处理
    results = await asyncio.gather(*tasks)
    return merge_results(results, request.text)
```

关键设计原则：**各模态的预处理应该并行执行**。图片 resize 和音频 STT 之间没有依赖关系，串行处理是浪费。

### 不同模态的延迟差异

各模态的预处理延迟差异巨大：

| 模态 | 预处理延迟 | 生成的 token 数 |
|------|-----------|---------------|
| 文本 (500 字) | <10ms | ~500 tokens |
| 图片 (1344×1344) | 50-200ms | ~1000-9000 tokens |
| 音频 (30s) | 500ms-3s | ~100 tokens (转文本后) |
| 视频 (10s, 1fps) | 1-5s | ~10000+ tokens |

这种差异决定了你不能用统一的 timeout 和 rate limit 策略。一个包含视频的请求可能需要 10 秒预处理，而纯文本请求只需要几毫秒。

**实际做法**：按模态分配不同的请求队列和超时策略。轻量请求（纯文本）走快速通道，重量请求（视频）走独立队列，避免互相阻塞。

### 显存管理：图片 token 的显存开销

VLM 推理中最容易踩坑的就是显存管理。

一个请求带一张 1344×1344 的图片，可能产生 9000+ 个 visual tokens。在 7B 模型中，每个 token 在 KV Cache 中占用约 0.5MB（取决于模型结构和精度），9000 个 token 就是 4.5GB。单个请求就可能吃掉半张 A100 的显存。

vLLM 的 PagedAttention 在这种场景下尤为重要——它能按 page 粒度管理 KV Cache，避免预分配整块显存。但即使如此，你也需要：

1. **限制单个请求的最大 token 数**（包括 visual tokens）
2. **动态调整 batch size**：有图片请求时减少 batch 中的请求数
3. **提前计算 visual token 数量**：在请求进入推理引擎前就知道它会占多少显存，避免 OOM

### 多模态 Embedding 和检索

RAG 系统遇到多模态就更有意思了。传统的 text embedding 模型只能处理文本，但现在你的知识库可能包含图片、图表、PDF 扫描件。

当前的多模态 embedding 方案：

- **CLIP 系列**：OpenAI 的 CLIP、开源的 SigLIP 等，可以同时编码图片和文本到同一向量空间
- **ColPali / ColQwen**：专门为文档检索设计的多模态 embedding 模型，能直接对 PDF 页面做 embedding，不需要 OCR
- **BGE-Visualized**：BAAI 的多模态 embedding 模型，支持图文混合检索

多模态检索的 Infra 注意点：

1. **向量维度更高**：多模态 embedding 通常是 768-1024 维，比 text embedding 的 384 维大不少，存储和检索成本都更高
2. **索引构建更慢**：图片 embedding 需要 GPU 计算，建索引的速度比纯文本慢 10-100 倍
3. **查询也更贵**：如果查询本身包含图片，也需要 GPU 做 encoding

实际架构中，多模态 embedding 服务通常独立部署，和推理服务分开。这样可以独立伸缩——embedding 计算是批量型的，适合用大 batch 提高 GPU 利用率。

---

## 小结

多模态推理给 Infra 带来的挑战，本质上是**输入的不确定性大幅增加**。纯文本时代，一个请求的 token 数大概在几百到几千之间，相对可预测。多模态之后，一张高分辨率图片就可能带来上万个 token，一段视频更是难以预测。

这要求我们在调度、显存管理、限流和扩缩容策略上都做出相应调整。好消息是，vLLM 等框架已经在快速跟进，很多底层的复杂性正在被抽象掉。但理解这些机制，在出问题时才能快速定位和解决。

下一章，我们换一个完全不同的话题——聊聊作为 Agent 开发者，如何规划自己向 Infra 工程师转型的路径。

## 代码示例

| 示例 | 说明 | 硬件要求 |
|------|------|---------|
| [01_vlm_inference.py](../../examples/ch15-multimodal/01_vlm_inference.py) | VLM 图片推理示例 | GPU (any) |
| [02_whisper_server.py](../../examples/ch15-multimodal/02_whisper_server.py) | Whisper 语音识别服务 | GPU (any) |
| [03_multimodal_pipeline.py](../../examples/ch15-multimodal/03_multimodal_pipeline.py) | 多模态预处理 pipeline | GPU (any) |
