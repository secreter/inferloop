# Ruby LSP

**语言服务器**：ruby-lsp（Shopify 开发维护）

**支持的扩展名**：`.rb`、`.rake`、`.gemspec`、`.ru`、`.erb`

## 安装

```bash
# gem（推荐）
gem install ruby-lsp

# 或者加到项目 Gemfile
# group :development do
#   gem 'ruby-lsp'
# end
# 然后 bundle install
```

**前置依赖**：Ruby 3.0 或更高版本。

## 特有功能

- **ERB 模板支持**。这是其他语言服务器没有的——ruby-lsp 能分析 `.erb` 文件里嵌入的 Ruby 代码。对 Rails 项目来说很实用。
- **Rake 文件分析**。`.rake` 文件也在支持范围内。
- **插件体系**。ruby-lsp 自身有插件机制，社区贡献了 Rails 专用插件（ruby-lsp-rails），能理解 Active Record 模型、路由等 Rails 特有的概念。

## 典型场景

Ruby 是动态类型语言，类型检查能力天然弱于 TypeScript、Rust 这些。ruby-lsp 提供的主要是结构性分析——定义跳转、引用查找、文件符号——而不是深度的类型诊断。

对 Rails 项目来说，最有用的场景是理解路由和控制器的对应关系、追踪模型的关联定义、在视图模板里分析嵌入的 Ruby 代码。

## 注意事项

- Ruby 的元编程（`method_missing`、`define_method` 动态定义方法）是 LSP 分析的盲区。语言服务器看不到运行时动态创建的方法。
- Rails 项目最好装 ruby-lsp-rails 插件来增强分析能力。光装 ruby-lsp 对 Rails 特有的 DSL（`has_many`、`belongs_to`、`scope` 等）理解有限。
- Bundler 环境下要确保 ruby-lsp 的版本和项目的 Ruby 版本兼容。
