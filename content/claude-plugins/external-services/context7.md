# 6.14 Context7

## 定位

Upstash 出品的文档查询 MCP 服务器。从源码仓库拉取特定版本的文档和代码示例，直接注入到 Claude 的上下文里。解决的问题是：LLM 的训练数据有截止日期，而你用的库可能昨天刚发了新版。

## 核心功能

本地 stdio 类型 MCP 服务器，通过 `npx -y @upstash/context7-mcp` 启动。

核心能力就一个：**查文档**。但它查的不是缓存的旧数据，而是直接从上游仓库拉取的最新文档。

- 按库名搜索文档（比如搜 "next.js" 或 "prisma"）
- 获取特定版本的 API 文档
- 拉取代码示例
- 返回的内容直接作为 Claude 的上下文

## 安装与配置

```
/plugin install context7@claude-plugins-official
```

前置条件：Node.js（npx 可用）。

不需要 API key，不需要注册账号。开箱即用。

## 典型使用场景

**场景一：用新版 API 写代码**

你在用 Next.js 15，但 Claude 训练数据可能只到 14。"查一下 Next.js 15 的 Server Actions 怎么用"——Context7 拉取最新文档，Claude 据此给出正确答案。

**场景二：确认 API 变更**

"Prisma 5.x 的 `findMany` 参数和 4.x 有什么变化"——直接对比两个版本的文档。

**场景三：避免幻觉**

Claude 可能会编造不存在的 API 参数。有了 Context7，它可以先查文档再回答。

## 注意事项

- 文档覆盖范围取决于 Context7 收录了哪些库。主流框架和库基本都有，冷门的不一定。
- 每次查询都走网络请求拉取文档，响应速度取决于网络状况和目标仓库的大小。
- 免费使用，但 Upstash 可能会有请求频率限制。
- `npx` 每次拉最新版，首次启动时需要下载。
