# 第 8 章 让 Agent 接入世界:MCP、消息网关、Cron

到这一章为止,Hermes 还是一个"孤立的 Agent" —— 它活在你的终端里,只能和你一对一地对话。要让它真正有用,必须接入外部世界:接入工具生态(MCP)、接入消息入口(飞书 / Telegram / Discord)、接入时间维度(Cron 定时触发)。

这一章把这三件事放在一起讲,因为它们本质上是**同一个问题的三个方面**:**触发**。MCP 是"用户触发 + 工具触发"的接入,消息网关是"用户触发的入口"的接入,Cron 是"时间触发的入口"的接入。三者都要解决的共同问题是:**外部事件怎么变成 Hermes 的一次任务**。

先讲"触发器抽象",再逐个看三种触发器的具体实现。

## 8.1 统一抽象:触发器(Trigger)

在 Hermes 的设计里,所有外部进入 Agent 的事件都经过一个统一抽象:**Trigger**。无论是你在命令行敲了一句话、从飞书发来了一条消息、cron 到点了、还是一个 MCP server 收到了新数据,这些都被转换成同一种内部事件格式:

```python
# 伪代码
class Trigger:
    source: str          # "cli" | "feishu" | "telegram" | "cron" | "mcp"
    user_id: str         # 触发者(cron 是系统)
    session_id: str      # 归属的会话
    content: TriggerContent  # 具体的内容
    metadata: dict       # 源相关的附加信息
```

Hermes 的主循环不关心触发来自哪里,它只处理 Trigger 对象。这个抽象的好处是:

1. **加一个新入口几乎不用改主循环代码**,只需要写一个从外部协议转换成 Trigger 的 adapter
2. **所有入口共享同一套记忆、技能、用户模型**,用户从任何入口进来都看到同一个"大脑"
3. **权限和鉴权可以统一做**,不同入口的鉴权差异被限制在 adapter 里

这个抽象的代价是:**一些入口特有的能力无法直接暴露**。比如飞书的富文本消息(卡片、@ 提及、文件附件)如果走统一 Trigger,会丢失一些结构化信息。Hermes 的折中是:Trigger 里有一个 `metadata` 字段可以存"源特有"的数据,主循环不会看,但需要时 adapter 或 skill 可以从 metadata 里取回来。

下面三节分别看三种触发器的具体实现。

## 8.2 MCP:Model Context Protocol 的接入

### MCP 是什么

MCP(Model Context Protocol)是 Anthropic 2024 年底推出的开放协议,目的是让 LLM 应用以标准化方式对接各种外部工具、数据源、服务。你可以把 MCP 理解为"LLM 世界的 USB-C" —— 只要外部服务暴露一个符合 MCP 规范的 server,任何 LLM 应用都能通过统一的客户端库接入它。

MCP 的核心概念:

- **MCP Server**:暴露能力的一方。比如一个 GitHub MCP server 暴露 "get_issue"、"create_pr" 等 tool
- **MCP Client**:调用能力的一方。Hermes 就是一个 MCP client
- **Tools**:server 暴露的操作,client 可以调
- **Resources**:server 暴露的数据(可读的"文件"或"数据库内容")
- **Prompts**:server 预定义的 prompt 模板

MCP 已经有数十个开源 server,覆盖文件系统、Git、数据库(Postgres、SQLite、MongoDB)、云服务(AWS、GCP)、通讯工具、办公软件等。MCP 的存在意味着:**你不再需要为每一个外部系统手写 skill**,你可以直接加载对应的 MCP server,几分钟内让 Hermes "会用"这个系统。

### Hermes 怎么加载 MCP Server

第一次配置 MCP server 通常是写配置:

```toml
# ~/.hermes/config.toml
[mcp.servers.filesystem]
command = "npx"
args = ["@modelcontextprotocol/server-filesystem", "/home/user/workspace"]

[mcp.servers.git]
command = "uvx"
args = ["mcp-server-git", "--repository", "/home/user/myrepo"]

[mcp.servers.postgres]
command = "uvx"
args = ["mcp-server-postgres"]
env = { DATABASE_URL = "postgresql://..." }
```

