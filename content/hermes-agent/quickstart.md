# 第 2 章 10 分钟跑通你的第一个 Hermes

这一章的目的不是教你所有的 CLI 参数 —— 那是附录 B 的事。这一章的目的是让你在十分钟内看到两件事:**Hermes 的目录结构长什么样**,以及**Agent 自己写出一个 skill 的那一刻**。这两个观察会成为你理解后续所有章节的锚点。

## 2.1 前置条件:三个必要项、一个选择

你需要准备:

1. **Python 3.10+**(Hermes 主体是 Python,虽然它可以通过 MCP 和 Gateway 接入其他语言)
2. **一个终端**(macOS、Linux、WSL 都可以,纯 Windows 理论上也行但作者没在上面验证过)
3. **一把 API key**(见下文)

关于 API key,你有四个选择,按**推荐程度**排序:

**选项 A:Nous Portal(官方托管)。** Nous Research 提供的托管服务,Hermes 默认就能直连,免配置。缺点是需要注册账户并充值,对国内用户访问延迟略高。

**选项 B:OpenRouter。** 一个聚合 200 多个模型的中转服务,按量付费,支持信用卡。优点是一个 key 可以切换所有主流模型,对测试"模型路由"功能非常方便。缺点是比原厂贵 5%–10%。

**选项 C:Anthropic / OpenAI 官方 key。** 如果你已经有,直接用。缺点是你会被锁定在一家模型上,后面练习"模型路由"时要再申请。

**选项 D:本地 vLLM / Ollama。** 如果你在本机或局域网有 GPU,可以跑开源模型(Nous Hermes 3、Qwen 3、DeepSeek-V3 等)。优点是零成本、数据不出本地。缺点是小模型的工具调用能力明显弱于 GPT-4/Claude,第一次跑 Hermes 不建议用这个 —— 等你读完第 7 章再回来试。

本书后面的所有示例用 **OpenRouter** 作为默认后端。选它的原因是它让你在不换代码的情况下可以切换模型,这对学习"模型无关"这个设计原则很关键。

## 2.2 安装

Hermes 的推荐安装方式是 `pipx`,一个把 Python CLI 工具装进隔离环境的工具。如果你没装过 pipx,先装它:

```bash
# macOS
brew install pipx
pipx ensurepath

# Linux / WSL
python3 -m pip install --user pipx
python3 -m pipx ensurepath
```

然后装 Hermes:

```bash
pipx install hermes-agent
```

装完之后,`hermes` 应该成为一个可执行命令。验证:

```bash
hermes --version
```

如果你看到版本号(形如 `hermes-agent 0.x.y`),说明安装成功。如果报 `command not found`,关掉终端重新开一个,让 `PATH` 生效。

> Hermes 仍在高速迭代,版本号会变。本书锁定的版本号在 [附录 C](appendix/C-version-locking.md) 列出。如果你装到的版本远超本书锁定的版本,某些 CLI 参数可能已经改名,请查阅 [附录 G 勘误页](appendix/G-errata.md)。

## 2.3 初始化:让 Hermes 认识你

第一次运行 `hermes`,它会进入一个引导式配置流程:

```bash
hermes
```

配置步骤大致是:

1. **选择工作目录**:Hermes 会把 `memory/`、`skills/`、`sessions.db` 等文件都放在这里。默认是 `~/.hermes/`,但你也可以指定一个 git 仓库目录 —— 后面你就能用 git 管理自己 Agent 的"大脑"。
2. **配置模型端点**:如果你选 OpenRouter,填入 API key、base URL(`https://openrouter.ai/api/v1`)、默认模型(推荐 `anthropic/claude-3-5-sonnet` 或 `openai/gpt-4o`)。
3. **初始用户模型**:Hermes 会问你几个问题(你是做什么的、你希望 Agent 怎么称呼你、你偏好的沟通风格等),把答案写入一个叫 `user_profile.md` 的文件。这个文件就是 Hermes 对"你是谁"的初始印象,后续所有对话都会在这个印象上继续雕刻。

配置完成之后,Hermes 会进入对话界面。你会看到一个命令行 prompt,等着你说第一句话。

