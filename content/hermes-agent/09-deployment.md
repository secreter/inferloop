# 第 9 章 部署拓扑与多设备共享

前面八章讲 Hermes 的内部机制。这一章讲"把它跑起来的地方"。这听起来像运维话题,但它实际上决定了 Agent 的几个关键属性:**响应速度、可靠性、成本、多设备体验**。选错了部署方式,前面所有优秀的设计都会被拖后腿。

## 9.1 部署的四种典型拓扑

**拓扑一:纯本地(Local-Only)**

Hermes 跑在你个人的电脑上,所有数据留在本地。优点:零服务器成本、数据绝对隐私、延迟最低。缺点:**你关机它就不在** —— 没法做 cron 主动汇报,没法从手机远程访问,没法在多设备间共享。

适用:你只在一台固定电脑上使用 Agent,不需要主动触发,对数据隐私要求极高(比如涉及公司机密的个人分析)。

**拓扑二:$5 VPS**

最便宜的云服务器,每月 5 美元左右。Hermes 24 小时运行,通过飞书 / Telegram 接入。优点:永远在线、便宜、完全可控。缺点:**小内存可能吃紧**(512MB–1GB),冷启动有延迟,外部 API 调用的网络路径比本地长。

适用:大多数个人用户。这是默认推荐的配置,性价比最高。

**拓扑三:按需计算(Modal / Daytona / Fly.io)**

Hermes 不常驻服务器,而是按需唤醒 —— 有请求时启动 container,无请求时归还资源。优点:**空闲时成本接近 0**,弹性好,冷启动通常 2–5 秒可接受。缺点:**状态持久化要外挂**(SQLite 不能放在 ephemeral 存储里),冷启动期间的请求会变慢。

适用:使用频率不稳定的场景,既不想永远开着也不想错过请求。尤其适合"晚上高频 + 白天低频"的用户。

**拓扑四:个人服务器 / 家用 NAS**

Hermes 跑在家里的旧电脑、树莓派或 NAS 上。优点:**无云账单、可以接入内网服务**(本地 NAS、内网数据库)、可以跑本地模型(如果硬件够)。缺点:**宽带上传带宽决定延迟**,家庭网络可能不稳定,需要做内网穿透。

适用:有 homelab 习惯的技术用户、对本地模型有需求、或者想接入内网资源的人。

### 选择矩阵

| 我想... | 推荐拓扑 |
|---|---|
| 只想在一台电脑上用,简单就好 | 本地 |
| 每天都用,需要主动汇报和跨设备访问 | $5 VPS |
| 用的频率不稳定,不想为空闲时间付费 | Modal / 按需 |
| 想接本地 NAS / 跑本地模型 / 不想给云付钱 | 家用服务器 |
| 团队协作,多人共享同一个 Agent | 专用 VPS(不是 $5 的,升级到 2–4GB 内存) |

## 9.2 $5 VPS 部署实操(推荐默认)

这一节给一个完整的 $5 VPS 部署流程,以 DigitalOcean / Vultr / 腾讯云这类服务商的最便宜机型为例。

**第 1 步:开机**。选一个离你地理位置近的 region(国内用户选新加坡或东京,北美选 SF 或 NYC)。操作系统选 Ubuntu 22.04 LTS。SSH 密钥登录,别用密码。

**第 2 步:基础配置**:

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 装 Python、git、pipx
sudo apt install -y python3-pip python3-venv git curl
python3 -m pip install --user pipx
python3 -m pipx ensurepath
source ~/.bashrc

# 装 Hermes
pipx install hermes-agent

# 验证
hermes --version
```

**第 3 步:配置目录和 git**:

```bash
mkdir -p ~/hermes-work
cd ~/hermes-work
git init
echo "sessions.db" > .gitignore
echo "trajectories/" >> .gitignore
echo "*.log" >> .gitignore
```

**第 4 步:初始化 Hermes**:

```bash
cd ~/hermes-work
hermes init --workdir ~/hermes-work
# 跟随交互式配置:填模型 API key、选模型、初始 user profile
```

**第 5 步:配置 systemd 让它开机自启**。创建 `/etc/systemd/system/hermes.service`:

```ini
[Unit]
Description=Hermes Agent
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/hermes-work
ExecStart=/home/ubuntu/.local/bin/hermes gateway start --gateway feishu
Restart=on-failure
RestartSec=10
StandardOutput=append:/home/ubuntu/hermes-work/logs/hermes.log
StandardError=append:/home/ubuntu/hermes-work/logs/hermes.err

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable hermes
sudo systemctl start hermes
sudo systemctl status hermes
```

**第 6 步:反向代理 + HTTPS**。飞书 webhook 要求 HTTPS。用 caddy 最省事:

```bash
sudo apt install -y caddy
```

编辑 `/etc/caddy/Caddyfile`:

```
hermes.yourdomain.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