Hermes 启动时会读这个配置,spawn 每个 server 作为子进程,通过 stdio 或 SSE 和 server 通信。启动成功后,Hermes 会调用每个 server 的 `list_tools` 把可用的操作列出来,然后**通过 5.6 节讲过的 `mcp-bridge` skill 把它们暴露给 Agent**。

这里要强调第 5.6 节的那个设计选择:MCP tool **不直接作为 Hermes 的内置 tool 注册**,而是通过一个 bridge skill 包装。这样 MCP tool 自动享有 skill 系统的质量闸门、风险标注、执行审计,而不是成为绕开这些机制的"后门"。

### 用 MCP 接入飞书多维表格

一个具体的例子:Hermes 怎么通过 MCP 接入飞书多维表格。

飞书的 lark-cli 工具提供了一套多维表格操作的命令(增删改查记录、管理字段等)。假设有一个 `lark-cli-mcp-server`(本书配套仓库的 `integrations/feishu-bitable-mcp/` 里有一份参考实现,基于 lark-cli 封装),它暴露这些操作作为 MCP tools:

```
tools:
  - list_records(app_token, table_id, filter?) -> list[Record]
  - get_record(app_token, table_id, record_id) -> Record
  - create_record(app_token, table_id, fields) -> Record
  - update_record(app_token, table_id, record_id, fields) -> Record
  - delete_record(app_token, table_id, record_id) -> void
  - list_tables(app_token) -> list[Table]
```

在 Hermes 的 config.toml 里加一段:

```toml
[mcp.servers.feishu-bitable]
command = "node"
args = ["/path/to/feishu-bitable-mcp-server/dist/index.js"]
env = { LARK_CLI_AUTH = "..." }
```

重启 Hermes。现在你可以对它说:

> 查一下我的"读书清单"多维表格里最近一个月加的书,按评分倒序排,生成一份 Markdown 清单。

Hermes 会:

1. 识别这个任务需要"多维表格"能力
2. 匹配到 `mcp-bridge` skill,operation 指向 `feishu-bitable.list_records`
3. 构造参数(按筛选条件、按时间范围)
4. 执行 MCP 调用,拿到数据
5. 格式化成 Markdown 返回

这个流程的关键是**你没有写一行代码** —— 飞书的 MCP server 已经有了(或者你基于 lark-cli 简单封装一个),Hermes 自动通过 skill 系统调用它。这就是 MCP 的价值。

### MCP vs Skill 的边界(再强调)

第 5.6 节讲过一次,这里再强调:

- **MCP tool 是原子操作**(调一次 API,做一件事)
- **Hermes skill 是业务抽象**(一个完整的工作流,可能调多个 MCP tool + 多个内置 tool)

如果你的需求是"让 Hermes 能用某个外部服务",用 MCP。如果你的需求是"把一段完整流程沉淀下来"(例如"每周自动整理读书清单并生成周报"),写一个 skill,skill 里可以调 MCP tool 作为步骤之一。

不要把这两者搞混。我见过一些团队把所有需求都塞进 MCP server 里(包括本应该是 skill 的业务流程),结果 MCP server 越来越复杂、难以维护。也见过相反的 —— 把所有外部 API 都手写成 skill,结果重复造轮子、和上游变化不同步。正确做法是让每一层各司其职。

## 8.3 消息网关:以飞书为主,其他平台为对照

### Gateway 抽象

Hermes 的 `gateway/` 目录实现了多入口抽象。每一种消息平台对应一个 adapter 文件,adapter 负责:

- 接收来自该平台的消息,转换成 Trigger
- 接收 Hermes 的回复,转换成该平台的消息格式并发送
- 处理鉴权、多用户隔离、消息去重、速率限制

当前 Hermes 官方支持 Telegram、Discord、Slack、WhatsApp、Signal、CLI 六种 gateway。飞书 gateway 在社区有第三方实现,本书配套仓库的 `integrations/feishu-bot/` 里有一份完整可用的参考实现,下面的讲解基于这份实现。

