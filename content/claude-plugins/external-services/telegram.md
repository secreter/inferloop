# 6.10 Telegram

## 定位

Telegram bot 消息通道插件。和 Discord 插件同一类东西——把 Telegram bot 接入 Claude Code，消息双向桥接，带访问控制。

## 核心功能

本地 stdio 类型 MCP 服务器，Bun 运行，底层用 [grammY](https://grammy.dev/) 框架。

**暴露给 Claude 的工具：**

| 工具 | 用途 |
| --- | --- |
| `reply` | 发送消息。支持 `reply_to` 引用、`files` 附件。图片（jpg/png/gif/webp）自动作为 photo 发送带预览，其他类型走 document。单文件最大 50MB。 |
| `react` | 加 emoji 反应。只支持 Telegram 固定白名单里的 emoji（👍❤🔥👀 等），用别的不会报错但也不会生效。 |
| `edit_message` | 编辑 bot 之前发送的消息。 |

和 Discord 的关键区别：**没有 `fetch_messages` 工具**。Telegram Bot API 不暴露消息历史和搜索，bot 只能看到实时到达的消息。如果 Claude 需要之前的上下文，只能请你复述。

**照片处理：** 收到的照片自动下载到 `~/.claude/channels/telegram/inbox/`，路径直接传给 Claude。Telegram 会压缩照片；如果需要原图，发送时选"以文件方式发送"。

## 安装与配置

前置条件：[Bun](https://bun.sh)

**1. 创建 bot**

在 Telegram 上找 [@BotFather](https://t.me/BotFather)，发 `/newbot`，按提示设置名称和用户名（必须以 `bot` 结尾）。BotFather 回复的 token 格式如 `123456789:AAHfiqksKZ8...`。

**2. 安装插件**

```
/plugin install telegram@claude-plugins-official
/reload-plugins
```

**3. 配置 token**

```
/telegram:configure 123456789:AAHfiqksKZ8...
```

写入 `~/.claude/channels/telegram/.env`。

**4. 以 channel 模式启动**

```bash
claude --channels plugin:telegram@claude-plugins-official
```

**5. 配对**

在 Telegram 上给 bot 发私信，收到 6 位配对码后：

```
/telegram:access pair <code>
```

然后锁定策略：

```
/telegram:access policy allowlist
```

## 典型使用场景

**场景一：手机端远程控制**

Telegram 客户端跨平台且通知即时。出门在外通过手机给 bot 发指令，Claude 在你的服务器上干活。

**场景二：图片分析**

拍张照片发给 bot，Claude 下载后用 Read 工具查看，分析内容。比如拍一段报错截图让它帮你排查。

**场景三：群组助手**

在技术讨论群里加入 bot，设好 mention 规则，群成员 @bot 提问。注意需要在 BotFather 里关掉 Privacy Mode 才能让 bot 看到所有群消息（不只是 @提及的）。

## 注意事项

- Telegram Bot API 同一个 token 只允许一个 getUpdates 消费者。如果旧进程没退干净（比如终端直接关了），新启动会遇到 409 Conflict。插件代码里有处理——通过 PID 文件检测并杀掉旧进程，但偶尔可能需要手动清理。
- 没有消息历史回看能力。这是 Telegram Bot API 的硬限制，不是插件的问题。
- 群组里 `requireMention: true` 是默认值，且和 Telegram 服务端的 Privacy Mode 配合。如果改成 `--no-mention`，必须同时去 BotFather 关掉 Privacy Mode，否则消息根本不会到达 bot。
- `ackReaction` 只能用 Telegram 的固定 emoji 白名单。自定义 emoji 和不在列表里的 unicode emoji 会被静默忽略。
