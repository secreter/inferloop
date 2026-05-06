# C# LSP

**语言服务器**：csharp-ls（社区项目，不是微软的 OmniSharp）

**支持的扩展名**：`.cs`

## 安装

```bash
# .NET 全局工具（推荐）
dotnet tool install --global csharp-ls

# macOS
brew install csharp-ls
```

**前置依赖**：.NET SDK 6.0 或更高版本。

## 和 OmniSharp 的关系

C# 社区最知名的语言服务器是 OmniSharp，但这个插件用的是 csharp-ls。两者的区别：csharp-ls 更轻量，用 Roslyn API 做分析但不需要完整的 MSBuild 工具链。对于 Claude Code 这种场景——主要需要诊断、定义跳转、引用查找——csharp-ls 够用了，而且启动快、占用资源少。

OmniSharp 的优势在于对复杂 .NET 项目（多 target framework、自定义 MSBuild 属性）的支持更好。如果你的项目结构很复杂，遇到 csharp-ls 分析不准的情况，可以考虑装 OmniSharp 替代。

## 项目配置

csharp-ls 读 `.csproj` 或 `.sln` 文件来理解项目结构。确保项目根目录下有正确的解决方案文件或项目文件。

## 典型场景

.NET 项目重构——改接口、改 DTO 字段、更新 LINQ 查询的类型。C# 是强类型语言，LSP 能在编译前就捕获类型错误。

Unity 项目也能用，但 Unity 的项目结构比较特殊（有自己生成 .csproj 的方式），csharp-ls 的支持程度取决于生成的项目文件是否规范。

## 注意事项

- `dotnet restore` 必须先跑成功。NuGet 包没恢复的话，csharp-ls 找不到依赖的类型定义。
- 对 source generators（C# 的代码生成机制）的支持有限。如果项目重度依赖 source generators，分析结果可能不完整。
- 多 target framework 项目（比如同时支持 .NET 6 和 .NET 8），csharp-ls 可能只分析其中一个 target 的代码。