### 飞书机器人的最小可用形态

**第 1 步:在飞书开放平台创建应用**。这一步在附录 H 有详细的点击步骤,这里只讲要配置的几项:

- 应用类型:自建应用(企业应用)或商店应用(如果要发布)
- 启用"机器人"能力
- 权限:`im:message`、`im:message.receive_v1`、`im:chat`(群聊场景)
- 事件订阅:订阅 `im.message.receive_v1` 事件,回调地址填你部署的 Hermes gateway URL
- 获取 `App ID` 和 `App Secret`(填到 Hermes 配置里)

**第 2 步:配置 Hermes**:

```toml
# ~/.hermes/config.toml
[gateway.feishu]
enabled = true
app_id = "cli_xxxx"
app_secret = "xxxxxxxxx"
verification_token = "xxxxx"
encrypt_key = "xxxxx"  # 如果启用了加密
listen_host = "0.0.0.0"
listen_port = 8080
webhook_path = "/feishu/webhook"
# 只允许这些人 at 机器人或私聊时触发
allowed_user_ids = ["ou_xxx1", "ou_xxx2"]
```

**第 3 步:启动**:

```bash
hermes gateway start --gateway feishu
```

Hermes 会监听 8080 端口,接收飞书推送过来的事件。

**第 4 步:飞书回调地址配置**。如果你的 Hermes 不在公网上,需要用 ngrok / frp 或部署到服务器。如果用 ngrok:

```bash
ngrok http 8080
# 拿到公网 URL,填到飞书应用的事件订阅里
```

**第 5 步:在飞书里找到机器人,私聊或拉进群 @ 它**。发一条消息,看 Hermes 的终端,应该能看到 trigger 被处理的日志。

### adapter 的内部结构

飞书 adapter 的关键代码结构(简化):

```python
# gateway/feishu_adapter.py
class FeishuAdapter:
    def __init__(self, config):
        self.client = LarkClient(config.app_id, config.app_secret)
        self.listener = HTTPListener(config.listen_host, config.listen_port)

    async def start(self):
        self.listener.on("POST", self.config.webhook_path, self.handle_event)
        await self.listener.start()

    async def handle_event(self, request):
        # 1. 验签
        if not self.verify_signature(request):
            return {"code": 401}

        event = request.json
        event_type = event.get("header", {}).get("event_type")

        # 2. 分发
        if event_type == "im.message.receive_v1":
            return await self.handle_message(event)
        # ... 其他事件类型

    async def handle_message(self, event):
        msg = event["event"]["message"]
        sender = event["event"]["sender"]["sender_id"]["open_id"]

        # 3. 权限检查
        if sender not in self.config.allowed_user_ids:
            return {"code": 200}  # 静默忽略

        # 4. 抽取消息内容
        content = self.extract_content(msg)  # 处理文本、卡片、at、附件

        # 5. 转换成 Trigger
        trigger = Trigger(
            source="feishu",
            user_id=sender,
            session_id=self.get_or_create_session(sender, msg),
            content=TriggerContent(text=content.text, attachments=content.files),
            metadata={"msg_id": msg["message_id"], "chat_id": msg["chat_id"]},
        )

        # 6. 异步交给 Agent 处理
        asyncio.create_task(self.process_trigger(trigger))

        return {"code": 200}

    async def process_trigger(self, trigger):
        response = await self.agent.run(trigger)
        await self.send_reply(trigger, response)

    async def send_reply(self, trigger, response):
        chat_id = trigger.metadata["chat_id"]
        if len(response.text) > 10000:
            # 超长消息改用飞书云文档分享
            doc_url = await self.client.create_doc(response.text)
            await self.client.send_message(chat_id, f"结果见文档: {doc_url}")
        else:
            await self.client.send_message(chat_id, response.text)
```

这段代码有几个关键点:

**点 1:验签是第一件事**。绝对不能跳过。飞书的回调 URL 是公开的,任何人都可以往上发请求,没有签名验证就是把 Agent 的触发权交给公开互联网。

