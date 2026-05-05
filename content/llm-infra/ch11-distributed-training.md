# 第 11 章 分布式训练基础

> **进阶章节。** 如果你的目标是推理部署和微调（QLoRA 单卡即可），可以先跳过本章。当你需要从零预训练模型或在多卡上做 Full Fine-tuning 时再回来。

前两章我们在单卡上搞定了微调和对齐。但现实中，单卡很快就不够用了：

- 模型太大，一张卡放不下（70B 模型 bf16 需要 140GB）
- 数据太多，单卡训练太慢
- 要做 Full Fine-tuning 或预训练，显存和算力都不够

这一章我们讲分布式训练的核心概念：数据并行、模型并行、ZeRO、FSDP，以及底层的网络通信。不追求面面俱到，但确保你理解每种方案在解决什么问题、什么时候该用哪个。

## 11.1 数据并行

### 最简单的分布式策略

数据并行（Data Parallelism, DP）的思路最直观：

1. 每张卡上放一份完整的模型副本
2. 一个 batch 的数据切成 N 份，每张卡处理一份
3. 每张卡各自做 forward + backward，算出梯度
4. 所有卡的梯度做 all-reduce（求平均）
5. 每张卡用平均梯度更新自己的模型参数

效果等价于在单卡上用 N 倍的 batch size 训练。

### All-Reduce 的通信开销

all-reduce 是数据并行的核心通信操作。假设模型有 $P$ 个参数，每个参数的梯度是 bf16（2 bytes），那每张卡需要发送 $2P$ bytes 的数据。

以 7B 模型为例：

- 梯度大小：7B × 2 bytes = 14 GB
- 在 ring all-reduce 中，每张卡需要发送和接收约 $2 \times \frac{N-1}{N} \times 14$ GB 的数据
- 8 卡通过 NVLink（900 GB/s 双向带宽）：通信时间约 **0.05 秒**
- 8 卡通过 PCIe Gen4（64 GB/s 双向带宽）：通信时间约 **0.8 秒**

如果一个训练 step 的计算时间是 2 秒，那 NVLink 下通信开销可以忽略（2.5%），但 PCIe 下就有 30%+ 的开销了。这就是为什么训练集群都用 NVLink。

### PyTorch DDP

PyTorch 的 DistributedDataParallel（DDP）是数据并行的标准实现：

```python
import torch
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP

# 初始化进程组
dist.init_process_group(backend="nccl")
local_rank = int(os.environ["LOCAL_RANK"])
torch.cuda.set_device(local_rank)

# 模型放到对应 GPU
model = MyModel().to(local_rank)
model = DDP(model, device_ids=[local_rank])

# 数据用 DistributedSampler 切分
sampler = torch.utils.data.distributed.DistributedSampler(dataset)
dataloader = DataLoader(dataset, sampler=sampler, batch_size=8)

# 训练循环和单卡完全一样
for batch in dataloader:
    loss = model(batch)
    loss.backward()
    optimizer.step()
    optimizer.zero_grad()
```

启动方式：

```bash
torchrun --nproc_per_node=4 train.py
```

DDP 的优点是简单、通信效率高（梯度计算和通信可以 overlap）。缺点是每张卡都要放一份完整的模型，所以显存没有节省——模型太大就放不下。

完整代码见 `examples/ch11-distributed-training/01_ddp_basic.py`。

## 11.2 模型并行

当模型大到一张卡放不下时，就需要模型并行。

### Tensor Parallelism（张量并行）

Tensor Parallelism（TP）把一个层的矩阵切分到多张卡上。

以一个线性层 $Y = XW$ 为例，$W \in \mathbb{R}^{d \times d}$：

- 把 $W$ 按列切成 $N$ 份：$W = [W_1, W_2, ..., W_N]$
- 每张卡拿一份 $W_i$，计算 $Y_i = X W_i$
- 最后把 $Y_i$ 拼起来（或 all-reduce）得到完整的 $Y$

优点：
- 每层都并行，延迟低
- 线性扩展显存

缺点：
- 每层都需要通信（all-reduce 或 all-gather），对带宽要求极高
- 通常只在同一台机器的 GPU 之间使用（NVLink 连接）