## 2.4 第一次对话:观察目录的变化

在开始聊之前,先打开**另一个终端**,切到 Hermes 的工作目录(默认 `~/.hermes/`),执行:

```bash
ls -la
```

你应该看到大致这样的结构:

```
.hermes/
├── config.toml           # 全局配置
├── user_profile.md       # 用户模型
├── sessions.db           # 会话历史(SQLite)
├── memory/               # 持久化笔记
│   └── (目前是空的)
└── skills/               # 技能(procedural memory)
    └── (目前是空的或只有自带的几个)
```

这个目录是你接下来十分钟要盯着看的。Hermes 所有"成长"的痕迹都会反映在这里。

现在回到 Hermes 的对话窗口,试着让它做一件**稍微复杂一点但不过分**的任务。推荐的第一个任务:

> 帮我把这个目录下所有的 Markdown 文件列出来,按修改时间排序,生成一张 Markdown 表格,包含文件名、修改时间、字数统计三列。

Hermes 会开始工作。终端里你会看到大致这样的过程(真实日志,我从自己的运行里粘过来的,只做了路径脱敏):

```
> 帮我把这个目录下所有的 Markdown 文件列出来,按修改时间排序...

▸ thinking  let me first see what's in the current directory
▸ tool      run_shell_command(command="ls -la")
  result    .hermes   memory  skills  user_profile.md  sessions.db
▸ thinking  I'll use `find` to get mtime and word counts in one pass
▸ tool      run_shell_command(command="find . -maxdepth 3 -name '*.md' -type f ...")
  result    ./user_profile.md|2026-04-11 09:12|143
            ./memory/preferences.md|2026-04-11 08:47|86
            ...
▸ thinking  now format as a Markdown table

| 文件 | 修改时间 | 字数 |
|---|---|---|
| memory/preferences.md | 2026-04-11 08:47 | 86  |
| user_profile.md       | 2026-04-11 09:12 | 143 |

(done in 2 steps, 1.4s, 412+189 tok)
```

三件事要看清。第一,`thinking → tool → result` 的交替就是 **ReAct 循环**(Reason + Act),是 Agent 系统的基础执行模式,第 7 章会展开讲它的变体和陷阱。第二,Hermes **没有**调用任何"列出 Markdown 文件"的专门工具,它用通用的 `run_shell_command` 自己写了一段 `find` 命令。第三,末尾那行 `(done in 2 steps, 1.4s, 412+189 tok)` 是 Hermes 默认输出的成本计费,每次都能看到,第 10 章的可观测性会依赖这些数据。

记住这个观察。它在下一小节会变得重要。

## 2.5 亲眼看到 Agent 自己写 skill 的那一刻

刚才的任务做完之后,试着再让 Hermes 做一次**类似但稍有不同**的任务:

> 现在帮我对 `~/Downloads` 目录做同样的事,生成一张 Markdown 表格。

如果一切顺利,你会看到 Hermes 以几乎同样的方式完成了任务 —— 调 `find` / `wc` / 格式化输出。但这一次,Hermes 很可能会在任务末尾**主动提出一个建议**:

> 我注意到你两次都让我对一个目录做同样的事(列出 Markdown、按时间排序、统计字数)。我可以把这个操作沉淀成一个 skill,下次你直接说"给我一份 Markdown 清单"我就能直接执行,不用重新推理。要我创建这个 skill 吗?

这一刻就是你要观察的关键时刻。**Hermes 检测到了一个"值得沉淀的重复模式"**,并且决定主动和你协商是否要创建 skill。这个协商机制是第 4 章"skill 生命周期"的重点 —— 它不是每次都问你,也不是默默自己写,它会根据一个内部的"重复度阈值 + 用户偏好"来决定是否触发。

你回答 `yes`。

然后切回第二个终端,重新 `ls ~/.hermes/skills/`。你会看到一个新文件夹:

```
skills/
└── markdown-inventory/
    ├── SKILL.md
    └── (可能还有一两个脚本文件)
```

打开 `SKILL.md`:

