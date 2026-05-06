# 6.13 Laravel Boost

## 定位

Laravel 开发辅助 MCP 服务器。从 Claude Code 里运行 Artisan 命令、操作 Eloquent、管理路由和 migration——直接和你的 Laravel 项目交互。

## 核心功能

本地 stdio 类型 MCP 服务器，启动方式是 `php artisan boost:mcp`。这意味着它跑在你的 Laravel 项目内部，作为一个 Artisan 命令存在。

可能提供的能力包括：

- 运行 Artisan 命令
- Eloquent 模型查询
- 路由信息查看
- Migration 管理
- 框架特定的代码生成

## 安装与配置

```
/plugin install laravel-boost@claude-plugins-official
```

前置条件：
1. PHP 环境
2. 一个 Laravel 项目（`artisan` 文件存在于当前目录）
3. 需要先在 Laravel 项目里安装 `laravel-boost` 这个 Composer 包——否则 `artisan boost:mcp` 会报命令不存在

安装 Composer 包（在你的 Laravel 项目里）：

```bash
composer require laravel-boost/laravel-boost
```

不需要额外的 API key。一切操作都在本地。

## 典型使用场景

**场景一：快速脚手架**

"帮我创建一个 Post model，带 migration、controller 和 resource"——Claude 通过 Artisan 命令一次性生成。

**场景二：数据库查询调试**

"用 Eloquent 查一下 users 表里 created_at 在最近 7 天的记录有多少"——不用打开 tinker 或写临时脚本。

**场景三：路由审查**

"列一下所有注册的路由，看看有没有缺少 auth middleware 的 API 端点"。

## 注意事项

- 插件通过 `php artisan` 运行，必须在 Laravel 项目根目录下才能工作。如果你的工作目录不对，命令会失败。
- 这是在你的应用环境里执行代码，连的是你配置的数据库。对生产环境的 `.env` 要当心。
- Composer 包需要和你的 Laravel 版本兼容。具体支持哪些版本请查看包的文档。
