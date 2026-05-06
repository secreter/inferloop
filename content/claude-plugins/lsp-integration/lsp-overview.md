# LSP 集成概述与通用原理

Claude Code 本身能读写文件、能搜索代码，但它缺一个关键能力：**静态分析**。它不知道一个函数被谁调用了，不知道某个类型的定义在哪，不知道你改了一行代码之后哪些地方会报错。这些事情，IDE 里的语言服务器（Language Server）天天在干。

claude-plugins-official 仓库里一口气提供了 12 个 LSP 插件，覆盖 TypeScript、Python、Go、Rust、C/C++、Java、Kotlin、C#、Ruby、PHP、Swift、Lua。它们的作用一样：把对应语言的语言服务器接入 Claude Code，让 Claude 在改代码之前能先做类型检查、跳转定义、查引用。

## LSP 协议是什么

LSP（Language Server Protocol）是微软在 2016 年从 VS Code 里抽出来的一套协议。核心思路很简单：把语言的智能分析能力（补全、诊断、跳转、重构等）封装成一个独立进程，通过 JSON-RPC 跟编辑器通信。编辑器不需要自己实现每种语言的分析逻辑，语言服务器也不需要关心编辑器的 UI 怎么画。

协议里定义了几十种请求和通知，常用的有这些：

| 请求 | 作用 |
|------|------|
| `textDocument/definition` | 跳转到定义 |
| `textDocument/references` | 查找所有引用 |
| `textDocument/hover` | 获取悬停信息（类型签名、文档） |
| `textDocument/completion` | 代码补全 |
| `textDocument/diagnostic` | 诊断信息（错误、警告） |
| `textDocument/rename` | 重命名符号 |
| `textDocument/signatureHelp` | 函数签名帮助 |
| `textDocument/documentSymbol` | 文件内的符号列表 |
| `workspace/symbol` | 跨文件搜索符号 |

不是所有语言服务器都实现了全部请求。有的服务器只支持诊断和跳转定义，有的几乎全覆盖。后面每个语言章节会具体说。

## Claude Code 为什么需要 LSP

Claude Code 处理代码的工作流大致是这样的：读文件、理解上下文、生成修改、写回文件。问题出在"理解上下文"这一步。

没有 LSP 的时候，Claude Code 只能靠阅读源码文本来推断程序结构。对于小项目、简单逻辑，这够了。但碰到这些情况就吃力了：

- **大型代码库**。一个符号可能在几十个文件里被引用，Claude 不可能把它们全读一遍。LSP 能直接告诉它完整的引用列表。
- **类型推断**。TypeScript、Rust 这种有复杂类型推断的语言，光看代码文本未必能确定一个变量的实际类型。语言服务器早就算好了。
- **错误检测**。Claude 改完代码，如果能立刻跑一次诊断，发现新引入的类型错误，就能当场修掉，不用等用户自己去编译。
- **重构安全性**。改个函数名，哪些文件要跟着改？靠 grep 不靠谱（会匹配到注释、字符串里的同名词），LSP 的 rename 能精确定位语义上的引用。

简单说，LSP 插件把 Claude Code 从"能看代码的助手"升级成了"能理解代码结构的助手"。

## 12 个 LSP 插件的通用架构

先说结论：这 12 个插件的结构几乎一模一样。跟其他插件不同，它们没有 `.claude-plugin/plugin.json`、没有 skills 目录、没有 hooks——每个插件目录下只有 `README.md` 和 `LICENSE` 两个文件。

这意味着它们不是传统意义上的"插件"。LSP 集成的核心逻辑内置在 Claude Code 本身，这些目录更接近于**声明式的注册入口**：告诉 Claude Code 的插件市场"这个语言有对应的语言服务器可用"。实际的 LSP 客户端实现、服务器启动、协议通信全部由 Claude Code 内部处理。

安装一个 LSP 插件后，Claude Code 的工作流程是：

1. **检测文件类型**。根据打开的文件扩展名，判断需要哪个语言服务器。
2. **启动语言服务器进程**。在后台启动对应的 LSP 服务器（比如 `typescript-language-server`、`pyright`、`gopls`），通过 stdio 建立 JSON-RPC 通信。
3. **初始化握手**。发送 `initialize` 请求，交换客户端和服务器的能力（capabilities）。
4. **同步文件状态**。把当前工作区的文件信息同步给服务器。
5. **按需调用**。Claude 在工作过程中需要查定义、查引用、跑诊断时，向语言服务器发送对应的 LSP 请求，拿到结果后纳入上下文。

这个流程对所有 12 个插件都一样。区别只在于：启动的是哪个服务器二进制文件、识别哪些文件扩展名、语言服务器本身支持哪些 LSP 特性。

## 安装的统一套路

安装任何一个 LSP 插件分两步：

**第一步：安装插件本身。**

```bash
/plugin install typescript-lsp@claude-plugins-official
```

或者在 Claude Code 里用 `/plugin > Discover` 浏览安装。所有 12 个 LSP 插件都在 `claude-plugins-official` 仓库的 `/plugins` 目录下。