```markdown
---
name: markdown-inventory
description: 列出目录下所有 Markdown 文件,按修改时间排序,输出一张包含文件名、修改时间、字数统计的 Markdown 表格
trigger: 用户要求"列出 Markdown 文件"、"整理 Markdown 清单"、"盘点 md 文档"等
---

## 使用场景

当用户需要快速了解某个目录下有哪些 Markdown 文件、最近改过哪些、大概写了多少字时,调用这个 skill。

## 执行步骤

1. 确认目标目录(如果用户没说,默认当前目录)
2. 执行 `find <dir> -name "*.md" -type f`
3. 对每个文件获取修改时间(`stat`)和字数(`wc -w`)
4. 按修改时间倒序排列
5. 生成 Markdown 表格

## 参考命令

\`\`\`bash
find "$DIR" -name "*.md" -type f -exec sh -c '
  for f; do
    mtime=$(stat -c "%y" "$f" 2>/dev/null || stat -f "%Sm" "$f")
    words=$(wc -w < "$f")
    echo "$mtime|$f|$words"
  done
' _ {} +
\`\`\`

## 注意事项

- 大目录(超过 1000 个文件)时会慢,需要给用户进度反馈
- 如果目录不存在,应该直接返回错误,不要静默失败
```

停下来仔细看这个文件。三件事需要你注意:

**观察一:这份 skill 是 Markdown,不是代码。** 它有一个 YAML frontmatter(name、description、trigger),有自然语言写的使用场景、执行步骤、注意事项,甚至有一段可以直接复用的 shell 命令。这个格式是 Hermes skill 的标准形式,它对 AI 友好(模型能读懂)也对人友好(你可以直接编辑这个文件修 bug,不用跑一次训练)。

**观察二:这份 skill 是 Hermes 自己写的,不是你写的。** 你只是做了两次操作并说了一声"yes",剩下的全由 Agent 完成 —— 它判断哪些步骤值得沉淀,它提炼出通用的 shell 命令,它写了 frontmatter,它想到了"大目录会慢"这种注意事项。这个过程叫 **skill generation**,是第 4 章的核心。

**观察三:下次你提到"Markdown 清单"这几个字时,Hermes 会优先用这个 skill,而不是从零推理。** 这就是"会成长"的具体含义 —— Agent 在每一次交互中都可能变得更懂你,而这个"变懂"不是抽象的说辞,是目录里多了一个文件、这个文件会被未来的 Prompt 自动引用。

## 2.6 现在观察 SQLite:你们的对话去哪了

刚才的对话并没有消失。打开第二个终端,进入 Hermes 工作目录:

```bash
sqlite3 ~/.hermes/sessions.db
```

在 SQLite 提示符里:

```sql
.tables
```

你会看到大致这样几张表:

```
sessions        messages        session_summaries       user_insights
skills_index    memory_index    context_refs            usage_log
```

(表名可能随 Hermes 版本略有差异,但大类基本如此。)

看看 `messages` 表:

```sql
SELECT role, substr(content, 1, 60), created_at FROM messages ORDER BY id DESC LIMIT 10;
```

你会看到刚才你和 Hermes 说过的每一句话 —— 包括模型"思考"的过程、调用工具的参数、工具返回的结果。每一条都完整地存在这里。

这就是 Hermes 记忆体系的第一层 —— **会话历史(Session History)**。它是完整的、未经压缩的,所有细节都保留。但它也有代价:会话多了之后这张表会膨胀,如果每次都把全部历史塞进 context,你的 token 费用会爆炸。

Hermes 的做法是引入一张 `session_summaries` 表,定期把旧会话压缩成摘要;再通过 FTS5(SQLite 的全文索引)做关键词检索,需要的时候把相关的旧对话"捞"回来塞进当前 context。这个机制叫 **cross-session recall**,是第 3 章记忆系统的核心之一。

现在你还不需要懂细节。你只需要建立一个心智模型:**Hermes 的记忆 = SQLite 里的会话历史 + memory/ 目录下的持久化笔记 + skills/ 目录下的程序化知识 + FTS5 索引 + LLM 压缩摘要**。这五个组件协作,让 Hermes 既不会"什么都记"(撑爆 context),也不会"什么都忘"(失去连续性)。

