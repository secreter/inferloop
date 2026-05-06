# PHP LSP

**语言服务器**：Intelephense（PHP 社区最流行的语言服务器）

**支持的扩展名**：`.php`

## 安装

```bash
npm install -g intelephense
```

或者：

```bash
yarn global add intelephense
```

Intelephense 是一个 Node.js 程序，所以用 npm/yarn 安装。它不需要 PHP 运行时来做分析——内部有自己的 PHP 解析器。

## 特有功能

- **内置的 PHP 标准库存根**。Intelephense 自带了完整的 PHP 内置函数和类的类型定义，不需要额外配置。
- **Composer 依赖解析**。能读取 `composer.json` 和 `vendor/` 目录里的自动加载配置，正确解析第三方包的类型。
- **PHP 8.x 语法支持**。联合类型、命名参数、枚举、纤程（Fibers）等新语法都能正确分析。

## 免费版 vs 付费版

Intelephense 有免费版和付费版（Premium）。免费版覆盖了 Claude Code 需要的核心功能——诊断、定义跳转、引用查找、悬停信息。付费版额外提供的功能（如重命名、代码操作）对 Claude Code 的集成影响不大。

## 典型场景

PHP 项目，尤其是 Laravel 或 Symfony 这种大框架，文件多、类多、依赖注入层层嵌套。LSP 在这种场景下帮助 Claude 追踪服务注入关系、理解门面（Facade）背后的实际类。

另一个场景：PHP 版本升级。从 PHP 7 升到 PHP 8，很多废弃语法和类型变更需要处理。让 Claude 跑一遍诊断，拿到完整的兼容性问题列表。

## 注意事项

- Intelephense 对 Laravel 的魔术方法（`__call`、`__get`）和门面模式的分析有限。社区有 IDE helper 包（`barryvdh/laravel-ide-helper`）可以生成辅助文件改善这个问题。
- `vendor/` 目录必须存在（跑过 `composer install`），否则第三方依赖的类型都找不到。
- PHP 项目如果没有类型声明（老项目常见），LSP 的诊断能力会很弱。Intelephense 能做一些推断，但精确度远不如有完整类型声明的代码。
