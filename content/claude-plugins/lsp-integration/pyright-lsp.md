# Pyright LSP

**语言服务器**：Pyright（微软出品，VS Code 的 Pylance 扩展的开源核心）

**支持的扩展名**：`.py`、`.pyi`

## 安装

三种方式，选一个：

```bash
# npm（最简单，不依赖 Python 环境）
npm install -g pyright

# pip
pip install pyright

# pipx（推荐用于 CLI 工具，避免污染全局 Python 环境）
pipx install pyright
```

npm 方式装出来的是一个 Node.js 包装器，它会自动下载对应平台的 Pyright 二进制。对于只是想给 Claude Code 用、不想折腾 Python 环境的人来说，这是最省事的方案。

## 和 mypy 的区别

Python 社区有两大类型检查工具：mypy 和 Pyright。这个插件选的是 Pyright，理由很实际——Pyright 是 LSP 原生的，启动快，增量分析性能好。mypy 主要是命令行批量检查工具，虽然也有 mypy daemon，但 LSP 支持不如 Pyright 成熟。

不过 Pyright 和 mypy 对类型注解的解读偶尔有出入。如果你的项目 CI 里跑的是 mypy，Pyright 可能报出 mypy 不报的问题，或者反过来。这不是 bug，是两个工具的类型推断策略不同。

## 项目配置

Pyright 读 `pyrightconfig.json` 或 `pyproject.toml` 里的 `[tool.pyright]` 段。关键配置项：

- `pythonVersion`：目标 Python 版本。如果不设，Pyright 会自己猜，但猜错的话某些语法特性的检查结果就不对。
- `pythonPlatform`：目标平台（Linux/Darwin/Windows）。跨平台项目需要注意。
- `venvPath` 和 `venv`：虚拟环境路径。Pyright 需要知道你的虚拟环境在哪，才能正确解析第三方库的类型。
- `typeCheckingMode`：`off`、`basic`、`standard`、`strict`。默认是 `standard`，`strict` 模式会报很多你可能不想处理的问题。

没有配置文件的话，Pyright 会尝试自动检测虚拟环境（找 `.venv`、`venv` 目录），但不一定猜得对。

## 特有功能

- **类型存根（Type Stubs）推断**。对于没有类型注解的第三方库，Pyright 内置了一套 typeshed 存根，覆盖了大部分标准库和常见第三方库。
- **对 `py.typed` 标记的支持**。能正确识别声明了内联类型的包。
- **严格模式下的完整类型检查**。开了 strict 模式，即使代码没写类型注解，Pyright 也会尝试推断并报告不一致。

## 典型场景

Python 项目里 LSP 最有用的场景：你有一个没写类型注解的老项目，想逐步加上 type hints。让 Claude 一个模块一个模块地加注解，加完跑 Pyright 诊断，确保新加的注解和实际使用方式一致。

另一个场景：重构函数签名。Python 的动态类型让重构变得危险——运行时才知道哪里炸了。有 Pyright 的话，至少能在改完后立刻发现类型层面的不兼容。

## 注意事项

- 虚拟环境配置很关键。Pyright 找不到你的 venv，就找不到第三方库的类型定义，满屏都是 `import could not be resolved` 的错误。
- `.pyi` 存根文件和实际实现不一致时，Pyright 会以存根为准。如果你遇到明明运行正常但 Pyright 报错的情况，查一下是不是存根过期了。
- Django、SQLAlchemy 这类大量用元编程的库，Pyright 的分析能力有限。社区有专门的 Pyright 插件（比如 django-stubs）来改善，但效果仍然不如静态类型语言的分析那么精确。