Tensor Parallelism 在推理时（vLLM 的 `--tensor-parallel-size`）比训练时更常见，因为推理对延迟更敏感。

### Pipeline Parallelism（流水线并行）

Pipeline Parallelism（PP）把模型的不同层放到不同卡上：

- GPU 0：Layer 0-7
- GPU 1：Layer 8-15
- GPU 2：Layer 16-23
- GPU 3：Layer 24-31

问题是，朴素的 PP 会导致严重的"气泡"（bubble）：GPU 0 算完 forward 后，要等 GPU 1、2、3 依次算完才能开始 backward。大部分时间 GPU 都在空闲。

解决方案是 **Micro-batching**：把一个 batch 切成多个 micro-batch，形成流水线：

```
GPU 0: [F1][F2][F3][F4]          [B4][B3][B2][B1]
GPU 1:     [F1][F2][F3][F4]      [B4][B3][B2][B1]
GPU 2:         [F1][F2][F3][F4]  [B4][B3][B2][B1]
GPU 3:             [F1][F2][F3][F4][B4][B3][B2][B1]
```

这样就把空闲时间（bubble）从 $\frac{N-1}{N}$ 降低到 $\frac{N-1}{N+M-1}$，$M$ 是 micro-batch 的数量。

优点：
- 通信量小（只在层边界传激活值）
- 适合跨机器使用

缺点：
- 不可避免的 bubble 开销
- 负载均衡难（每层的计算量可能不同）

### 实际选择

大规模训练通常组合使用多种并行策略（称为 3D parallelism）：

- **TP**：同一台机器的 GPU 之间（需要高带宽）
- **PP**：跨机器（带宽要求低一些）
- **DP**：在 TP+PP 组的基础上做数据并行

比如用 64 张 GPU 训练一个大模型：
- 8 张卡为一组做 TP（一台机器内）
- 2 组做 PP（跨 2 台机器）
- 4 路 DP（4 份数据并行副本）
- 总共：8 × 2 × 4 = 64 张卡

## 11.3 ZeRO 优化

### DeepSpeed 的核心贡献

微软的 DeepSpeed 提出了 ZeRO（Zero Redundancy Optimizer），核心洞察是：

> 在数据并行中，每张卡都保存完整的模型参数、梯度和优化器状态，这里有大量冗余。我们可以把这些状态分片（shard）到不同卡上。

### ZeRO 三个 Stage

以 7B 模型、8 卡 DP 为例（每卡单独计算）：

**ZeRO Stage 1：分片优化器状态**

- 模型参数：每张卡 15.2 GB（完整副本）
- 梯度：每张卡 15.2 GB（完整副本）
- 优化器状态：每张卡 60.8 / 8 = **7.6 GB**（只存 1/8）
- 总计：~38 GB / 卡（原来是 ~95 GB）

**ZeRO Stage 2：分片优化器状态 + 梯度**

- 模型参数：每张卡 15.2 GB（完整副本）
- 梯度：每张卡 15.2 / 8 = **1.9 GB**（只存 1/8）
- 优化器状态：每张卡 **7.6 GB**（只存 1/8）
- 总计：~24.7 GB / 卡

**ZeRO Stage 3：分片所有状态**

- 模型参数：每张卡 15.2 / 8 = **1.9 GB**（只存 1/8）
- 梯度：每张卡 **1.9 GB**
- 优化器状态：每张卡 **7.6 GB**
- 总计：~11.4 GB / 卡

显存节省对比（7B，8 卡 DP）：

| Stage | 每卡显存 | 节省比例 |
|-------|---------|---------|
| 无 ZeRO | ~95 GB | - |
| Stage 1 | ~38 GB | 60% |
| Stage 2 | ~24.7 GB | 74% |
| Stage 3 | ~11.4 GB | 88% |

### 什么时候用哪个 Stage

**ZeRO Stage 2**：最常用的选择。

- 通信开销和普通 DDP 接近（梯度的 reduce-scatter + all-gather）
- 显存节省显著
- 计算效率几乎不受影响
- 适用场景：模型能在单卡放下，但 optimizer 放不下

**ZeRO Stage 3**：模型本身都放不下时用。

