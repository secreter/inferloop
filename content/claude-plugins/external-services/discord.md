# 6.9 Discord

## 定位

Discord 消息通道插件。把 Discord bot 接入 Claude Code，别人在 Discord 发消息，Claude 能收到并回复。本质上是一个消息桥接器，带完整的访问控制。

## 核心功能

本地 stdio 类型 MCP 服务器，用 Bun 运行，底层是 discord.js。属于 Claude Code 的 "channel" 类插件——不是普通的工具插件，而是一个消息入口。

**暴露给 Claude 的工具：**

| 工具 | 用途 |
| --- | --- |
| `reply` | 发送消息到 Discord 频道。支持 `reply_to` 引用回复，支持 `files` 附件（最多 10 个，每个 25MB）。长文本自动分片。 |
| `react` | 给某条消息加 emoji 反应。 |
| `edit_message` | 编辑 bot 之前发送的消息。适合"处理中…"→ 结果的进度更新。 |
| `fetch_messages` | 拉取频道的历史消息（最多 100 条，时间正序）。每条带 message ID，方便 `reply_to` 引用。 |
| `download_attachment` | 下载指定消息的附件到本地 `~/.claude/channels/discord/inbox/`。 |

附件不自动下载。`fetch_messages` 会标记哪些消息有附件（`+Natt`），Claude 按需调用 `download_attachment`。

**访问控制体系：**

插件自带完整的权限管理，通过 `/discord:access` skill 操作。核心概念：

- **DM 策略**：`pairing`（默认，陌生人发消息会收到配对码）、`allowlist`（静默丢弃）、`disabled`（全部关闭）
- **用户白名单**：通过 Discord snowflake ID 管理
- **Guild 频道**：默认关闭，按频道 ID 逐个开启，支持 `requireMention` 控制是否只响应 @提及

## 安装与配置

前置条件：[Bun](https://bun.sh)

**1. 创建 Discord Bot**

去 [Discord Developer Portal](https://discord.com/developers/applications) 新建 Application，在 Bot 页面启用 **Message Content Intent**（不开这个 bot 收到的消息内容是空的）。

**2. 生成 token 并邀请 bot**

Bot 页面点 Reset Token 拿到 token。OAuth2 → URL Generator 里勾选 `bot` scope 和必要权限（View Channels、Send Messages、Read Message History、Attach Files、Add Reactions），生成链接邀请 bot 到你的 server。

**3. 安装插件**

```
/plugin install discord@claude-plugins-official
/reload-plugins
```

**4. 配置 token**

```
/discord:configure MTIz...
```

token 写入 `~/.claude/channels/discord/.env`。也可以手动写这个文件或设置 `DISCORD_BOT_TOKEN` 环境变量。

**5. 以 channel 模式启动**

```bash
claude --channels plugin:discord@claude-plugins-official
```

必须用 `--channels` 参数启动，否则 MCP 服务器不会连接 Discord Gateway。

**6. 配对**

在 Discord 上给 bot 发私信，它回复一个 6 位配对码。在 Claude Code 里执行：

```
/discord:access pair <code>
```

配对成功后，建议立即切换到 `allowlist` 策略：

```
/discord:access policy allowlist
```

## 典型使用场景

**场景一：手机远程操控 Claude Code**

人不在电脑前，通过 Discord 手机 app 给 bot 发消息，Claude 在你的机器上执行任务并回复结果。比如"帮我看一下 staging 服务器的日志有没有报错"。

**场景二：团队协作 bot**

在 guild 频道里开启 bot，团队成员 @bot 提问。设好 `requireMention` 和 `allowFrom`，控制谁能触发、在哪些频道响应。

**场景三：文件传输**

在 Discord 上发图片给 bot，Claude 下载后分析内容。或者 Claude 把生成的文件作为附件发回 Discord。

## 注意事项

- `pairing` 策略只是一个过渡手段，用来获取 Discord user ID。人加完了就应该切到 `allowlist`，否则任何能私信 bot 的人都会收到配对码。
- Discord 的 Bot API 不支持搜索。`fetch_messages` 是唯一的回看手段，且单次最多 100 条。
- 多 bot 实例需要设置不同的 `DISCORD_STATE_DIR`，否则 access.json 会冲突。
- bot 的 typing indicator 自动触发——Discord 用户能看到"正在输入…"。
- Guild 频道里的 thread 继承父频道的配置，不需要单独设置。
