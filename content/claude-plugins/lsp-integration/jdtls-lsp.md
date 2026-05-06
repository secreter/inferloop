# jdtls LSP（Java）

**语言服务器**：Eclipse JDT Language Server（jdtls）

**支持的扩展名**：`.java`

## 安装

```bash
# macOS
brew install jdtls

# Arch Linux（AUR）
yay -S jdtls
```

其他 Linux 发行版需要手动安装：

1. 从 [Eclipse JDT.LS 发布页](https://download.eclipse.org/jdtls/snapshots/) 下载最新快照。
2. 解压到一个固定目录，比如 `~/.local/share/jdtls`。
3. 在 PATH 里创建一个名为 `jdtls` 的可执行脚本，指向解压后的启动脚本。

**前置依赖**：JDK 17 或更高版本。注意是 JDK 不是 JRE——jdtls 需要编译器相关的库。

## 特有功能

jdtls 的底层是 Eclipse 的 JDT（Java Development Tools），这是一个经历了 20 多年打磨的 Java 分析引擎：

- **Maven/Gradle 项目感知**。能自动读取 `pom.xml` 或 `build.gradle`，解析依赖，下载缺失的 jar 包。
- **重构能力**。提取方法、提取接口、内联变量、改变方法签名等。这方面 jdtls 是 12 个语言服务器里最强的——Java 社区一直重视 IDE 级别的重构工具。
- **注解处理器支持**。Lombok 之类的注解处理器生成的代码，jdtls 能正确识别。
- **多项目工作区**。能同时打开多个相关的 Maven/Gradle 项目。

## 典型场景

Java 项目通常体量大、类多、继承层次深。不用 LSP 的话，Claude 理解一个 Spring Boot 项目的调用链几乎不可能——光控制反转（IoC）注入的依赖关系就不是看代码文本能理清的。

jdtls 在这种场景下能提供准确的类型层次、接口实现列表、注解处理后的实际代码结构。

## 注意事项

- jdtls 的启动速度是 12 个语言服务器里最慢的。大型 Maven 项目首次启动可能需要下载依赖、建索引，等一两分钟不稀奇。
- 内存占用也偏高。Java 本身就是吃内存大户，jdtls 作为一个 Java 应用更是如此。
- Gradle 项目如果用了自定义插件或特殊配置，jdtls 的项目导入可能失败。这种时候诊断结果不可信。
- 手动安装时，启动脚本的配置比较繁琐（要指定 JDK 路径、数据目录、配置目录）。Homebrew 安装能省掉这些麻烦。