**第 7 步:在飞书开放平台把 webhook URL 填成 `https://hermes.yourdomain.com/feishu/webhook`**。

**第 8 步:测试**。在飞书私聊你配的机器人,发一条消息,看 Hermes 的日志:

```bash
tail -f ~/hermes-work/logs/hermes.log
```

应该看到 trigger 被处理、Agent 回复的日志。到这一步 Hermes 已经在一台 $5 的 VPS 上 24 小时在线了。

## 9.3 状态持久化与备份

无论哪种部署拓扑,都必须考虑状态持久化。Hermes 的"大脑"就在工作目录里,丢了等于从头开始。

**要备份的东西**:

- `memory/` 整个目录(用户画像、笔记、事实)
- `skills/` 整个目录(所有学到的技能)
- `config.toml`(配置)
- `cron.toml`(定时任务)

**可以不备份的东西**:

- `sessions.db`(会话历史,重要但占空间大,可选)
- `trajectories/`(每次运行的完整轨迹,占空间最大,通常可以不备份)
- `cache/`(各种缓存,重启会重建)
- `logs/`(日志,故障诊断用,按需保留)

**最简单的备份方案**:git + 远程仓库。

```bash
cd ~/hermes-work
git add -A
git commit -m "daily snapshot $(date +%Y-%m-%d)"
git push origin main
```

用 cron 定时执行:

```bash
# crontab -e
0 3 * * * cd ~/hermes-work && git add -A && git commit -m "daily snapshot $(date +\%Y-\%m-\%d)" -q && git push -q 2>&1
```

这种方案的好处:

- **版本化**:你可以回到任意一天的状态
- **异地**:远程仓库在另一个地方,服务器挂了也不丢
- **可读**:你可以用普通 git 工具查看改了什么

如果你的 memory/skills 里可能包含敏感信息,**不要推到公共仓库**,用私有仓库或自建 Gitea。

**备份的注意事项**:

- 如果 `sessions.db` 很大,git 会变慢。可以把它软链接到另一个目录,git 忽略
- 备份之前确保所有 skill 文件里没有明文 API key(第 11 章会讲一个真实事故)
- 定期**验证备份可以恢复** —— 在另一台机器上克隆仓库、跑 Hermes,确认它能"想起"你是谁。没验证过的备份 = 没有备份

## 9.4 多设备共享:一个大脑,多个入口

"多设备共享"不等于"多台机器上跑多个 Hermes"。正确的模型是:**一个 Hermes 实例(在 VPS 上),多个入口(CLI、飞书、Telegram)接入它**。所有设备通过入口和同一个大脑交互。

具体配置:

**在你的 MacBook 上**:不跑 Hermes,装一个"远程 CLI 客户端"(或者用 ssh 远程连到 VPS 上直接跑 `hermes` 命令)。

**在你的 iPhone 上**:不跑 Hermes,通过飞书移动端和部署在 VPS 上的飞书机器人聊天。

**在你的 iPad 上**:同上,通过飞书。

**在办公室电脑上**:通过 ssh 连 VPS 用 CLI,或者用飞书桌面版。

这种拓扑的好处:

- **状态完全统一**,任何设备上的任何交互都归入同一个大脑
- **本地设备不需要配置模型 API、不需要占 CPU 和内存**
- **换设备的迁移成本是 0**,新买一台电脑装个飞书就继续用

这种拓扑的代价:

- **依赖网络**,离线时这些设备都用不了 Agent
- **依赖飞书等中间商的稳定性**(不过对大多数人这不是问题)

### 如果你需要离线可用

极少数场景下(飞行途中、无网络环境),你可能需要本地 Hermes。做法是**本地部署一份 Hermes,定期从远程同步 memory 和 skills**:

```bash
# 离线前
cd ~/local-hermes-work
git pull origin main
hermes --workdir . repl

# 离线中你的修改只在本地
# 联网后
git add -A
git commit -m "offline changes"
git push origin main
```

这种"双实例 + git 同步"的做法有**冲突风险** —— 如果离线期间你在飞书也用了 Agent(Agent 改了服务器上的 memory),联网后 git 会冲突。解决策略:**离线使用期间不要同时用服务器端的 Agent**。这是一个约束,不是一个缺陷。

## 9.5 从本地到云的迁移

如果你一开始是本地部署,后来决定迁到 VPS,迁移流程:

