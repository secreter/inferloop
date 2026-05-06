# 防止 Skill 膨胀

## 你的 Skill 长胖了

三个月前你写了一个 code-review Skill，100 行，干净利落，跑得飞快。

现在它 600 行了。

怎么胖的？每次有新需求——"加个性能检查"、"把 accessibility 也看一下"、"新来的 intern 老是忘记关连接，加条规则"——团队的本能反应都是"加到 Skill 里"。于是 SKILL.md 从 100 行变成 200 行，再变成 400 行，最后变成一个包含安全检查、性能优化、无障碍审查、数据库规范、CSS 最佳实践的怪物。

结果是什么？AI 开始忽略后面的指令。你在第 500 行写了一条"禁止在循环里发 HTTP 请求"，AI 看都不看。不是它不想看——上下文窗口是有限的，塞太多东西进去，后面的就被挤得权重很低。

这跟你往一个函数里塞 600 行逻辑是一回事。

## 膨胀的五个信号

你不需要猜自己的 Skill 是不是太胖了。看这五个指标：

**1. SKILL.md 超过 500 行。** 这是硬阈值。超过了就该拆。AI 在处理长上下文时，对前 200 行的遵从度明显高于后 200 行。

**2. references/ 和 rules/ 目录加起来超过 10 个文件。** 每个文件都是认知负担。AI 加载 Skill 时，这些文件会被拼成一坨上下文。10 个文件各 50 行，就是 500 行额外上下文。

**3. AI 开始忽略 SKILL.md 后半部分的指令。** 你加了一条规则"所有 SQL 必须用参数化查询"，但 AI 审查代码时完全没提 SQL 的事。这不是 AI 犯蠢，是你的 Skill 太长，后面的指令被降权了。

**4. transcript 中出现 Skill 内容被跳过。** 打开 Claude Code 的 transcript（`~/.claude/projects/` 目录下），搜你的 Skill 名字。如果你看到 Skill 被加载了，但某些段落在 AI 的推理过程中完全没被引用——那些段落就是死代码。

**5. description 触发了不相关的场景。** 你的 code-review Skill 的 description 写着"审查代码质量和安全性"，结果用户问"这个算法的时间复杂度是多少"也触发了它。description 太宽泛，是 Skill 职责膨胀的表征。

### Token 成本估算

膨胀不是一个感性判断，可以粗算。先了解基本换算关系：

- 1 个中文字符 ≈ 1-2 tokens，1 个英文单词 ≈ 1 token
- 一个 200 行的 SKILL.md ≈ 2000-3000 tokens
- 一个 100 行的 references 文件 ≈ 1000-1500 tokens
- Claude 的上下文窗口是 200K tokens

举个例子：SKILL.md（200 行）+ 3 个 references（各 100 行）+ 动态注入的 PR diff（500 行）≈ 约 10K-15K tokens，占上下文的 5-7%。看起来不多，AI 还有充足的空间来分析代码、组织输出。

但如果膨胀到 SKILL.md（600 行）+ 8 个 references（各 200 行）+ 大 PR diff（2000 行），就是 40K+ tokens，占上下文的 20%。这时候 AI 的"工作空间"被你的指令吃掉了五分之一，留给实际代码分析和推理的空间明显不够。你会观察到 AI 开始跳过规则、简化输出、漏掉边角情况——不是它偷懒，是真的挤不下了。

拿这个估算方法衡量一下你自己的 Skill：算算 SKILL.md + 所有 references + 典型场景下的动态注入内容，加起来有多少 token。控制在 10% 以内是一个合理的目标。超过 15% 就该考虑瘦身了。

## 瘦身三板斧

### 一、拆分：一个 Skill 只做一件事

code-review 检查代码问题，code-fix 修复代码问题。这是两个 Skill，不是一个。

拆分前：

```
.claude/skills/
  code-review/
    SKILL.md          # 600 行，啥都干
    rules/
      security.md
      performance.md
      accessibility.md
      database.md
      css.md
      hooks.md
      naming.md
      error-handling.md
```

拆分后：

```
.claude/skills/
  code-review/
    SKILL.md          # 150 行，只做通用代码审查
    rules/
      naming.md
      error-handling.md
      hooks.md
  code-review-security/
    SKILL.md          # 100 行，专注安全检查
    rules/
      xss.md
      sql-injection.md
      auth.md
  code-review-perf/
    SKILL.md          # 80 行，专注性能检查
    rules/
      db-queries.md
      rendering.md
```