- 需要额外的 all-gather 来获取完整参数（forward 和 backward 前）
- 通信量是 Stage 2 的约 1.5 倍
- 计算效率有 10-20% 的损失
- 适用场景：大模型 Full FT，或者显存非常紧张

实际建议：先试 Stage 2，不够再用 Stage 3。

### DeepSpeed 配置

一个典型的 ZeRO Stage 2 配置：

```json
{
  "bf16": {"enabled": true},
  "zero_optimization": {
    "stage": 2,
    "allgather_partitions": true,
    "allgather_bucket_size": 5e8,
    "overlap_comm": true,
    "reduce_scatter": true,
    "reduce_bucket_size": 5e8,
    "contiguous_gradients": true
  },
  "gradient_accumulation_steps": 4,
  "gradient_clipping": 1.0,
  "train_batch_size": "auto",
  "train_micro_batch_size_per_gpu": "auto"
}
```

和 HuggingFace Transformers 集成非常简单——在 TrainingArguments 里指定 deepspeed 配置文件路径即可。

完整配置和代码见 `examples/ch11-distributed-training/03_deepspeed_config.json` 和 `04_deepspeed_train.py`。

## 11.4 FSDP

### PyTorch 原生的 Fully Sharded Data Parallel

FSDP 是 PyTorch 从 1.11 开始原生支持的分片数据并行，思路和 DeepSpeed ZeRO Stage 3 基本一样：

- 把模型参数、梯度、优化器状态都分片
- forward 时 all-gather 收集完整参数
- backward 后 reduce-scatter 分发梯度
- 不需要的参数及时释放（节省显存）

### FSDP vs DeepSpeed ZeRO

| 维度 | FSDP | DeepSpeed ZeRO |
|-----|------|---------------|
| 生态 | PyTorch 原生 | 独立库 |
| 配置 | Python API | JSON 配置文件 |
| ZeRO Stage | 类似 Stage 3（也支持 Stage 2 行为） | Stage 1/2/3 |
| CPU Offload | 支持 | 支持 |
| 混合精度 | 原生支持 | 原生支持 |
| HF 集成 | 通过 Accelerate | 原生支持 |
| 社区活跃度 | Meta 主推 | 微软主推 |

实际上两者在大多数场景下性能接近。选择建议：

- 如果你用 HuggingFace 生态，两个都方便用
- 如果你从零搭训练框架，FSDP 更"原生"
- 如果需要 ZeRO Stage 1/2 的灵活性，用 DeepSpeed
- 如果需要 CPU Offload 到极致，DeepSpeed 的 ZeRO-Infinity 更成熟

### FSDP 使用方式

```python
from torch.distributed.fsdp import FullyShardedDataParallel as FSDP
from torch.distributed.fsdp import MixedPrecision, ShardingStrategy

# 混合精度策略
mp_policy = MixedPrecision(
    param_dtype=torch.bfloat16,
    reduce_dtype=torch.bfloat16,
    buffer_dtype=torch.bfloat16,
)

# 包装模型
model = FSDP(
    model,
    sharding_strategy=ShardingStrategy.FULL_SHARD,  # 类似 ZeRO Stage 3
    mixed_precision=mp_policy,
    device_id=torch.cuda.current_device(),
)
```

`ShardingStrategy` 的选项：

- `FULL_SHARD`：类似 ZeRO Stage 3，全分片
- `SHARD_GRAD_OP`：类似 ZeRO Stage 2，只分片梯度和优化器
- `NO_SHARD`：等同于 DDP，不分片

通过 HuggingFace Accelerate 使用更简单：

```yaml
# accelerate_config.yaml
compute_environment: LOCAL_MACHINE
distributed_type: FSDP
fsdp_config:
  fsdp_auto_wrap_policy: TRANSFORMER_BASED_WRAP
  fsdp_sharding_strategy: FULL_SHARD
  fsdp_backward_prefetch_policy: BACKWARD_PRE
  fsdp_state_dict_type: SHARDED_STATE_DICT
  mixed_precision: bf16
```

完整代码见 `examples/ch11-distributed-training/02_fsdp_train.py`。

## 11.5 训练集群的网络

分布式训练的瓶颈往往不在 GPU 计算，而在 GPU 之间的通信。

### GPU 间通信技术