**第二步：安装语言服务器。**

这是关键。插件本身不包含语言服务器的二进制文件，你得自己装。具体怎么装取决于语言——有的用 npm、有的用 pip、有的用系统包管理器、有的随工具链自带。后面每个语言的章节会详细说。

安装完之后，确保语言服务器的可执行文件在 PATH 里。Claude Code 会自动找到它。

验证方式很直接——在终端里直接运行语言服务器的命令，看看有没有报"找不到"的错：

```bash
# 以 TypeScript 为例
typescript-language-server --version

# 以 Go 为例
gopls version
```

如果命令能正常响应，就没问题了。

## 通用的使用方式

装好插件和语言服务器之后，你不需要显式"调用" LSP。Claude Code 会在合适的时机自动使用它。但了解它在背后做了什么，有助于你判断某个操作的结果是否可靠。

### 诊断（Diagnostics）

这是最高频的用途。Claude Code 修改文件后，可以请求语言服务器对该文件做诊断，拿到错误和警告列表。如果有类型错误或语法问题，Claude 能在同一轮对话里就修掉。

实际体验：你让 Claude 改一个 TypeScript 函数的参数类型，它改完后跑一次诊断，发现有 3 个调用方的类型不匹配，然后自动把那 3 个地方也改了。没有 LSP 的话，它只能改完就交差，你自己跑 `tsc` 才知道出了问题。

### 跳转定义（Go to Definition）

Claude 在分析代码时看到一个不熟悉的函数调用，可以通过 LSP 直接跳到定义处，读取实现细节。比起 grep 搜索，这个方法精确得多——不会被同名的变量或注释误导。

### 查找引用（Find References）

重构的基础。改一个接口、删一个函数之前，先看看谁在用。LSP 返回的是**语义级别**的引用，不是文本匹配——字符串里出现的同名文本不会被算进去。

### 悬停信息（Hover）

获取一个符号的类型签名和文档。对于类型推断很复杂的代码（比如 TypeScript 的条件类型、Rust 的泛型），这比人肉读代码准确。

### 符号搜索（Workspace Symbol）

在整个工作区里按名字搜索符号。比 grep 的优势在于：它只搜索符号（函数、类、变量的定义），不会匹配到注释和字符串。

## 典型使用场景

### 场景一：大规模重构

你告诉 Claude"把所有用到 `UserService.getById()` 的地方改成 `UserService.findById()`"。有 LSP 的话，Claude 会：

1. 用 `textDocument/references` 找到所有调用了 `getById()` 的位置。
2. 逐个修改。
3. 修改完跑 `textDocument/diagnostic`，确认没有遗漏和新引入的错误。

没有 LSP 的话，Claude 只能靠文本搜索，可能漏掉通过变量间接调用的情况，也可能误改字符串里的同名文本。

### 场景二：理解陌生代码库

你打开一个没见过的项目，问 Claude"这个 `processPayment` 函数的调用链是什么"。Claude 可以从该函数出发，沿着 `definition` 和 `references` 链条一路追踪，构建出完整的调用图。

### 场景三：修 Bug 时的类型验证

你报了一个 bug，Claude 找到了疑似问题代码，做了修改。改完之后它用诊断功能验证——既检查自己的修改有没有引入新错误，也确认修改是否解决了原来的类型问题。

### 场景四：跨文件的接口变更

你改了一个接口的字段定义，需要同步更新所有实现类和调用方。Claude 先用引用查找找到所有相关位置，然后逐个更新，最后跑诊断做全局检查。

## 局限性

把话说在前面：

**启动开销**。语言服务器是重量级的进程。Java 的 jdtls 启动一个大项目可能要十几秒甚至更久，Rust 的 rust-analyzer 首次索引大型 crate 也不快。对于快速的问答式交互，这个开销可能不划算。

**内存占用**。语言服务器在后台常驻，吃内存。TypeScript 项目的 tsserver 占几百 MB 很常见；rust-analyzer 对大项目可能吃到 1-2 GB。机器内存紧张的话要留意。

**不是所有操作都需要 LSP**。改个配置文件、写个 README、简单的脚本修改——这些场景下 LSP 帮不上什么忙，反而多了一个后台进程。不是每个对话都需要 LSP 开着。

**服务器版本兼容性**。语言服务器的版本和你项目用的语言版本之间有兼容性要求。比如 TypeScript 5.x 的新语法，旧版 typescript-language-server 可能不认识。保持语言服务器更新是你的责任。

**项目配置影响结果**。语言服务器的表现依赖于项目配置。TypeScript 需要 `tsconfig.json`，Go 需要正确的 `go.mod`，C/C++ 需要 `compile_commands.json`。配置缺失或错误，LSP 的分析结果就不可靠。这不是插件的问题，是语言服务器本身的要求。

下面的 12 个章节，每个语言只讲差异点——安装方式、特有功能、注意事项。通用部分这里已经覆盖了，不再重复。
