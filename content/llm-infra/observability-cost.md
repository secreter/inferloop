# 第 13 章 可观测性与成本优化

LLM 服务跑起来之后，两个问题会接踵而至：「它到底跑得怎么样」和「太贵了怎么降本」。这两个问题互为因果——你得先看清楚资源花在哪了，才能有的放矢地优化。

## 13.1 关键指标

LLM 推理服务的指标体系跟传统 Web 服务有本质区别。传统服务关注 QPS 和 P99 延迟，LLM 服务需要更细粒度的指标。

### TTFT — Time to First Token

用户体感延迟的核心指标。从发出请求到收到第一个 token 的时间。

TTFT 主要由 prefill 阶段决定：模型需要先处理完所有 input tokens，才能开始生成。所以 TTFT 跟输入长度正相关：

| 输入长度 | A10 (7B) TTFT | A100 (72B) TTFT |
|----------|---------------|-----------------|
| 100 tokens | ~80ms | ~200ms |
| 1K tokens | ~200ms | ~500ms |
| 8K tokens | ~800ms | ~2s |
| 32K tokens | ~3s | ~8s |

用户能接受的 TTFT 一般在 1-2 秒以内。超过 3 秒就会明显感到「卡顿」。

### TPS — Tokens Per Second

单个请求的 token 生成速度。人的阅读速度大约 5-8 tokens/s（中文 3-5 字/秒），所以 TPS 只要超过 15 tokens/s，用户体验就不会有明显瓶颈。

实际数据参考：

| 模型 | GPU | TPS (单请求) | TPS (并发 10) |
|------|-----|-------------|--------------|
| Qwen2.5-7B | A10 24GB | ~45 | ~25 |
| Qwen2.5-72B | A100 80GB x2 | ~20 | ~12 |

并发时 TPS 下降是正常的——GPU 的计算资源被多个请求共享。

### Throughput — 系统级吞吐

跟 TPS 不同，throughput 衡量的是整个系统每秒处理的总 token 数。vLLM 的 continuous batching 会把多个请求打包在一起处理，所以系统 throughput 远高于单请求 TPS。

```
系统 throughput = 并发请求数 × 单请求 TPS
```

一个 A100 跑 7B 模型，并发 64 时系统 throughput 可以到 3000+ tokens/s。

### GPU 利用率的陷阱

`nvidia-smi` 里的 GPU Utilization 显示的是 GPU 有多少时间在执行 kernel，不是「算力用了多少」。一个简单的 memory copy kernel 也会让利用率显示 100%，但实际计算单元可能只用了 10%。

更有意义的指标：
- **SM Occupancy**：Streaming Multiprocessor 的占用率
- **显存利用率**：`memory.used / memory.total`
- **实际 FLOPs**：通过 profiling 工具测量

但在日常运维中，我们更关心一个实用指标：**pending requests 数量**。如果持续有请求在排队（pending > 0），说明 GPU 资源不够了。

```bash
# 从 vLLM 的 metrics 端点获取
curl http://vllm-server:8000/metrics | grep vllm_num_requests
# vllm:num_requests_running 8
# vllm:num_requests_waiting 3  <-- 有 3 个在排队
```

### 指标采集

用 Prometheus 采集 vLLM 暴露的 metrics，关键指标列表：

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'vllm'
    metrics_path: '/metrics'
    scrape_interval: 15s
    static_configs:
      - targets: ['vllm-server:8000']