## 2.7 故意失败一次:让 Hermes 学到东西

Agent 系统的"成长"不只体现在"做对的事",也体现在"避免做错的事"。试一个能让 Hermes 犯错的任务:

> 帮我在 `/tmp` 下创建一个叫 `test-file.txt` 的文件,写入"hello"。然后读一下这个文件确认。然后删除它。

这个任务很简单,Hermes 应该能一次做对。但试试换一个更 tricky 的:

> 帮我把 `/tmp/test-file.txt` 的内容追加到 `/etc/hosts` 最后。

`/etc/hosts` 是系统文件,普通用户没有写权限。Hermes 会尝试执行,工具会返回 `Permission denied`。这时候观察它的反应:

- **错误分类**:Hermes 的 `agent/error_classifier.py` 会把这个错误分类为"权限问题",而不是"文件不存在"或"磁盘满"
- **反馈给模型**:错误信息会被结构化地塞回 context,模型看到后会做决策 —— 是告诉用户"需要 sudo 权限,我不能自己跑",还是尝试 `sudo` (取决于 Hermes 的安全配置)
- **可能沉淀为反面技能**:如果你多次遇到"想改系统文件但没权限"的情况,Hermes 可能会在 skills/ 里生成一份"modify-system-files"的 skill,专门处理这类任务 —— 而这份 skill 的核心内容会是"不要直接尝试写,先检查权限,再向用户说明情况"

这个过程叫 **learning from failure**。它是第 6 章"学习闭环"的一个子模式。现在你只需要知道:**Hermes 不只从成功里学习,它也从失败里学**,而且两种学习都会留下可审计的文件痕迹。

## 2.8 这十分钟里发生了什么

把刚才做过的事按时间轴梳理一遍,你会发现你亲眼看到了 Hermes 的**全部核心机制**一次性地运转起来:

| 你做的事 | Hermes 做的事 | 对应的后续章节 |
|---|---|---|
| 安装、初始化 | 创建目录结构、写 user_profile.md | 第 3 章(记忆)、第 9 章(部署) |
| 第一次让它列 Markdown | 执行 ReAct 循环,调 shell 工具 | 第 7 章(执行引擎) |
| 第二次让它做相似任务 | 识别重复模式,协商创建 skill | 第 4 章(技能机制) |
| 同意创建 skill | 生成 SKILL.md,写入 skills/ | 第 4、5 章 |
| 观察 SQLite | 看到了三层记忆的第一层 | 第 3 章 |
| 故意触发权限错误 | 错误分类 + 潜在的反面学习 | 第 6 章(学习闭环)、第 11 章(安全) |

十分钟里,你没有学会 Hermes 的任何一个 CLI 参数,但你已经看过了 Hermes 的核心工作方式。这就是我希望你带入后面 14 章的"感性基础"。接下来每一章讲某个机制的内部细节时,你都可以回头想:"哦,这就是我第一次看着它自己写 skill 时发生的事的解释。"

## 2.9 建议:给自己的 Hermes 目录建一个 git 仓库

在进入第 3 章之前,做一件我强烈建议的事:把你的 Hermes 工作目录初始化成一个 git 仓库。

```bash
cd ~/.hermes
git init
git add .
git commit -m "initial hermes state"
```

把 `sessions.db` 加到 `.gitignore`(它会频繁变化且太大),但把 `memory/`、`skills/`、`user_profile.md` 这些文本文件纳入版本控制。

这样做有三个好处:

1. **每次 Hermes 写新 skill 或改 memory 时,你能用 `git diff` 看清楚它改了什么**。这是后面所有章节做"观察和理解"的基础工具。
2. **你可以在 Hermes 乱写东西的时候回滚**。第 6 章讲学习闭环时会提到"自学习可能出错",有 git 作为安全网你会大胆很多。
3. **你可以像读别人的代码一样读自己 Agent 的"成长史"**。几周之后回头 `git log` 看看你的 Hermes 学会了哪些 skill、改过哪些 memory,是一种很独特的体验。

现在打开第 3 章,我们要进入全书最厚的五章 —— 核心机制。