**点 2:`allowed_user_ids` 白名单**。开发阶段一定要开白名单,只让几个特定的人能触发机器人。等你对系统有信心了再考虑放开。

**点 3:session_id 的策略**。同一个用户连续的对话应该归为同一个 session,但隔太久的对话应该开新 session。常见策略:同一个人 + 同一个 chat,距离上一条消息不超过 30 分钟 → 同一个 session,否则新建。

**点 4:异步处理**。消息处理必须 async,因为 Agent 跑一次可能要 10 秒到 1 分钟,同步响应会导致飞书 webhook 超时。正确做法是立即返回 200,在后台处理,处理完成后主动发消息。

**点 5:超长消息的处理**。Agent 生成的回复可能很长(几千字的报告),飞书的消息有长度限制,超过限制时应该自动改成"上传到云文档并发分享链接"。

### 多入口的会话统一

如果同一个用户从 CLI 和飞书同时进来,怎么保证他看到的是同一个"大脑"?

Hermes 的做法是引入一个**跨入口的 user identity 映射**。配置文件里:

```toml
[users.zhangsan]
cli_user = "zhangsan"
feishu_open_id = "ou_abc123"
telegram_id = 987654321
email = "zhangsan@example.com"
```

不管从哪个入口来,adapter 先查这张表把外部 ID 映射到统一的内部 user_id,之后的所有操作(读记忆、写 memory、触发 skill)都用内部 ID。这就实现了"一个大脑,多个入口"。

## 8.4 其他入口的对照:Telegram、Discord、Slack

三种平台的 adapter 和飞书的结构非常像,主要差别在:

**Telegram**:

- 鉴权:Bot Token(一个字符串)
- 事件订阅:支持 webhook 或 long polling,long polling 适合本地开发
- 消息格式:文本 + Markdown + media,相对简单
- 特点:全球用户多,对个人开发者友好

**Discord**:

- 鉴权:Bot Token + Intents(细粒度权限)
- 事件订阅:WebSocket 长连接(Gateway API)
- 消息格式:支持嵌入(embed)、按钮、slash command
- 特点:适合社区场景,多服务器多频道

**Slack**:

- 鉴权:OAuth + Signing Secret
- 事件订阅:Events API webhook
- 消息格式:支持 Block Kit(结构化卡片)
- 特点:企业场景,权限模型复杂

对于**国内读者**,飞书是最自然的选择,因为:

- 大部分同事和家人已经在用
- 中文原生支持好
- 企业环境合规无障碍
- 飞书开放平台的文档和 lark-cli 等配套工具完整

对于**面向全球用户的项目**,Telegram 和 Discord 更常见。

对于**企业内部工具**,Slack(海外)或飞书(国内)是默认选择。

这本书后续的所有示例会以**飞书**为主,其他平台作为对照。如果你部署的目标是非飞书平台,配套仓库的 `integrations/` 里有对应 adapter 的参考实现。

## 8.5 Cron:时间触发的主动 Agent

消息网关是"用户说话才触发",Cron 是"时间到了就触发"。这个差别看起来小,但它决定了 Agent 的一个根本能力:**从"被动响应"到"主动汇报"**。

"主动汇报"的典型场景:

- 每天早上 8 点自动整理昨天的待办未完成项,发到飞书
- 每周五下午 5 点生成本周工作总结
- 每小时检查一次你关注的 GitHub 仓库有没有新 PR
- 每月第一天做一次"记忆系统体检",产出一份报告

这些场景共同的特点是:**触发时用户不在场**。用户可能在开会、在睡觉、在路上。Agent 要独立把事做完,通过消息网关把结果推送给用户。

### Hermes 的 cron 模块

Hermes 在 `cron/` 目录下有一个定时任务调度器。它不是通用的 cron(像 Linux 的 crontab),而是**专门为 Agent 任务设计的**,区别有几个:

- **任务定义里带 Agent 上下文**。一个 cron 任务本质上是"在 X 时间触发一个 Agent 任务 Y",Y 是一个 trigger 对象,包含要让 Agent 做什么
- **任务结果有推送渠道**。每个 cron 任务定义里指定"产出发到哪个 gateway",比如"每天早上 8 点的待办总结发到飞书"
- **任务失败有重试和报警**。一个 cron 任务失败后不是默默失败,它会尝试重试,多次失败会通过另一个渠道(比如邮件)发报警

