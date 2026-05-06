# Kotlin LSP

**语言服务器**：kotlin-lsp（JetBrains 官方出品）

**支持的扩展名**：`.kt`、`.kts`

## 安装

```bash
brew install JetBrains/utils/kotlin-lsp
```

目前只提供 Homebrew 安装方式。其他平台需要从 [GitHub 仓库](https://github.com/Kotlin/kotlin-lsp) 获取。

## 特有功能

Kotlin 和 Java 深度互操作，kotlin-lsp 也反映了这一点：

- **Java 互操作分析**。能正确分析 Kotlin 代码调用 Java 类、以及 Java 代码调用 Kotlin 类的场景。
- **Kotlin Script（.kts）支持**。包括 `build.gradle.kts` 这种 Gradle Kotlin DSL 文件。
- **协程（Coroutines）支持**。能正确分析 `suspend` 函数的调用关系。
- **Kotlin DSL 感知**。对使用 Kotlin DSL 特性（带接收者的 lambda 等）的代码能正确推断类型。

## 典型场景

Android 项目和 Kotlin 后端项目（Ktor、Spring Boot with Kotlin）是最常见的用途。

Kotlin 和 Java 混合的项目里，LSP 尤其有用——手动追踪跨语言的调用关系很头疼，kotlin-lsp 能帮忙理清这些引用。

## 注意事项

- kotlin-lsp 是比较新的项目（JetBrains 此前的 Kotlin 分析主要在 IntelliJ 内部），功能完善程度不如 IntelliJ 内置的 Kotlin 插件。
- 对某些 Kotlin 编译器插件（如 KSP 生成的代码）的分析可能不完整。
- 目前安装渠道有限，非 macOS 用户的安装体验不太好。
