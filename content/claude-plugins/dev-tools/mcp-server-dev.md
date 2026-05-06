# mcp-server-dev：MCP 服务器开发向导

一句话：这是一个纯指令型插件，用三个 Skill 引导 Claude 帮你从零设计和搭建 MCP 服务器——从选型到部署，全程在对话里完成。

## 技术原理

mcp-server-dev 没有一行可执行代码。它的全部内容是三个 Skill（`build-mcp-server`、`build-mcp-app`、`build-mcpb`）和一批参考文档。当你在 Claude Code 里说"帮我建一个 MCP server"，`build-mcp-server` 这个入口 Skill 被触发，Claude 加载它的 SKILL.md 拿到一套结构化的引导流程，然后按阶段跟你对话。

三个 Skill 的分工：

| Skill | 干什么 |
|---|---|
| `build-mcp-server` | 入口。问你的场景，选部署模型（远程 HTTP / MCPB / 本地 stdio），选工具设计模式，然后路由到对应的子 Skill 或直接内联脚手架 |
| `build-mcp-app` | 在 MCP 服务器上加交互式 UI 组件（表单、选择器、确认对话框），通过 iframe 渲染在聊天界面里 |
| `build-mcpb` | 把本地 stdio 服务器打包成 .mcpb 文件，连运行时一起捆绑，用户不需要装 Node/Python |

SKILL.md 里的指令分为 5 个阶段（Phase）：

1. **需求审问** —— 连接什么（云 API / 本地进程 / 硬件）、谁用、动作数量多少、需不需要中途用户交互、上游认证方式
2. **推荐部署模型** —— 默认推远程 streamable-HTTP，有明确理由才推 MCPB 或 MCP app
3. **选工具设计模式** —— 动作少于 15 个用一个工具对应一个动作；几十上百个动作用 search + execute 两把刀
4. **选框架** —— TypeScript SDK（`@modelcontextprotocol/sdk`）或 Python FastMCP 3.x
5. **脚手架生成和交接** —— 根据前面的决定，要么直接在当前会话里生成代码，要么交给 `build-mcp-app` 或 `build-mcpb`

每个阶段还附带 references 目录下的专题文档：OAuth 认证流程（CIMD / DCR）、工具描述写法、Cloudflare Workers 部署、Widget 模板、manifest schema、elicitation 用法等等。这些文档在 Claude 需要细节时按需加载。

核心设计思路是：MCP 服务器的形态太多，选错了后面要大改。这个插件把"先搞清楚该建什么"这件事流程化了。

## 安装与配置

插件本身不需要配置。安装到 Claude Code 后即可使用：

```bash
cc --plugin-dir /path/to/mcp-server-dev
```

或通过 Claude Code Marketplace 自动发现。

## 使用方法

直接对 Claude 说：

```
帮我建一个 MCP server，包装 GitHub API
```

Claude 会自动进入 `build-mcp-server` 的引导流程。也可以显式调用：

```
/mcp-server-dev:build-mcp-server
```

如果你已经知道要建带 UI 的 MCP app：

```
/mcp-server-dev:build-mcp-app
```

打包本地服务器：

```
/mcp-server-dev:build-mcpb
```

一个典型的对话流程：

1. Claude 一次性问你 5 个问题（连什么、谁用、多少动作、需不需要 UI、什么认证）
2. 你回答后，Claude 给出一个推荐（比如"远程 HTTP + 一个动作一个工具 + TypeScript SDK"）
3. 确认后，Claude 用内联的 scaffold 模板直接生成项目代码
4. 如果选了 MCP app，Claude 会额外生成 widget HTML 和 ext-apps 集成代码
5. 如果选了 MCPB，Claude 生成 manifest.json 和打包脚本

生成的远程 HTTP 服务器脚手架大致长这样：

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const server = new McpServer(
  { name: "my-service", version: "0.1.0" },
  { instructions: "说明 Claude 应该怎么用这些工具" },
);

server.registerTool("search_items", {
  description: "按关键词搜索。返回最多 limit 条结果。",
  inputSchema: {
    query: z.string(),
    limit: z.number().int().min(1).max(50).default(10),
  },
  annotations: { readOnlyHint: true },
}, async ({ query, limit }) => {
  const results = await upstreamApi.search(query, limit);
  return { content: [{ type: "text", text: JSON.stringify(results) }] };
});

const app = express();
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.listen(3000);
```

## 使用场景

**包装一个 SaaS API 给 Claude 用。** 比如你有个内部的工单系统，REST API 有 10 来个端点。Claude 会推荐远程 HTTP + 一个工具一个动作的模式，直接生成对接代码。

**给大型 API 建 MCP 接口。** Stripe 有几百个 API 端点，全列成工具会撑爆上下文。Claude 会推荐 search + execute 模式：一个工具搜索可用动作，一个工具按 ID 执行。

**需要在聊天里嵌入交互 UI。** 比如做一个联系人选择器，用户在聊天界面里看到一个列表、点选、结果返回给 Claude。这时候会路由到 `build-mcp-app`，生成 widget HTML 和 `@modelcontextprotocol/ext-apps` 的集成代码。

**需要分发一个本地工具。** 你写了个读本地文件的 MCP 服务器，想让同事不装 Node 就能用。路由到 `build-mcpb`，生成 manifest.json 和打包脚本，最后 `npx @anthropic-ai/mcpb pack` 出一个 .mcpb 文件。

**快速部署到 Cloudflare Workers。** 参考文档里有完整的 Workers 部署路径，两条命令从零到上线。

## 局限与注意事项

**它不写代码，它教 Claude 怎么写代码。** 所有生成的代码都是 Claude 在对话中即时产出的，不是预置的模板文件。这意味着输出质量取决于 Claude 当次的表现。参考文档越详细，输出越稳定，但不能保证每次都完美。

**Elicitation 的宿主支持还没铺开。** SKILL.md 里明确写了 elicitation 在 Claude Code >= 2.1.76 才支持，Desktop 端还不确定。如果你的目标用户用的是不支持 elicitation 的客户端，得准备 fallback 方案。

**MCPB 没有沙箱。** manifest.json 里没有 permissions 字段，打包后的服务器拿到的是用户的完整权限。路径校验、spawn 白名单全靠你自己在代码里实现。

**MCP app 的 widget 调试很痛。** iframe 的 CSP 限制是 widget 白屏的头号原因，而且错误不会出现在主控制台。得打开 iframe 自己的 devtools 才能看到。Claude Desktop 还会缓存 UI 资源，改了 HTML 必须完全退出重启才能刷新。

**版本敏感。** 插件专门维护了一个 `references/versions.md` 文件，列出所有版本相关的声明。ext-apps 的 CDN pin、MCPB manifest schema 版本、Cloudflare 模板路径——这些都可能过时。
