# 6.15 Serena

## 定位

Oraios 开发的语义级代码分析 MCP 服务器。通过 Language Server Protocol（LSP）提供代码理解、重构建议和代码库导航。比单纯的文本搜索更智能——它理解代码结构。

## 核心功能

通过 `uvx`（Python 包运行器）启动，从 GitHub 仓库直接安装运行。底层接入 LSP，提供：

- 语义级代码导航（跳转定义、查找引用、查看类型）
- 代码结构分析（类继承树、接口实现）
- 重构建议
- 符号搜索（不是文本搜索，是按函数名/类名/变量名搜）

## 安装与配置

```
/plugin install serena@claude-plugins-official
```

前置条件：
1. Python 环境（`uvx` 可用）。`uvx` 是 `uv` 工具链的一部分，安装 `uv`：`curl -LsSf https://astral.sh/uv/install.sh | sh`
2. 你的项目需要有对应语言的 LSP server 可用（比如 Python 项目需要 pyright/pylsp，TypeScript 需要 tsserver）

不需要 API key，纯本地运行。

启动命令是 `uvx --from git+https://github.com/oraios/serena serena start-mcp-server`，首次运行会从 GitHub 克隆代码并安装依赖，需要一些时间。

## 典型使用场景

**场景一：代码探索**

接手一个陌生项目，"这个 `UserService` 类被哪些地方调用了"——语义级搜索，比 grep 准确，不会匹配到注释里的同名字符串。

**场景二：重构前评估**

"如果我把 `processOrder` 这个方法的签名改了，会影响哪些文件"——通过 LSP 的引用查找给出完整的影响范围。

**场景三：类型理解**

"这个变量的类型是什么，从哪里推导出来的"——LSP 提供的类型信息比静态分析更准确。

## 注意事项

- 依赖 LSP，对不同语言的支持程度不同。Python 和 TypeScript 支持最好，其他语言看 LSP server 的成熟度。
- 首次启动从 GitHub 安装，需要网络。后续有缓存会快一些。
- 大型代码库的 LSP 索引建立需要时间和内存。几万行代码的项目还好，百万行级别的可能会慢。
- 这是一个相对早期的项目，可能存在边界情况处理不完善的问题。