1. **在本地提交所有未提交的变化**到 git
2. **把 git 仓库推到一个远程**(GitHub、自建 Gitea)
3. **在 VPS 上克隆**这个仓库
4. **装 Hermes**(同 9.2 节的前几步)
5. **在 VPS 上把 workdir 指向克隆下来的目录**
6. **复制 API key 配置**(配置里可能有本地路径,要改成 VPS 路径)
7. **启动 Hermes**,确认它能"想起"你

这个迁移在正常情况下 30 分钟搞定。关键是不要忘记任何一个文件 —— 用 git 管理的好处就是你不会忘。

## 9.6 版本升级的兼容性检查

Hermes 上游在高速迭代,你早晚要升级。升级前要做几件事:

**事前**:

1. **备份当前状态**(git commit + push)
2. **看 release note** 里有没有 breaking change,尤其是:
   - `config.toml` 的字段变化
   - `SKILL.md` 的 frontmatter schema 变化
   - `sessions.db` 的数据库 schema 变化
3. **在"备用环境"里先升级试用**(把本地机器作为备用,先升本地的,没问题再升 VPS 的)

**事中**:

```bash
pipx upgrade hermes-agent
hermes --version  # 确认新版本
hermes validate --workdir ~/hermes-work  # 如果这个命令存在,它会检查配置和 schema
```

**事后**:

1. **重启服务**:`sudo systemctl restart hermes`
2. **跑一个冒烟测试**:在飞书里发一条简单消息,确认能正常对话
3. **检查日志**,确认没有异常
4. **观察一天**,看看 memory 和 skills 有没有被意外重写

**如果升级后出问题**:回滚。

```bash
pipx install --force hermes-agent==<old-version>
cd ~/hermes-work
git checkout HEAD~1  # 回到升级前的 snapshot(如果升级破坏了文件)
sudo systemctl restart hermes
```

这就是为什么 9.3 节那么强调 git 备份 —— **没有能回滚的备份,升级就是赌博**。

## 9.7 资源监控

一个跑着的 Hermes 要持续监控几个指标:

- **CPU 和内存**(基础运维)
- **磁盘使用**(sessions.db 会增长,trajectories 会堆积)
- **API 成本**(Hermes 本身可以产出,但最终要交叉验证)
- **LLM 调用次数和失败率**
- **skill 执行统计**

前两项用 `top` / `htop` / `df` 解决。后三项是 Hermes 自己产生的数据,在第 10 章的可观测性里讲。

对资源吃紧的 $5 VPS,两个常见问题:

**问题一:内存不够**。Hermes + Python runtime + caddy + systemd 加起来可能用 400–600MB。如果你的机器只有 512MB,会跑不起来或频繁 OOM。对策:

- 升级到 1GB 机型(加几美元)
- 或者禁用本地 embedding 模型,embedding 全部走 API
- 或者加 swap(不是长久之计,SSD 磨损)

**问题二:磁盘满**。sessions.db 可能每月增长几百 MB,trajectories 可能每天几十 MB。25GB 的默认磁盘能用几个月,然后会满。对策:

- 定期清理 trajectories(保留最近 30 天)
- 定期归档 sessions.db 的旧数据
- 扩容磁盘(加两三美元)

## 9.8 部署陷阱清单

**陷阱一:没有监控 API 账单**。Agent 跑飞了你不知道,月底一看账单几百美元。必须有成本上限 + 报警。

**陷阱二:用明文 API key 写在配置里然后 git push**。密钥必须走环境变量或 secrets manager,配置文件只留 placeholder。

**陷阱三:HTTPS 证书过期**。飞书 webhook 会拒绝非 HTTPS,证书过期后机器人就"死"了。用 caddy 的自动续期,或者 certbot。

**陷阱四:没开防火墙**。VPS 默认开着所有端口,很快会被扫描攻击。至少关闭非必要端口,只开 22/80/443。

**陷阱五:ssh 还在用密码登录**。改密钥,禁用密码,禁用 root 直接登录。

**陷阱六:时区不一致**。VPS 默认 UTC,但你在中国。cron "0 8 * * *" 变成"下午 4 点触发"而不是"早上 8 点"。解决:`sudo timedatectl set-timezone Asia/Shanghai`。

**陷阱七:没做升级演练**。上游发新版本,你直接在生产上升级。升坏了没法回滚。做法见 9.6 节。

**陷阱八:多设备同时写 memory 冲突**。本地和 VPS 都跑 Hermes 且都在改 memory,导致 git 冲突。解决:只有一个"主节点"可以写,其他节点只读或走入口接入主节点。

到这一章结束,你应该能把一个 Hermes 部署起来、长时间运行、必要时升级回滚。接下来进入第四部分 —— 讲"跑起来之后,你怎么知道它跑得好不好"。
