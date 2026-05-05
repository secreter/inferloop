# 第 12 章 LLM 服务的生产化部署

把模型跑起来只是第一步。从 `python -m vllm.entrypoints.openai.api_server` 到真正承载线上流量，中间隔着容器化、GPU 调度、模型版本管理、API Gateway 等一系列工程问题。这一章把这些问题逐个拆解。

## 12.1 容器化部署

### 为什么一定要容器化

LLM 推理服务的依赖链条很长：CUDA driver → CUDA toolkit → cuDNN → PyTorch → vLLM/TGI。任何一个版本不匹配都会导致 `CUDA error: no kernel image is available`。容器化不是可选项，是必选项。

### NVIDIA Container Toolkit

在宿主机上安装 NVIDIA driver 之后，需要安装 NVIDIA Container Toolkit，让 Docker 容器能访问 GPU。

```bash
# Ubuntu 22.04
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

验证安装：

```bash
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

如果能看到 GPU 信息，说明配置正确。

### 生产级 Dockerfile

直接用 vLLM 官方镜像是最省事的方式。但实际项目中往往需要定制——加自定义的 tokenizer、挂载模型权重、配置健康检查等。

```dockerfile
FROM vllm/vllm-openai:v0.6.6.post1

# 安装额外依赖（如果有自定义逻辑）
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# 模型权重通常不打进镜像（太大了），通过 volume mount 挂载
# 这里只放配置文件
COPY model_config.json /app/model_config.json

ENV MODEL_NAME="Qwen/Qwen2.5-7B-Instruct"
ENV TENSOR_PARALLEL_SIZE=1
ENV MAX_MODEL_LEN=8192
ENV GPU_MEMORY_UTILIZATION=0.90

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

ENTRYPOINT python -m vllm.entrypoints.openai.api_server \
  --model /models/${MODEL_NAME} \
  --tensor-parallel-size ${TENSOR_PARALLEL_SIZE} \
  --max-model-len ${MAX_MODEL_LEN} \
  --gpu-memory-utilization ${GPU_MEMORY_UTILIZATION} \
  --host 0.0.0.0 \
  --port 8000
```

运行方式：

```bash
docker run -d --gpus all \
  -v /data/models:/models \
  -p 8000:8000 \
  --name vllm-server \
  --shm-size=4g \
  my-vllm-server:latest
```

几个关键参数：
- `--gpus all`：分配所有 GPU。生产环境用 `--gpus '"device=0,1"'` 指定具体卡
- `--shm-size=4g`：共享内存。PyTorch DataLoader 和 tensor parallel 通信需要用到，默认 64MB 远远不够
- `-v /data/models:/models`：模型权重从宿主机挂载，不打进镜像

### 镜像托管

国内拉 Docker Hub 和 ghcr.io 的镜像经常超时。生产环境建议把镜像推到云厂商的 Registry：

**阿里云 ACR（容器镜像服务）：**

```bash
# 登录
docker login --username=<阿里云账号> registry.cn-hangzhou.aliyuncs.com

# 打 tag 并推送
docker tag my-vllm-server:latest \
  registry.cn-hangzhou.aliyuncs.com/<命名空间>/vllm-server:v1.0
docker push registry.cn-hangzhou.aliyuncs.com/<命名空间>/vllm-server:v1.0
```

**腾讯云 TCR（容器镜像服务）：**

```bash
docker login ccr.ccs.tencentyun.com --username=<腾讯云账号ID>

docker tag my-vllm-server:latest \
  ccr.ccs.tencentyun.com/<命名空间>/vllm-server:v1.0
docker push ccr.ccs.tencentyun.com/<命名空间>/vllm-server:v1.0
```

ACR 个人版免费，企业版按实例收费。TCR 个人版免费额度 500 个镜像。

## 12.2 Kubernetes + GPU 调度

单机 Docker 能跑，但扛不住多副本、自动伸缩、滚动更新这些需求。生产环境基本都上 K8s。

### GPU 资源声明

K8s 通过 Extended Resources 机制管理 GPU。安装 NVIDIA device plugin 后，每个 GPU 节点会上报 `nvidia.com/gpu` 资源。

```bash
# 安装 NVIDIA device plugin（DaemonSet 方式）
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.16.1/deployments/static/nvidia-device-plugin.yml

# 验证 GPU 资源
kubectl describe node <gpu-node> | grep nvidia.com/gpu
# nvidia.com/gpu:  4
# nvidia.com/gpu:  4
```

在 Pod spec 中声明 GPU 需求：

```yaml
resources:
  limits:
    nvidia.com/gpu: 1  # 请求 1 张 GPU
  requests:
    nvidia.com/gpu: 1
```