### 定义一个 cron 任务

```toml
# ~/.hermes/cron.toml
[[jobs]]
name = "daily-todo-summary"
schedule = "0 8 * * *"  # 每天 8:00
enabled = true
trigger_text = "把昨天还没完成的待办整理一下,按优先级排序,发一份简报"
user_id = "zhangsan"  # 以这个用户的身份运行
output_gateway = "feishu"
output_chat_id = "oc_xxx"  # 发到哪个飞书群或私聊
budget_tokens = 20000
timeout_seconds = 300

[[jobs]]
name = "weekly-github-digest"
schedule = "0 17 * * 5"  # 每周五 17:00
enabled = true
trigger_text = "汇总这一周我 star 过的所有 GitHub 仓库,按语言分类,每个加一句说明"
user_id = "zhangsan"
output_gateway = "feishu"
output_chat_id = "oc_xxx"
```

Hermes 启动后会读这个文件,按 schedule 自动触发。每次触发就是构造一个 Trigger 对象交给主循环,和用户从飞书发消息的效果完全一样,只是 source 是 `cron` 而不是 `feishu`。

### 主动触发的三个设计注意点

**注意点 1:主动触发的结果也是对话的一部分**。cron 跑完的结果要存进 session 历史,不能"一次性消费后扔掉"。否则你早上看到"待办简报"想追问一句"第二项那个怎么解决?",Agent 会不知道你在说什么。

**注意点 2:主动触发的模型分级要单独配置**。cron 任务通常不需要最强的模型 —— "整理昨天的待办"用 Haiku 就够了。但如果用主配置里的默认模型(Sonnet),你的月账单会被 cron 拖高一截。Hermes 支持 per-job 的模型配置,充分利用它。

**注意点 3:推送疲劳**。如果你设了 20 个 cron 任务,每天给你发 20 条消息,你会开始忽略它们。主动推送是稀缺资源,要"少而精"。建议:

- 只在内容**真的有变化**时推送("今天没有未完成待办"这种消息不要推)
- 合并推送("每天早上一次总结" > "每件事一条消息")
- 给你机会随时关闭某个推送

## 8.6 Webhook 订阅:被动的事件驱动

除了 cron(定时触发)和网关(用户触发)之外,还有第三类触发:**外部事件触发**。GitHub 有新 issue、Linear 有新 task、监控系统报警、某个网页变化 —— 这些都应该能即时通知到 Agent。

Hermes 通过通用的 webhook 机制支持这类场景。你在配置里定义一个 webhook endpoint,外部系统 POST 到这个 endpoint,Hermes 把请求体转换成 Trigger。

典型示例:

```toml
[[webhooks]]
name = "github-new-issue"
path = "/webhook/github/new-issue"
trigger_template = "GitHub 收到新 issue: {title} ({url}),作者 {author}。你判断一下优先级,如果是 high 就在飞书群里 at 我。"
user_id = "zhangsan"
output_gateway = "feishu"
output_chat_id = "oc_xxx"
secret = "xxx"  # GitHub webhook 签名密钥
```

GitHub 的 webhook 到 Hermes 后,Hermes 会验签,解析 payload,按 `trigger_template` 生成一段自然语言(把 `{title}`、`{url}`、`{author}` 替换成真实值),然后当成一个 Trigger 交给 Agent。

这种模式的威力在于:**你不需要为每个外部系统写专门的 adapter**,只要外部系统支持 webhook,你就能接进来。代价是 trigger_template 是纯文本,没有结构化数据 —— 如果需要 Agent 对原始 payload 做复杂处理,还是得写专门的 skill。

## 8.7 一个完整的"每天早上主动汇报"示例

把前面讲的 MCP + 飞书 + cron 串起来,看一个完整的例子。

**目标**:每天早上 8:00,Hermes 自动:

