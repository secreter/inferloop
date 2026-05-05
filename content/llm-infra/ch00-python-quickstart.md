# 第 0 章：Python 环境与快速入门

> 本章面向有 JavaScript/TypeScript 经验但不熟悉 Python 的读者。如果你已经能熟练使用 Python 和 pip，可以跳过本章。后续章节的代码示例以 Python 为主，建议至少过一遍 0.3 节的语法对照表。

## 0.1 面向 Node.js/TS 工程师的 Python 环境指南

如果你像本书的目标读者一样，主要使用 Node.js + TypeScript，这里是 Python 生态的对应关系：

| Node.js 生态 | Python 生态 | 说明 |
|-------------|------------|------|
| nvm | conda / pyenv | Python 版本管理 |
| npm / pnpm | pip / uv | 包管理 |
| package.json | requirements.txt / pyproject.toml | 依赖声明 |
| node_modules | venv / conda env | 隔离环境 |
| TypeScript | Type Hints (mypy) | 类型系统 |
| ESLint | ruff | Linter |
| Jest | pytest | 测试 |

## 0.2 推荐安装步骤

### 1. 安装 Miniconda

```bash
# Linux
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
bash Miniconda3-latest-Linux-x86_64.sh
```

### 2. 创建项目环境

```bash
conda create -n llm-infra python=3.10 -y
conda activate llm-infra
```

### 3. 安装 PyTorch

```bash
# 有 GPU（CUDA 12.1）
pip install torch --index-url https://download.pytorch.org/whl/cu121

# 仅 CPU（用于前几章的基础实验）
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

### 4. 验证安装

```python
import torch
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_mem / 1024**3:.1f} GB")
```

## 0.3 IDE 推荐

- **VS Code + Python 扩展** — 最接近你熟悉的开发体验
- **Cursor** — AI 辅助编码
- Jupyter Notebook — 适合实验和可视化（`pip install jupyter`）