注意：GPU 资源只能整数分配，不像 CPU 可以请求 0.5 核。一个 Pod 要么拿到一整张卡，要么拿不到。

### GPU 共享方案

一张 A100 80GB 跑一个 7B 模型只用 15GB 显存，剩下 65GB 白白浪费。GPU 共享是降本的关键。

**MIG（Multi-Instance GPU）：**

NVIDIA A100/A30/H100 支持 MIG，可以把一张物理 GPU 切成最多 7 个独立实例，每个实例有独立的显存和计算资源。

```bash
# 在 GPU 节点上启用 MIG
sudo nvidia-smi -i 0 -mig 1

# 创建 MIG 实例（以 A100 为例，切成 3 个 3g.40gb 实例）
sudo nvidia-smi mig -i 0 -cgi 9,9,9 -C
```

在 K8s 中，MIG 实例以独立 GPU 资源的形式出现：

```yaml
resources:
  limits:
    nvidia.com/mig-3g.40gb: 1
```

**Time-slicing：**

不需要特殊硬件支持，通过 NVIDIA device plugin 的配置实现 GPU 时间片共享。

```yaml
# ConfigMap for time-slicing
apiVersion: v1
kind: ConfigMap
metadata:
  name: nvidia-device-plugin
  namespace: kube-system
data:
  config: |
    version: v1
    sharing:
      timeSlicing:
        resources:
        - name: nvidia.com/gpu
          replicas: 4  # 每张 GPU 虚拟化为 4 份
```

Time-slicing 的缺点是没有显存隔离——一个 Pod OOM 会影响同卡的其他 Pod。适合开发测试环境，生产环境推荐 MIG。

### 阿里云 ACK GPU 节点池

```bash
# 使用 aliyun CLI 创建 GPU 节点池
aliyun cs POST /clusters/<cluster-id>/nodepools --body '{
  "nodepool_info": {
    "name": "gpu-pool-a10"
  },
  "scaling_group": {
    "instance_types": ["ecs.gn7i-c8g1.2xlarge"],  # A10, 1卡24GB
    "system_disk_category": "cloud_essd",
    "system_disk_size": 200,
    "data_disks": [{
      "category": "cloud_essd",
      "size": 500  # 模型权重需要大磁盘
    }],
    "desired_size": 2
  },
  "kubernetes_config": {
    "labels": [
      {"key": "gpu-type", "value": "a10"}
    ],
    "taints": [
      {"key": "nvidia.com/gpu", "value": "present", "effect": "NoSchedule"}
    ]
  }
}'
```

关键配置：
- 数据盘至少 500GB：模型权重大（7B ≈ 14GB，72B ≈ 144GB），加上多版本缓存
- Taint：防止非 GPU 工作负载调度到昂贵的 GPU 节点
- Label：用于 nodeSelector 精确调度

### 完整 Deployment 示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-qwen-7b
  labels:
    app: vllm-qwen-7b
spec:
  replicas: 2
  selector:
    matchLabels:
      app: vllm-qwen-7b
  template:
    metadata:
      labels:
        app: vllm-qwen-7b
    spec:
      tolerations:
      - key: "nvidia.com/gpu"
        operator: "Exists"
        effect: "NoSchedule"
      nodeSelector:
        gpu-type: a10
      containers:
      - name: vllm
        image: registry.cn-hangzhou.aliyuncs.com/my-ns/vllm-server:v1.0
        ports:
        - containerPort: 8000
        env:
        - name: MODEL_NAME
          value: "Qwen/Qwen2.5-7B-Instruct"
        - name: TENSOR_PARALLEL_SIZE
          value: "1"
        - name: MAX_MODEL_LEN
          value: "8192"
        resources:
          limits:
            nvidia.com/gpu: 1
            memory: "32Gi"
            cpu: "8"
          requests:
            nvidia.com/gpu: 1
            memory: "24Gi"
            cpu: "4"
        volumeMounts:
        - name: model-cache
          mountPath: /models
        - name: shm
          mountPath: /dev/shm
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 120  # 模型加载需要时间
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 120
          periodSeconds: 10
      volumes:
      - name: model-cache
        hostPath:
          path: /data/models
          type: DirectoryOrCreate
      - name: shm
        emptyDir:
          medium: Memory
          sizeLimit: "4Gi"