```

vLLM 暴露的核心 metrics：

| Metric | 类型 | 含义 |
|--------|------|------|
| `vllm:num_requests_running` | Gauge | 正在处理的请求数 |
| `vllm:num_requests_waiting` | Gauge | 排队中的请求数 |
| `vllm:gpu_cache_usage_perc` | Gauge | KV Cache 使用率 |
| `vllm:avg_prompt_throughput_toks_per_s` | Gauge | Prefill 吞吐 |
| `vllm:avg_generation_throughput_toks_per_s` | Gauge | Decode 吞吐 |
| `vllm:e2e_request_latency_seconds` | Histogram | 端到端延迟分布 |
| `vllm:time_to_first_token_seconds` | Histogram | TTFT 分布 |

## 13.2 全链路追踪

Metrics 告诉你「系统整体怎么样」，Tracing 告诉你「一个请求具体慢在哪」。

### OpenTelemetry 集成

OpenTelemetry（OTel）是现在的事实标准。LLM 服务的 trace 需要覆盖以下 span：

```
[API Gateway]
  └── [Auth + Rate Limit Check]       ~2ms
  └── [Model Router]                   ~1ms
  └── [Backend Request]
       └── [Queue Wait]               可能几秒
       └── [Prefill]                   跟输入长度正相关
       └── [Decode]                    跟输出长度正相关
  └── [Response Streaming]             持续时间 = output_tokens / TPS
```

在 FastAPI Gateway 中添加 OTel：

```python
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# 初始化
provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://otel-collector:4317"))
)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer(__name__)

# 自动注入 FastAPI
FastAPIInstrumentor.instrument_app(app)

# 手动添加 LLM 特有的 span 属性
@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    with tracer.start_as_current_span("llm_request") as span:
        span.set_attribute("llm.model", request.model)
        span.set_attribute("llm.input_tokens", count_tokens(request.messages))

        with tracer.start_as_current_span("model_routing"):
            backend = router.select(request)

        with tracer.start_as_current_span("backend_call") as backend_span:
            backend_span.set_attribute("backend.url", backend)
            response = await call_backend(backend, request)

        span.set_attribute("llm.output_tokens", response.usage.completion_tokens)
        span.set_attribute("llm.total_tokens", response.usage.total_tokens)
        return response
```

### Grafana Tempo 部署

Tempo 是 Grafana 出的分布式追踪后端，相比 Jaeger 更轻量，存储用 S3/OSS 对象存储。

```yaml
# docker-compose 快速部署
services:
  tempo:
    image: grafana/tempo:2.6.1
    command: ["-config.file=/etc/tempo.yaml"]
    volumes:
      - ./tempo.yaml:/etc/tempo.yaml
      - tempo-data:/var/tempo
    ports:
      - "4317:4317"   # OTLP gRPC
      - "3200:3200"   # Tempo API

  grafana:
    image: grafana/grafana:11.4.0
    ports:
      - "3000:3000"
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
```

在 Grafana 中配置 Tempo 数据源后，可以按 trace ID 查看完整的调用链路，定位慢请求的瓶颈。

## 13.3 成本模型

这是老板最关心的话题：自建推理服务到底划不划算？

### 自建成本

以阿里云为例，跑一个 Qwen2.5-7B-Instruct 的月度成本：

> 以下价格数据截至 2026 年初，仅供数量级参考，请以云厂商/API 官网最新定价为准。

| 项目 | 规格 | 月费用 |
|------|------|--------|
| GPU 实例 | ecs.gn7i-c8g1.2xlarge (A10 × 1) | ¥5,800 |
| 系统盘 | ESSD 200GB | ¥140 |
| 数据盘 | ESSD 500GB | ¥350 |
| 公网带宽 | 按量付费，50GB/月 | ¥400 |
| **合计** | | **约 ¥6,700/月** |

一张 A10 跑 7B 模型，系统 throughput 约 1500 tokens/s（并发 32），按照 70% 利用率算，每月可处理：

```
1500 × 0.7 × 3600 × 24 × 30 ≈ 27 亿 tokens/月
```

每百万 token 成本：¥6,700 / 2700 ≈ **¥2.5/百万 tokens**

### 云 API 成本

国内主流云 API 定价（2026 年初）：

| 服务 | 模型 | Input | Output |
|------|------|-------|--------|
| 阿里通义 | qwen-plus | ¥0.8/百万 | ¥2/百万 |
| 阿里通义 | qwen-max | ¥2/百万 | ¥6/百万 |
| SiliconFlow | Qwen2.5-7B | ¥0.35/百万 | ¥0.35/百万 |
| DeepSeek | deepseek-chat | ¥1/百万 | ¥2/百万 |

假设 input:output = 3:1 的典型比例，用 SiliconFlow Qwen2.5-7B：
- 混合单价：(0.35 × 3 + 0.35 × 1) / 4 = ¥0.35/百万 tokens

### 盈亏平衡点

关键数字对比：

```
自建成本：¥2.5/百万 tokens（固定成本，不管用不用都要付）
云 API：  ¥0.35/百万 tokens（SiliconFlow 7B，按量付费）
```

等一下——云 API 更便宜？

对，如果用 SiliconFlow 这种低价推理平台，小模型的云 API 确实比自建便宜。自建的优势体现在：

1. **大模型场景**：72B 模型的云 API 定价通常是 7B 的 10-20 倍，但自建只贵 3-4 倍（多用几张卡）
2. **数据安全**：金融、医疗等行业不允许数据出域
3. **定制需求**：微调模型、自定义推理参数
4. **延迟敏感**：自建延迟更可控，不受云 API 排队影响

真正的盈亏平衡计算需要考虑这些因素：

```python
def break_even_analysis(
    gpu_monthly_cost: float,      # GPU 月租金
    max_throughput: float,         # 最大吞吐（tokens/s）
    utilization: float,            # 平均利用率
    cloud_price_per_mtok: float,   # 云 API 每百万 token 价格
) -> dict:
    monthly_tokens = max_throughput * utilization * 3600 * 24 * 30
    self_hosted_per_mtok = gpu_monthly_cost / (monthly_tokens / 1_000_000)

    break_even_util = gpu_monthly_cost / (
        cloud_price_per_mtok * max_throughput * 3600 * 24 * 30 / 1_000_000
    )

    return {
        "self_hosted_per_mtok": round(self_hosted_per_mtok, 2),
        "cloud_per_mtok": cloud_price_per_mtok,
        "break_even_utilization": f"{break_even_util:.1%}",
        "recommendation": "self-hosted" if self_hosted_per_mtok < cloud_price_per_mtok else "cloud"
    }