1. 从飞书多维表格里拉"今日待办"(MCP 接入)
2. 从 GitHub 拉我昨天 star 的仓库(MCP 或内置 tool)
3. 生成一份结构化简报
4. 发到飞书群里

**配置步骤**:

```toml
# config.toml
[mcp.servers.feishu-bitable]
command = "node"
args = ["./integrations/feishu-bitable-mcp/dist/index.js"]

[gateway.feishu]
enabled = true
app_id = "..."
app_secret = "..."
# ... 其他配置同 8.3 节
```

```toml
# cron.toml
[[jobs]]
name = "morning-brief"
schedule = "0 8 * * *"
enabled = true
user_id = "zhangsan"
trigger_text = """
帮我准备今天的晨间简报:

1. 从 "待办清单" 多维表格里取出今天要做的事(状态=待处理),按优先级排序
2. 列出我昨天(截至今早 00:00)在 GitHub 上 star 的新仓库,每个一句话说明
3. 把这两部分整理成一份简洁的 Markdown 简报

不要啰嗦,直接上干货。
"""
output_gateway = "feishu"
output_chat_id = "oc_personal"
budget_tokens = 15000
timeout_seconds = 180
```

跑起来的时候发生的事:

1. 8:00 整,cron 触发
2. Hermes 构造一个 Trigger,开始处理
3. 主循环识别任务涉及"多维表格"和"GitHub",准备对应的 skill / MCP tool
4. 执行 MCP 调用(`feishu-bitable.list_records` 拉待办,GitHub MCP 或内置 tool 拉 starred repos)
5. LLM 综合信息生成简报
6. 通过飞书 gateway 发送到指定群

8:00:15 左右,你打开飞书看到一条自动推送的简报。整个过程你什么都不用做。

这就是"触发器抽象"的威力 —— **三种不同的触发机制(MCP 数据源、cron 时间、飞书输出)被统一在一个流程里**,开发者只需要写配置,不需要写代码。

配套仓库的 `integrations/morning-brief/` 目录有这个示例的完整配置和调试说明。

## 8.8 陷阱清单

**陷阱一:把用户输入的文本直接作为 trigger 不做过滤**。飞书群里可能有人在刷消息,不是每条都应该触发 Agent。正确做法是只有 at 机器人或私聊时才触发。

**陷阱二:webhook 不验签**。安全事故的高发区,见第 11 章的案例。

**陷阱三:cron 任务的失败默默发生**。你设了一个任务,结果它从第三天开始就挂了,你一周后才发现。必须有失败报警,且报警渠道要和正常推送渠道不同(否则 Agent 本身挂了报警也发不出来)。

**陷阱四:推送频率失控**。一个 cron 触发的任务内部又触发了新的推送,新的推送又触发 cron……形成循环。必须限制 "cron 触发的任务能不能再主动推送"。

**陷阱五:MCP server 进程泄漏**。每次 Hermes 重启都 spawn 新的 MCP server 子进程,旧的没有被 kill,系统里 MCP server 进程越堆越多。正确做法:启动前先 kill 所有同名进程,或者通过 pid file 管理。

**陷阱六:gateway 的 session_id 策略错误**。如果两个用户在同一个群里 at 机器人,它们的消息应该进不同的 session。如果你的 adapter 把 session_id 绑定到 chat_id(而不是 user_id + chat_id),两个人的对话会污染彼此的上下文。

**陷阱七:MCP tool 的 schema 变化**。MCP server 升级后 schema 变了,但 Hermes 的缓存还是旧的,调用时参数对不上。必须有 schema 刷新机制。

**陷阱八:跨入口的身份映射遗漏**。用户第一次从 CLI 用 Hermes,后来又接入飞书,但没在配置里建立映射,结果 CLI 的 "张三" 和飞书的 "ou_xxx" 在 Hermes 看来是两个人,记忆不共享。必须在引入新入口时把 user identity 表更新。

下一章讲部署 —— 前面的一切都建立在"有一个地方跑 Hermes"的假设上,下一章讲这个地方应该是什么、怎么挑、怎么维护。
