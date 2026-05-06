# 6.11 iMessage

## 定位

把 iMessage 接入 Claude Code。直接读取 macOS 的 `chat.db` 数据库获取消息，通过 AppleScript 发送回复。不依赖外部服务器，纯本地运行。**仅限 macOS。**

## 核心功能

本地 stdio 类型 MCP 服务器，Bun 运行。和 Discord/Telegram 不同，这个插件不走任何 API——它直接读 macOS Messages 应用的 SQLite 数据库。

**暴露给 Claude 的工具：**

| 工具 | 用途 |
| --- | --- |
| `reply` | 发送消息。`chat_id` + `text`，可选 `files` 附件。文件作为独立消息发送。 |
| `chat_messages` | 读取聊天历史。可以不传 `chat_guid` 看所有白名单聊天，也可以指定某个聊天。默认每个聊天返回 100 条。这是直接查 SQLite，能拿到完整历史——不只是 bot 启动后的消息。 |

**工作原理：**

| 环节 | 机制 |
| --- | --- |
| 收消息 | 每秒轮询 `chat.db`，查 `ROWID > watermark` 的新行。启动时 watermark 初始化为当前最大 ROWID，不会回放旧消息。 |
| 发消息 | `osascript` 调 Messages.app 的 AppleScript 接口。参数通过 argv 传递，不存在转义问题。 |
| 历史和搜索 | 直接 SQLite 查询 `chat.db`，完整本机历史。 |
| 附件 | `chat.db` 里存着文件的绝对路径。收到的图片路径直接传给 Claude。 |

**访问控制：**

默认策略是 `allowlist`（不是 `pairing`）——因为这是你的个人 `chat.db`，任何人给你发短信都会进数据库。自己给自己发消息始终放行，不需要配置。

## 安装与配置

前置条件：macOS + [Bun](https://bun.sh)

**1. 授权 Full Disk Access**

`chat.db` 受 macOS TCC 保护。首次运行时系统会弹窗请求权限——点"允许"。如果没弹窗或者点了拒绝，手动去：系统设置 → 隐私与安全性 → 完全磁盘访问权限，添加你的终端应用。没有这个权限，服务器直接报 `authorization denied` 退出。

**2. 安装插件**

```
/plugin install imessage@claude-plugins-official
```

不需要任何 token 或 API key。

**3. 以 channel 模式启动**

```bash
claude --channels plugin:imessage@claude-plugins-official
```

**4. 给自己发消息测试**

用任何设备上的 iMessage 给自己发条消息，Claude 应该能收到。首次回复时系统会弹一个 Automation 权限弹窗（"终端要控制 Messages"），点 OK。

**5. 添加其他联系人**

```
/imessage:access allow +15551234567
/imessage:access allow friend@icloud.com
```

handle 地址是手机号（带国际区号和 `+`）或 Apple ID 邮箱。

## 典型使用场景

**场景一：个人助手**

给自己发消息就是和 Claude 对话。手机上用 iMessage 发"帮我查一下今天有没有新的 GitHub notification"，Claude 在 Mac 上执行并把结果发回来。

**场景二：消息搜索**

"帮我找一下和小明的聊天记录里提到'合同'的消息"——`chat_messages` 直接查 SQLite，全量历史都能搜。

**场景三：家庭/小团队 bot**

允许几个家人的 iMessage 地址，他们发消息过来 Claude 帮忙回答问题。

## 注意事项

- **仅 macOS**，没有任何跨平台方案。
- AppleScript 只能发消息，不能发 tapback（点赞/爱心反应）、不能编辑消息、不能回复到某条消息的 thread。要这些功能需要 [BlueBubbles](https://bluebubbles.app)，但那需要关 SIP。
- `IMESSAGE_ALLOW_SMS` 默认关闭。SMS/RCS 的发送者 ID 可以被伪造——如果有人伪造你自己的号码发 SMS，会绕过自聊天的访问控制。除非你清楚风险，不要开。
- 默认会在每条回复末尾追加 `\nSent by Claude` 签名。设 `IMESSAGE_APPEND_SIGNATURE=false` 关闭。
- `chat.db` 在 macOS 更新后偶尔会变 schema（比如 `text` 列为空改用 `attributedBody`）。插件代码里做了兼容处理，但不排除未来的 macOS 版本再改。
- 群聊里 iMessage 没有结构化的 @提及。开启群聊时如果用 `requireMention: true`，必须同时配置 `mentionPatterns` 正则，否则没有任何消息能匹配。