```

当利用率低于盈亏平衡点时用云 API，高于时自建。最佳实践是混合架构。

### 混合方案

```
                    ┌─────────────┐
                    │  API Gateway │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
    ┌─────────▼─────────┐   ┌──────────▼──────────┐
    │  自建 GPU 集群      │   │  云 API (溢出)       │
    │  处理基线流量        │   │  处理峰值流量         │
    │  2 × A10 实例      │   │  SiliconFlow/阿里通义 │
    └───────────────────┘   └─────────────────────┘
```

基线流量用自建（成本固定，利用率高），峰值溢出到云 API（按量付费，不用为峰值常备资源）。

## 13.4 自动伸缩

### 基于 GPU 的 HPA

K8s 原生 HPA 不支持 GPU 指标。需要通过 Prometheus Adapter 暴露自定义 metrics。

```yaml
# Prometheus Adapter 配置
rules:
  - seriesQuery: 'vllm:num_requests_waiting{namespace!="",pod!=""}'
    resources:
      overrides:
        namespace: {resource: "namespace"}
        pod: {resource: "pod"}
    name:
      matches: "vllm:num_requests_waiting"
      as: "vllm_pending_requests"
    metricsQuery: 'avg(vllm:num_requests_waiting{<<.LabelMatchers>>})'
```

HPA 配置：

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: vllm-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: vllm-qwen-7b
  minReplicas: 2
  maxReplicas: 8
  metrics:
  - type: Pods
    pods:
      metric:
        name: vllm_pending_requests
      target:
        type: AverageValue
        averageValue: "5"  # 每个 Pod 平均排队 5 个请求时扩容
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60   # 1 分钟窗口，避免抖动
      policies:
      - type: Pods
        value: 2
        periodSeconds: 60              # 每次最多加 2 个 Pod
    scaleDown:
      stabilizationWindowSeconds: 300  # 5 分钟窗口，缩容要谨慎
      policies:
      - type: Pods
        value: 1
        periodSeconds: 120             # 每 2 分钟最多缩 1 个
```