```

几个值得注意的细节：

1. **initialDelaySeconds: 120**：7B 模型加载到 GPU 大概需要 30-60 秒，72B 可能要 3-5 分钟。设太短会导致 Pod 被反复杀死
2. **shm volume**：用 emptyDir + Memory medium 来提供共享内存，替代 Docker 的 `--shm-size`
3. **模型缓存用 hostPath**：生产环境应该用 PV/PVC + NAS/NFS，这里简化了

## 12.3 模型注册与版本管理

### 模型文件存储

模型权重文件动辄几十 GB，不适合放在容器镜像里。常见方案：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 阿里云 OSS / 腾讯云 COS | 便宜、可靠 | 每次启动要下载，慢 |
| NAS 共享存储 | 多节点共享、无需下载 | 贵（约 OSS 5-10 倍） |
| 本地缓存 + OSS 回源 | 兼顾速度和成本 | 需要管理缓存 |

推荐方案是「OSS + 本地缓存」：

```bash
#!/bin/bash
# init-model.sh - Pod 的 initContainer 脚本
MODEL_PATH="/models/${MODEL_NAME}"
OSS_PATH="oss://my-models/${MODEL_NAME}"

if [ -d "$MODEL_PATH" ] && [ -f "$MODEL_PATH/config.json" ]; then
    echo "Model already cached locally, skipping download"
else
    echo "Downloading model from OSS..."
    ossutil cp -r "$OSS_PATH" "$MODEL_PATH" --parallel 10
fi
```

在 Deployment 中用 initContainer 执行：

```yaml
initContainers:
- name: model-downloader
  image: registry.cn-hangzhou.aliyuncs.com/my-ns/ossutil:latest
  command: ["/bin/bash", "/scripts/init-model.sh"]
  env:
  - name: MODEL_NAME
    value: "Qwen2.5-7B-Instruct"
  volumeMounts:
  - name: model-cache
    mountPath: /models
  - name: scripts
    mountPath: /scripts
```

### 模型版本管理

不要用 `latest` 这种模糊标签。推荐用语义化版本 + 日期的命名规范：

```
models/
├── Qwen2.5-7B-Instruct/
│   ├── v1.0_20250101/    # 基础版本
│   ├── v1.1_20250115/    # 微调版本
│   └── current -> v1.1_20250115  # 软链接指向当前版本
```

配合配置中心（Apollo / Nacos）管理当前生效的版本号，切换版本只需改配置 + 滚动重启。

### 灰度发布

新模型上线不能一把梭。推荐灰度策略：

```yaml
# 用两个 Deployment 实现 A/B 测试
# v1 版本 - 90% 流量
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-qwen-v1
spec:
  replicas: 9  # 9 个副本
  # ...

---
# v2 版本 - 10% 流量
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-qwen-v2
spec:
  replicas: 1  # 1 个副本
  # ...

---
# 共享同一个 Service，通过副本数控制流量比例
apiVersion: v1
kind: Service
metadata:
  name: vllm-qwen
spec:
  selector:
    app: vllm-qwen  # 两个 Deployment 都打这个 label
  ports:
  - port: 8000
```

更精细的流量控制可以用 Istio VirtualService 的 weight 配置。

## 12.4 API Gateway 设计

LLM 服务不能裸露给客户端。API Gateway 需要处理：鉴权、限流、负载均衡、超时。

### 限流策略

LLM 的限流比传统 API 复杂。一个请求可能消耗 10 个 token，也可能消耗 10000 个。

两层限流：

```
第一层：请求级限流（简单快速）
  - 每个 API Key 每分钟最多 60 个请求

第二层：Token 级限流（精确但有延迟）
  - 每个 API Key 每分钟最多 100K tokens
  - 需要在请求完成后扣减，不能预扣（因为不知道 completion 会生成多少 token）
```

实现上用 Redis 的滑动窗口：

```python
import redis
import time

r = redis.Redis()

def check_rate_limit(api_key: str, rpm_limit: int = 60) -> bool:
    """滑动窗口限流"""
    now = time.time()
    window_start = now - 60
    key = f"rate_limit:{api_key}"

    pipe = r.pipeline()
    pipe.zremrangebyscore(key, 0, window_start)  # 清理过期记录
    pipe.zcard(key)                               # 当前窗口请求数
    pipe.zadd(key, {str(now): now})               # 添加当前请求
    pipe.expire(key, 120)                         # 设置过期时间
    _, count, _, _ = pipe.execute()

    if count >= rpm_limit:
        r.zrem(key, str(now))  # 超限，移除刚添加的
        return False
    return True
