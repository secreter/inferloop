# Swift LSP

**语言服务器**：SourceKit-LSP（Apple 官方，随 Swift 工具链分发）

**支持的扩展名**：`.swift`

## 安装

SourceKit-LSP 不需要单独安装——它包含在 Swift 工具链里。

```bash
# macOS：装 Xcode 就行，或者单独装 Swift
brew install swift

# Linux：从 swift.org 下载安装 Swift 工具链
```

装完后 `sourcekit-lsp` 应该已经在 PATH 里。验证：

```bash
sourcekit-lsp --help
```

## 特有功能

- **Swift Package Manager 集成**。能读取 `Package.swift`，自动解析包依赖和 target 结构。
- **Objective-C 互操作**。能分析 Swift 代码调用 Objective-C 接口的场景（通过桥接头文件）。
- **Swift Concurrency 支持**。对 `async/await`、`Actor`、`Sendable` 等并发特性有分析能力。

## 典型场景

iOS/macOS 应用开发是主要场景。Swift 项目通常在 Xcode 里开发，但如果你用 Claude Code 辅助修改 Swift 代码（比如服务端 Swift 项目，或者在命令行环境下调整代码逻辑），LSP 能提供必要的类型分析支持。

Swift Package 的开发场景也适用——纯命令行环境下写一个 Swift 包，有 LSP 辅助诊断比没有强得多。

## 注意事项

- SourceKit-LSP 在 Linux 上的功能不如 macOS 完整。某些 Apple 平台特有的框架（UIKit、SwiftUI）的类型信息在 Linux 上不可用——这不奇怪，这些框架本来就只在 Apple 平台上存在。
- Xcode 项目（.xcodeproj / .xcworkspace）的支持不如 Swift Package Manager 项目好。SourceKit-LSP 更擅长处理 SPM 结构的项目。
- 如果你的项目混合了 Swift 和 Objective-C，确保桥接头文件配置正确，否则跨语言的分析会断掉。