### KEDA

KEDA（Kubernetes Event Driven Autoscaling）比原生 HPA 更灵活，直接支持 Prometheus 作为 scaler 来源：

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: vllm-scaledobject
spec:
  scaleTargetRef:
    name: vllm-qwen-7b
  minReplicaCount: 2
  maxReplicaCount: 8
  triggers:
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      metricName: vllm_pending_requests
      query: |
        avg(vllm:num_requests_waiting{deployment="vllm-qwen-7b"})
      threshold: "5"
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
```

### 缩容的坑

GPU 实例的启动很慢：

1. **K8s 节点扩容**：云厂商创建 GPU 实例需要 3-5 分钟
2. **镜像拉取**：vLLM 镜像 ~10GB，拉取需要 2-5 分钟
3. **模型加载**：7B 模型加载 ~1 分钟，72B ~5 分钟

加起来，从 HPA 触发到新 Pod 就绪可能需要 **10-15 分钟**。

应对策略：
- **预热节点**：保持 1-2 个空闲 GPU 节点，避免等待云厂商创建实例
- **模型预缓存**：用 DaemonSet 在每个 GPU 节点上预下载常用模型
- **保守缩容**：缩容窗口设长一些（5-10 分钟），避免频繁缩容后又要扩容

## 13.5 Prompt Caching 的成本节省

### 云 API 的 Prompt Caching

Anthropic 和 OpenAI 都支持 Prompt Caching——如果多个请求的 prompt 前缀相同，后续请求只需为缓存命中部分支付更低的费用。

> 以下价格数据截至 2026 年初，仅供数量级参考，请以官网最新定价为准。

| 服务 | 缓存命中价格 | 正常价格 | 折扣 |
|------|------------|---------|------|
| Anthropic Claude | $0.30/MTok | $3/MTok (Sonnet) | 90% off |
| OpenAI GPT-4o | $1.25/MTok | $2.5/MTok | 50% off |

典型适用场景：
- System prompt 很长（> 1000 tokens）且多个请求共享
- RAG 场景下，相同的检索结果被多次引用
- 多轮对话中，历史消息作为 prefix 重复发送

### 自建场景的 Prefix Caching

vLLM 内置了 Automatic Prefix Caching (APC) 功能：

```bash
# 启动时开启
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --enable-prefix-caching
```

原理：vLLM 会缓存已计算过的 KV Cache block。如果新请求的 prompt 前缀与之前某个请求相同，直接复用缓存的 KV Cache，跳过 prefill 计算。

效果取决于 prompt 前缀的重复率：

| 场景 | 前缀重复率 | TTFT 节省 |
|------|-----------|----------|
| 固定 System Prompt | ~高 | 30-50% |
| RAG（相同知识库） | ~中 | 20-30% |
| 完全随机请求 | ~低 | < 5% |

开启 APC 几乎没有副作用（会多占一些显存用于缓存），建议默认开启。

### 实际节省计算

假设一个客服场景：
- System prompt：1500 tokens（固定）
- 检索上下文：500 tokens（部分重复）
- 用户消息：200 tokens（每次不同）

不开 prefix caching：每次 prefill 2200 tokens
开启后：大部分请求只需 prefill 200-700 tokens

TTFT 从 ~400ms 降到 ~150ms，用户体感提升明显。

## 本章小结

1. **TTFT 和 pending requests** 是最需要关注的两个指标，直接影响用户体验和扩容决策
2. **OTel 全链路追踪**帮你定位单个慢请求的瓶颈
3. **成本优化的核心是利用率**——GPU 闲着就是在烧钱，混合架构让利用率保持在最优区间
4. **自动伸缩要考虑 GPU 启动延迟**，不能照搬传统服务的伸缩策略
5. **Prefix Caching 是低垂果实**，几乎零成本就能显著降低延迟和计算开销
