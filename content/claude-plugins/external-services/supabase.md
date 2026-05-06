# 6.5 Supabase

## 定位

Supabase 官方 MCP 集成。直接在 Claude Code 里操作数据库、管理项目，跑 SQL 不用开 Dashboard。

## 核心功能

HTTP 类型远程 MCP 服务器，地址 `mcp.supabase.com/mcp`。覆盖 Supabase 的核心能力：

- 运行 SQL 查询
- 数据库 schema 操作（建表、改表、加索引）
- 项目管理（查看项目列表、配置）
- Auth 用户管理
- Storage bucket 操作
- Edge Function 管理

## 安装与配置

```
/plugin install supabase@claude-plugins-official
```

连接到 `https://mcp.supabase.com/mcp`，认证走 Supabase 的 OAuth 流程。

## 典型使用场景

**场景一：边写代码边改 schema**

开发到一半发现需要加个字段，"给 users 表加一个 avatar_url 列，类型 text，可以为空"。不用切到 Dashboard 或者手写 migration 文件。

**场景二：数据排查**

线上用户反馈数据不对，"查一下 user_id = 'abc123' 的所有 orders，按创建时间倒序"。直接看结果。

**场景三：项目初始化**

新项目起步，"帮我建一个 blog 的 schema：posts 表有 id、title、content、author_id、created_at，comments 表有 id、post_id、body、user_id、created_at，加上外键约束"。Claude 帮你拼好 SQL 执行。

## 注意事项

- SQL 查询直接执行在你的 Supabase 数据库上。生产环境务必小心，Claude 的 `DROP TABLE` 是真的会执行的。
- OAuth 授权的 scope 决定了可操作范围。如果只授了只读权限，写操作会失败。
- 免费版 Supabase 项目有暂停机制（7 天不活跃自动暂停），暂停状态下 MCP 调用会失败。
