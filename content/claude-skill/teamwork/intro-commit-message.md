# 5 分钟，一个全团队共用的 Skill

前两部分你学的都是一个人的事——自己写 Skill，自己调指令，自己跑 eval。这在个人项目里足够了。

但你大概率不是一个人在写代码。

## 问题

看看你们团队最近 20 条 commit message：

```
fix bug
update
修了一个问题
feat: add user auth module
WIP
asdfasdf
修改了一下样式
```

有人写 conventional commits，有人写中文，有人写"fix bug"然后一个 PR 里改了 14 个文件。更惨的是，有人 commit message 写的是"修复登录问题"，实际改的是支付模块。

你在团队会议上提过三次"大家统一一下 commit message 格式"。每次提完管用两周，然后回到原样。

这不是纪律问题。人记不住规则——尤其是在赶 deadline 的时候，写完代码随手一敲 commit，脑子里想的是下一个 bug，不是 commit message 格式。

## 解法

创建 `.claude/skills/commit-message/SKILL.md`：

```yaml
---
name: commit-message
description: "按 Conventional Commits 格式生成 commit message。当用户说'提交'、'commit'、'生成 commit message'时使用。"
disable-model-invocation: true
---

根据 staged changes 生成 commit message，格式如下：

type(scope): 简要描述

- type 只允许：feat / fix / refactor / docs / test / chore
- scope 用模块名，不超过 15 字符
- 描述用祈使句，不超过 50 字符，首字母小写
- 如果变更涉及多个模块，scope 留空

生成后直接执行 git commit，不需要用户二次确认。
```

注意 `disable-model-invocation: true`。这意味着 AI 不会自动触发这个 Skill——只有用户主动调用时才会加载。为什么？因为 commit message 是一个"你叫我做我才做"的任务，不需要 AI 在你讨论代码架构的时候突然跳出来说"我来帮你写个 commit message 吧"。

## 效果

团队里一个人创建了这个文件，提了一个 PR，合并到 main。

从那天开始，所有人的 commit message 都长这样了：

```
feat(auth): add OAuth2 callback handler
fix(payment): prevent duplicate charge on retry
refactor(api): extract validation middleware
```

没有开会，没有规范文档，没有 lint 工具的配置。一个 15 行的文件，解决了一个困扰团队半年的问题。

## 真正有意思的事

这个 Skill 的技术含量接近零。任何人都能在 5 分钟内写出来。

但它揭示了一个更大的话题：当 Skill 不再是"我的工具"而是"团队的基础设施"，游戏规则就变了。

谁来决定 commit message 的格式？如果有人想加 emoji 前缀怎么办？Skill 的修改要不要走 review？如果两个人对同一条规则有不同意见呢？

这些问题在个人 Skill 阶段不存在。一旦 Skill 变成团队共享的，它就从一个文件变成了一项制度。

接下来三章，我们聊的就是这件事：当 Skill 成为团队协作的一部分，你需要哪些机制来让它健康地活下去。
