# clangd LSP

**语言服务器**：clangd（LLVM 项目的一部分）

**支持的扩展名**：`.c`、`.h`、`.cpp`、`.cc`、`.cxx`、`.hpp`、`.hxx`、`.C`、`.H`

## 安装

```bash
# macOS（装完整个 LLVM 工具链）
brew install llvm
# 然后加到 PATH：export PATH="/opt/homebrew/opt/llvm/bin:$PATH"

# Ubuntu/Debian
sudo apt install clangd

# Fedora
sudo dnf install clang-tools-extra

# Arch
sudo pacman -S clang

# Windows
winget install LLVM.LLVM
```

不同发行版的包名不一样——有的叫 `clangd`，有的藏在 `clang-tools-extra` 或 `clang` 包里。

## 特有功能和局限

clangd 和其他语言服务器最大的区别在于：**它高度依赖编译数据库**。

C/C++ 没有统一的构建系统——CMake、Make、Bazel、Meson、手写 Makefile，各种各样。clangd 需要知道每个源文件是用什么编译选项编译的（包含路径、宏定义、标准版本等），这些信息存在 `compile_commands.json` 文件里。

没有 `compile_commands.json`，clangd 的分析能力大打折扣。头文件找不到、宏定义不对、模板推断出错，都是常见问题。

生成 `compile_commands.json` 的方法：

```bash
# CMake 项目
cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -B build

# Make 项目，用 Bear 工具
bear -- make

# Bazel 项目，用 bazel-compile-commands-extractor
```

生成后把 `compile_commands.json` 放到项目根目录（或者用 `.clangd` 配置文件指定路径）。

## 项目配置

clangd 的配置通过项目根目录的 `.clangd` 文件：

```yaml
CompileFlags:
  Add: [-std=c++20, -Wall]
  Remove: [-W*]
Diagnostics:
  ClangTidy:
    Add: [modernize-*, performance-*]
```

这个配置可以覆盖或补充 `compile_commands.json` 里的编译选项。

## 典型场景

C/C++ 项目是最需要 LSP 辅助的语言之一。头文件层层嵌套、模板元编程、宏展开——这些光看源码文本几乎不可能准确理解。

一个场景：你改了一个头文件里的结构体定义，需要知道哪些 `.cpp` 文件会受影响。clangd 的引用查找能做到，文本搜索做不到（因为 `#include` 是传递性的）。

另一个：模板特化。一个模板函数有多个特化版本，你想知道某个调用实际会匹配到哪个特化。clangd 能给出答案。

## 注意事项

- 没有 `compile_commands.json` 就别指望 clangd 能正常工作。这是大前提。
- 头文件搜索路径配置不对是最常见的问题来源。clangd 报 `file not found` 时，先查编译数据库。
- clangd 对某些复杂的模板元编程分析不完整——这不能怪 clangd，C++ 的模板系统本来就是图灵完备的。
- 如果项目同时有 C 和 C++ 文件，注意 `.h` 文件可能被当作 C 或 C++ 来分析，取决于编译数据库里的设置。