```

### 负载均衡

传统的 Round Robin 对 LLM 服务不友好。一个长上下文请求可能占用一个实例好几秒，而同时来的短请求被路由到已经很忙的实例上。

更好的策略是 **Least Pending Requests**——把请求路由到当前排队最少的实例：

```python
class LeastPendingRouter:
    def __init__(self, backends: list[str]):
        self.backends = backends
        self.pending = {b: 0 for b in backends}

    async def route(self) -> str:
        backend = min(self.pending, key=self.pending.get)
        self.pending[backend] += 1
        return backend

    async def release(self, backend: str):
        self.pending[backend] = max(0, self.pending[backend] - 1)
```

vLLM 自身的 `/metrics` 端点会暴露当前 pending requests 数量，可以用这个做更精确的路由。

### Streaming 超时

LLM 的 streaming 响应可能持续几十秒。不能简单设一个 30 秒超时把连接断掉。

```python
# 错误做法
timeout = aiohttp.ClientTimeout(total=30)  # 30 秒后整个请求超时

# 正确做法：分段超时
timeout = aiohttp.ClientTimeout(
    connect=5,        # 连接超时 5 秒
    sock_read=30,     # 单次读取超时 30 秒（两个 chunk 之间的间隔）
    total=300,        # 总超时 5 分钟
)
```

`sock_read` 超时是关键：它控制的是两个 SSE chunk 之间的最大间隔，而不是整个响应的时长。正常情况下 vLLM 每 10-50ms 就会发一个 token chunk，如果 30 秒都没收到下一个 chunk，说明后端出问题了。

## 12.5 多模型路由

生产环境通常不只跑一个模型。典型配置：

| 模型 | 用途 | 成本 |
|------|------|------|
| Qwen2.5-72B-Instruct | 复杂推理、代码生成 | 高 |
| Qwen2.5-7B-Instruct | 日常对话、简单任务 | 低 |
| BGE-M3 | Embedding | 极低 |

### 基于内容的路由

根据用户请求的内容特征选择模型：

```python
def classify_request(messages: list[dict]) -> str:
    """简单的请求分类"""
    last_msg = messages[-1]["content"].lower()
    total_tokens = sum(len(m["content"]) for m in messages) // 4  # 粗估 token 数

    # 长上下文或复杂任务 -> 大模型
    if total_tokens > 2000:
        return "qwen-72b"
    if any(kw in last_msg for kw in ["代码", "code", "分析", "推理", "debug"]):
        return "qwen-72b"

    # 简单任务 -> 小模型
    return "qwen-7b"
```

更精确的做法是用一个小的 classifier 模型来分类，但这会增加延迟。实际项目中，基于简单规则 + 用户手动选择已经够用了。

### Fallback 策略

主模型不可用时自动降级：

```python
class ModelRouter:
    def __init__(self):
        self.routes = {
            "qwen-72b": {
                "primary": "http://vllm-72b:8000",
                "fallback": ["http://vllm-7b:8000"],  # 降级到小模型
            },
            "qwen-7b": {
                "primary": "http://vllm-7b:8000",
                "fallback": ["https://api.siliconflow.cn/v1"],  # 降级到云 API
            },
        }

    async def call(self, model: str, request: dict) -> dict:
        route = self.routes[model]

        # 先尝试主模型
        try:
            return await self._call_backend(route["primary"], request)
        except Exception as e:
            logger.warning(f"Primary backend failed: {e}")

        # 依次尝试 fallback
        for fallback in route["fallback"]:
            try:
                return await self._call_backend(fallback, request)
            except Exception:
                continue

        raise Exception("All backends failed")
```

### 成本感知路由

如果自建的 GPU 实例已经满载，新请求可以溢出到云 API：

```python
async def cost_aware_route(self, request: dict) -> str:
    """优先用自建实例，满载时溢出到云 API"""
    self_hosted_pending = await self.get_pending_count("self-hosted")
    threshold = 50  # 队列深度阈值

    if self_hosted_pending < threshold:
        return "self-hosted"
    else:
        logger.info(f"Self-hosted queue depth {self_hosted_pending}, "
                    f"routing to cloud API")
        return "cloud-api"
```

这种混合架构的好处是：自建实例扛基线流量（成本低），峰值流量溢出到云 API（弹性好）。详细的成本计算见下一章。

## 本章小结

这一章覆盖了 LLM 服务从容器化到 K8s 部署的完整链路：

1. **容器化**是基础，NVIDIA Container Toolkit + vLLM 官方镜像能快速起步
2. **K8s GPU 调度**通过 device plugin + resource limits 管理 GPU，MIG 和 time-slicing 提升利用率
3. **模型版本管理**用 OSS + 本地缓存 + 语义化版本号
4. **API Gateway** 的核心是 Token 级限流和 Least Pending 路由
5. **多模型路由**实现成本和质量的平衡

下一章讲这套系统跑起来之后，怎么监控它、怎么降成本。
