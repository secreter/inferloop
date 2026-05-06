# 6.16 Fakechat

## 定位

本地 Web 聊天界面，用于测试 Claude Code 的 channel 机制。不连接任何外部服务，打开浏览器就能用。这是一个开发调试工具，不是正式的消息通道。

## 核心功能

本地 stdio 类型 MCP 服务器，Bun 运行。启动后在 `localhost:8787` 提供一个极简的 iMessage 风格聊天页面。

**暴露给 Claude 的工具：**

| 工具 | 用途 |
| --- | --- |
| `reply` | 发送消息到浏览器 UI。支持 `reply_to` 引用和 `files` 附件（单文件 50MB 限制）。 |
| `edit_message` | 编辑之前发送的消息。 |

**它怎么工作的：**

浏览器通过 WebSocket 连到 localhost 服务器。你在网页上打字，服务器通过 MCP 的 channel notification 把消息传给 Claude。Claude 调用 `reply` 工具，消息通过 WebSocket 推回浏览器。

文件上传走 HTTP POST `/upload`，保存到 `~/.claude/channels/fakechat/inbox/`。回复里的附件拷到 `outbox/` 并通过 HTTP 提供下载。

## 安装与配置

```
/plugin install fakechat@claude-plugins-official
```

以 channel 模式启动：

```bash
claude --channels plugin:fakechat@claude-plugins-official
```

启动后 stderr 会输出：

```
fakechat: http://localhost:8787
```

打开这个地址就行了。改端口用环境变量 `FAKECHAT_PORT`。

不需要 token，不需要注册，没有访问控制。

## 典型使用场景

**场景一：channel 插件开发测试**

你在开发自己的 channel 插件，想验证 channel notification、reply 工具、文件上传下载这些机制是否正常。fakechat 是最快的验证手段——不用去建 Discord bot 或 Telegram bot。

**场景二：演示 channel 功能**

给同事演示 Claude Code 的 channel 能力时，fakechat 零配置就能跑起来，比折腾真实平台方便。

**场景三：文件交互测试**

测试附件上传和下载流程。网页上点"attach"选文件，看 Claude 能不能正确接收和处理。

## 注意事项

- 这不是正式的消息通道。没有消息历史、没有搜索、没有 access.json、没有 skill。刷新页面一切清空。
- 单浏览器 tab 设计。开第二个 tab 不会同步消息（WebSocket 连接各自独立，但 deliver 会 broadcast 到所有 tab）。
- 只绑定 `127.0.0.1`，局域网内其他机器访问不了。这是刻意的——毕竟没有任何认证。
- HTML/JS 直接内嵌在 `server.ts` 里，一共不到 300 行代码。如果想改 UI 样式，直接改源码。