每个 Skill 职责单一，description 精确，触发场景明确。用户说"review 一下安全问题"只会加载 security 那个，不会把 600 行的大杂烩全塞进去。

### 二、分层：通用规则在 base，特定规则在子 Skill

有些规则确实跨多个 Skill 通用——比如"检查 TypeScript 类型安全"。每个 Skill 都抄一份不现实。

做法：把通用规则放在 `references/` 目录，让多个 Skill 引用同一个文件。

```
.claude/skills/
  _shared/                    # 团队共享知识库
    references/
      typescript-rules.md
      naming-conventions.md
  code-review/
    SKILL.md                  # 引用 _shared 里的规则
  code-review-security/
    SKILL.md                  # 也引用 _shared 里的规则
```

在 SKILL.md 中引用：

```markdown
遵循项目的 TypeScript 规则（见 references/typescript-strict.md）。
```

AI 会在需要时去读这个文件。不需要把内容全部内联到 SKILL.md 里。

### 三、清理：删掉从未被引用的指令

打开 transcript，找你的 Skill 最近 10 次被触发的记录。逐段对比 SKILL.md 的内容——哪些段落在 AI 的推理中被引用了，哪些从来没出现过。

从来没被引用的段落，要么是措辞不够明确导致 AI 不知道怎么用，要么是这条规则本身就不重要。前者改措辞，后者直接删。

这和删死代码一个道理。你不会留着一个从没被调用的函数说"以后可能用到"。

## Compaction 与 Skill 的关系

Claude Code 在上下文窗口快要满的时候会做一次 compaction——压缩对话历史，保留关键信息。这个过程中，最近一次触发的 Skill 内容会被尽量保留。

但"尽量保留"不等于"全部保留"。如果你的 Skill 本身就有 600 行，compaction 时也会被截断。越靠后的内容越容易被砍掉。

应对方法在第 8 章讲过：重要的指令放前面。这个原则在 compaction 场景下更加关键——前面的内容存活概率最高。

## 实战：拆分膨胀的 code-review

假设你的 code-review SKILL.md 当前包含以下几个板块：

1. 通用代码规范（命名、错误处理、类型安全）
2. 安全检查（XSS、SQL 注入、认证绕过）
3. 性能检查（N+1 查询、大列表渲染、内存泄漏）

现在把安全检查拆出去。

**新建 `.claude/skills/code-review-security/SKILL.md`：**

```yaml
---
name: code-review-security
description: "审查代码中的安全漏洞。当用户提到'安全审查'、'security review'、'检查安全问题'时使用。"
---

检查以下安全问题：

1. XSS：所有用户输入在渲染前必须经过转义，因为我们用 React 的 dangerouslySetInnerHTML 的地方有 3 处，每处都必须用 DOMPurify
2. SQL 注入：所有数据库查询必须用参数化查询，因为 ORM 的 raw query 接口不会自动转义
3. 认证绕过：API 路由必须检查 session 有效性，因为去年有一次事故是中间件顺序错误导致未认证请求打到了业务逻辑

对每个发现，说明：
- 文件路径和行号
- 具体的风险场景
- 推荐的修复方式
```

**原来的 code-review SKILL.md 删掉安全相关段落**，加一句引导：

```markdown
安全相关的审查请使用 code-review-security Skill。
```

拆完之后，code-review 从 600 行降到 200 行，security 独立成 60 行。各司其职，互不干扰。

## 反模式：用 Skill 包装一切

不是所有可重复的任务都需要变成 Skill。

判断标准只有一个：**这个需求会被重复使用吗？**

"帮我把这段 Python 翻译成 Go"——如果你只做一次，发个 prompt 就完了。你不需要为此创建一个 python-to-go Skill。

"帮我生成这个 API 的文档"——如果你的 API 文档有固定格式、固定结构、每次都要检查同样的要素，那值得做成 Skill。如果只是偶尔需要，不值得。

经验法则：如果你在一个月内用了同一个 prompt 三次以上，而且每次都在重复调同样的约束，那就做成 Skill。否则别浪费时间。

Skill 是有维护成本的。每创建一个，你就多了一个需要 review、需要 eval、需要跟着业务变化更新的东西。不要因为"可以做"就去做。
