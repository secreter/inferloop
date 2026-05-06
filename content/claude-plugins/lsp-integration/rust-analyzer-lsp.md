# rust-analyzer LSP

**语言服务器**：rust-analyzer（Rust 社区开发，现已成为官方推荐的语言服务器）

**支持的扩展名**：`.rs`

## 安装

多种方式：

```bash
# rustup（推荐，和工具链版本绑定）
rustup component add rust-analyzer

# Homebrew（macOS）
brew install rust-analyzer

# Linux 包管理器
sudo apt install rust-analyzer    # Ubuntu/Debian
sudo pacman -S rust-analyzer      # Arch
```

也可以从 [GitHub Releases](https://github.com/rust-lang/rust-analyzer/releases) 下载预编译二进制文件。

用 rustup 安装的好处是版本和 Rust 工具链绑定——切换 nightly/stable 工具链时，rust-analyzer 也会跟着切换。

## 特有功能

rust-analyzer 是这 12 个语言服务器里分析能力最强的之一，原因是 Rust 的类型系统复杂，需要做的推断工作量大：

- **宏展开**。Rust 里宏无处不在（`derive`、`macro_rules!`、过程宏），rust-analyzer 能展开宏并分析展开后的代码。这对理解实际生成的代码很关键——光看宏定义你看不出来它到底生成了什么。
- **生命周期分析**。能推断出省略了的生命周期参数，在 hover 信息里显示完整的生命周期标注。
- **Trait 实现查找**。类似 Go 的接口实现查找，但 Rust 的 trait 系统更复杂（有泛型约束、关联类型等），rust-analyzer 能处理这些。
- **内联类型提示（Inlay Hints）**。在 hover 信息中显示推断出的类型，对于大量使用类型推断的 Rust 代码特别有用。
- **Cargo 特性（features）感知**。能根据启用的 Cargo features 分析对应的条件编译分支。

## 项目配置

rust-analyzer 读 `Cargo.toml`。大部分情况不需要额外配置。但这些场景要注意：

- **Cargo workspace**。多 crate 的 workspace 项目，rust-analyzer 能自动识别，一般不用特别处理。
- **自定义 target**。嵌入式项目（`no_std` 环境）或交叉编译，可能需要在配置里指定目标平台。
- **过程宏**。如果项目定义了过程宏，rust-analyzer 需要先编译过程宏 crate 才能分析用到它的代码。这意味着首次分析会触发一次编译。

## 典型场景

Rust 项目里 LSP 的价值尤其大，因为 Rust 的编译太慢了。每次改完跑 `cargo check` 等几十秒到几分钟是家常便饭。rust-analyzer 做增量分析，延迟低得多，Claude 改完代码能快速拿到诊断结果，不用跑完整编译。

一个具体场景：你在重构一个用了大量泛型的模块，改了一个 trait bound。Claude 通过 rust-analyzer 立刻知道哪些地方不满足新的约束，逐个修改。如果没有 LSP，只能跑编译等报错，一轮轮迭代，效率差很多。

另一个场景：理解宏生成的代码。你用了一个 `#[derive(Serialize)]`，想知道它到底给你的结构体加了什么方法。Claude 可以通过 rust-analyzer 查看宏展开结果。

## 注意事项

- rust-analyzer 对大型项目的内存占用不小，1-2 GB 是常见数字。如果机器内存紧张，这是个问题。
- 首次打开项目时需要建索引，大项目可能要几十秒到几分钟。后续增量更新很快。
- 过程宏的分析需要编译对应的 crate。如果过程宏 crate 编译失败，rust-analyzer 对使用该宏的代码分析会不完整。
- nightly 专属的语法特性，stable 版本的 rust-analyzer 可能不认识。保持 rust-analyzer 版本和使用的工具链版本匹配。