**NVLink**：NVIDIA 的高速 GPU 互联。

- NVLink 3.0（A100）：双向 600 GB/s
- NVLink 4.0（H100）：双向 900 GB/s
- 通常连接同一台机器内的 GPU

**NVSwitch**：把一台机器内所有 GPU 连成全互联。

- A100 DGX：8 GPU 通过 NVSwitch 全互联，任意两张卡 600 GB/s
- H100 DGX：8 GPU 全互联，任意两张卡 900 GB/s

**PCIe**：老牌通用接口。

- PCIe Gen4 x16：双向 ~32 GB/s
- PCIe Gen5 x16：双向 ~64 GB/s
- 带宽比 NVLink 低一个数量级，不适合 TP

**InfiniBand**：跨机器的高速网络。

- HDR InfiniBand：200 Gbps = 25 GB/s
- NDR InfiniBand：400 Gbps = 50 GB/s
- 延迟极低（~1μs），适合大规模集群

**RoCE（RDMA over Converged Ethernet）**：基于以太网的 RDMA。

- 成本比 InfiniBand 低
- 性能接近，但延迟稍高
- 很多云厂商用这个

### 通信带宽对训练速度的影响

我们算一个具体例子。假设你在做 7B 模型的 DDP 训练，每步需要 all-reduce 14 GB 的梯度：

| 网络 | 带宽 | 通信时间（8 卡） | 占比（2s/step） |
|------|-----|--------------|---------------|
| NVLink 4.0 | 900 GB/s | ~0.03s | 1.5% |
| NVLink 3.0 | 600 GB/s | ~0.05s | 2.5% |
| PCIe Gen5 | 64 GB/s | ~0.4s | 17% |
| InfiniBand NDR | 50 GB/s | ~0.5s | 20% |
| 25G 以太网 | 3.1 GB/s | ~8s | 80% |

可以看到：

- **机器内**：必须用 NVLink/NVSwitch，PCIe 勉强可以做 DP，不适合 TP
- **机器间**：至少用 InfiniBand 或高速 RoCE，普通以太网根本跑不动

### 云上的 GPU 集群网络

如果你在云上租 GPU，网络拓扑直接影响训练效率：

**阿里云**：

- GPU 云服务器（ecs.gn7i）：单机 8 卡 A10，NVLink 互联
- 灵骏智算集群：A100/H100，机器间 RDMA 网络，适合大规模训练
- PAI 平台封装了分布式训练的细节

**腾讯云**：

- GPU 云服务器（GN10Xp）：单机 8 卡 A100，NVLink 互联
- 高性能计算集群（HCC）：InfiniBand 互联，适合多机训练

**AWS**：

- p5 实例：8 卡 H100，NVLink + EFA 网络（400 Gbps）
- p4d 实例：8 卡 A100，NVLink + EFA 网络（400 Gbps）

选择建议：

- 单机 8 卡足够你的任务 → 租一台 8 卡机器就好，不用关心机器间网络
- 需要多机 → 必须选有高速互联（RDMA/InfiniBand/EFA）的实例类型，否则网络会成为严重瓶颈
- 做 TP → 只在机器内做（NVLink），跨机器用 DP 或 PP

---

## 小结

| 并行策略 | 解决的问题 | 通信需求 | 典型使用 |
|---------|----------|---------|---------|
| 数据并行（DDP） | 训练速度 | 中（梯度同步） | 模型能放一张卡 |
| ZeRO Stage 2 | 优化器显存 | 中 | 最常用 |
| ZeRO Stage 3 / FSDP | 模型太大 | 高 | 大模型 Full FT |
| Tensor Parallelism | 模型太大 | 极高（每层都通信） | 机器内，推理为主 |
| Pipeline Parallelism | 模型太大 | 低 | 跨机器 |

对于大多数微调场景：

- **7B LoRA**：单卡搞定，不需要分布式
- **7B Full FT**：2-4 卡 + ZeRO Stage 2
- **70B LoRA**：2-4 卡 + ZeRO Stage 3
- **70B Full FT**：16+ 卡 + ZeRO Stage 3 + TP
- **预训练**：3D parallelism，这超出了本章范围

掌握了 DDP 和 ZeRO，你就能应对大多数实际训练场景了。
