# gopls LSP

**语言服务器**：gopls（Go 官方语言服务器，读作"go please"）

**支持的扩展名**：`.go`

## 安装

```bash
go install golang.org/x/tools/gopls@latest
```

装完后确保 `$GOPATH/bin`（默认是 `$HOME/go/bin`）在 PATH 里。验证：

```bash
gopls version
```

gopls 是 Go 官方维护的，跟 Go 工具链的版本配合最好。用系统包管理器装的版本可能偏旧，建议直接用 `go install` 装最新的。

## 特有功能

Go 的语言特性决定了 gopls 有些别的语言服务器没有的能力：

- **go.mod 感知**。gopls 理解 Go modules 的依赖管理，能正确解析跨模块的引用，也能提示 `go.mod` 里的依赖版本问题。
- **接口实现查找**。Go 的接口是隐式实现的（不用显式 `implements`），这意味着光看代码很难知道哪些类型实现了某个接口。gopls 能告诉你。这对理解大型 Go 项目特别有用。
- **内嵌结构体分析**。Go 里结构体嵌套后，方法会被提升（promoted），gopls 能正确追踪这种隐式的方法关系。
- **`go generate` 相关支持**。能识别 `//go:generate` 指令。

## 项目配置

gopls 几乎不需要额外配置，它直接读 `go.mod` 来理解项目结构。但有几个场景需要注意：

- **多模块工作区**。如果你的仓库里有多个 `go.mod`（monorepo），需要用 Go 1.18+ 的 workspace 特性，创建一个 `go.work` 文件。否则 gopls 只能看到其中一个模块。
- **构建标签（Build Tags）**。如果代码用了 `//go:build` 标签做条件编译，gopls 默认可能不分析带标签的文件。可以在 gopls 的配置里设置 `buildFlags`。
- **CGO**。用了 CGO 的项目，gopls 需要系统上有 C 编译器。没有的话，CGO 相关的代码会报错。

## 典型场景

Go 项目里最能体现 LSP 价值的场景是**接口重构**。你改了一个接口的方法签名，哪些实现类型需要跟着改？在 Go 里没有 `implements` 关键字，纯文本搜索找不到。gopls 能精确列出所有实现了这个接口的类型。

另一个场景：错误处理审查。Go 里满天飞的 `if err != nil`，你想确认某个函数的所有错误路径都处理了。Claude 可以用 LSP 追踪函数调用链，逐层检查错误处理。

## 注意事项

- gopls 的内存占用跟项目规模成正比。对于超大型 Go 仓库（Google 规模的那种），gopls 可能会很吃内存。普通项目不需要担心。
- 首次打开大项目时，gopls 需要下载依赖（`go mod download`）并建索引，可能要等一会儿。
- 如果 `go.sum` 和 `go.mod` 不一致（比如有人加了依赖但没提交 `go.sum`），gopls 的分析结果会出问题。保持这两个文件同步是基本功。
