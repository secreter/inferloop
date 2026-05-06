# 第 22 章 准入流程设计

## 你的团队有 47 个 Skill，其中 30 个没人用

这个数字不是我编的。

去年年底我给一个 40 人的工程团队做 Claude Code 咨询，他们的 `.claude/skills/` 目录里躺着 47 个 Skill。我让他们跑了一下过去 30 天的触发日志，结果发现只有 17 个被实际使用过。剩下 30 个，有的是某个人写了自己都忘了的，有的是解决了一个早就不存在的问题，还有的纯粹是"我觉得这个能用上"然后就没有然后了。

这不是个别现象。没有准入门槛的 Skill 管理，必然走向泛滥。但我也见过另一个极端——某个团队要求每个 Skill 必须经过三轮评审、写设计文档、跑完整 CI，结果半年下来一共就创建了 3 个 Skill，大家宁愿手动操作也不愿意走流程。

本章要解决的就是这个平衡问题：怎么设计一个既能控制质量、又不会把人吓跑的准入流程。

## 全流程：六个阶段

```
提议 → 原型 → eval 验证 → 安全审查 → 灰度 → 全量
```

先把完整流程摆出来，后面会讲怎么按团队规模裁剪。

### 阶段一：提议

一句话说清楚这个 Skill 要解决什么问题。

不需要写文档，不需要开会。在 Slack 或飞书群里发一句话就行：

> "我想做一个 Skill，让 Claude 在 review PR 的时候自动检查是否有未处理的 TODO 注释。"

这一步的目的不是审批，是避免重复建设。可能有人会回复"这个我上周做了"，或者"这个用 CI lint 规则更合适"。如果没人反对，继续。

### 阶段二：原型

先在 `~/.claude/skills/` 个人目录下开发，不影响任何人。

这个阶段你想怎么折腾都行。SKILL.md 写得粗糙没关系，没有 evals 也没关系。目标是验证这个想法到底有没有用。你自己用上一两天，如果发现其实手动操作也没多费劲，那就不用往下走了。

大部分 Skill 应该死在这个阶段。这不是浪费，这是过滤。

### 阶段三：eval 验证

决定往团队推的时候，写 evals。

最低要求：

- `evals.json` 至少 2 个用例
- `pass_rate > 70%`

两个用例听起来很少，但它建立了一个基线。后面有人改了 Skill 或者模型升级了，至少有个东西能告诉你"改坏了没有"。

```json
[
  {
    "name": "检测到 TODO 注释",
    "input": "/check-todos",
    "context": "项目中有 3 个 TODO 注释",
    "assertions": [
      { "type": "content_contains", "value": "TODO" },
      { "type": "content_contains", "value": "3" }
    ]
  },
  {
    "name": "没有 TODO 时的输出",
    "input": "/check-todos",
    "context": "项目中没有 TODO 注释",
    "assertions": [
      { "type": "content_contains", "value": "没有发现" }
    ]
  }
]
```

### 阶段四：安全审查

检查四个方面：

**allowed-tools 是否最小化。** 一个只需要读文件的 Skill 不应该有 `Bash(*)` 权限。第 23 章会详细讲。

**动态注入命令有没有注入风险。** 如果 SKILL.md 里有 `` `!`some_command $USER_INPUT`` ``，用户输入的内容会不会被当作命令执行？

**scripts/ 中的脚本是否安全。** 有没有把 API key 写死在脚本里？有没有往外部服务发送不该发的数据？

**references/ 中的内容。** 有没有不小心把密码、token 放在参考文档里？

小团队可以在 PR review 时顺带做这些检查，不需要单独的安全审查流程。但这四个点必须有人看。

### 阶段五：灰度

把 Skill 从 `~/.claude/skills/` 移到 `.claude/skills/`，提交到 repo。

但不是全员立即可用。找团队里 2-3 个人先试用一周。试用期间关注三个指标：

- **触发次数**：没人用说明 description 写得不好或者需求不存在
- **误触率**：不该触发的时候触发了，说明 description 太宽泛
- **用户反馈**：好用不好用，输出格式需不需要调整

一周后如果没有严重问题，进入全量。

### 阶段六：全量

对于 project scope 的 Skill，灰度结束后全员可用，不需要额外操作。

对于 enterprise scope 的 Skill，需要通过组织管理后台发布到 enterprise managed settings。这一步通常需要管理员权限。

## 灰度策略：三级放开

```
personal（~/.claude/skills/）
    ↓ 自己用了一周
project（.claude/skills/）
    ↓ 团队试用一周
enterprise（managed settings）
    ↓ 全组织使用
```

每一级至少运行一周。不是因为一周这个数字有什么魔力，是因为大部分问题会在第一周暴露出来——周一到周五覆盖了正常工作流，偶尔有周末的异常场景。

从 personal 到 project 的过程就是提 PR。代码审查的时候，reviewer 同时审查 Skill 的质量、安全和 evals。

从 project 到 enterprise 需要更谨慎。一个有 bug 的 enterprise Skill 会影响所有人，回滚成本高得多。

## 退出机制

Skill 不是建了就永远在那里的。需要退出机制：

**30 天无人使用 → 标记为候选下线。** 不是直接删，是在 SKILL.md 头部加一行注释 `<!-- DEPRECATED: 30 天未使用，计划于 YYYY-MM-DD 下线 -->`，然后通知 Skill Owner。如果 Owner 认为还需要保留，说明理由。

**eval pass_rate 连续 3 次低于基线 → 暂停。** 模型升级有时候会导致已有 Skill 表现下降。如果连续 3 次跑 eval 都不过，先把 Skill 标记为暂停状态（在 description 前面加 `[SUSPENDED]`），等修复后再启用。

**Skill Owner 离职且无人接手 → 60 天缓冲期。** 如果 60 天内没有新 Owner 认领，下线。代码不删，从 `.claude/skills/` 移到 `_archived/` 目录，需要时可以恢复。

## 小团队怎么办

上面是完整流程，但不是每个团队都需要走全套。

**5 人以下的团队**，三步就够了：

```
原型（个人用）→ 写 eval → PR review
```

PR review 的时候同时完成安全审查和质量检查。灰度阶段可以跳过，因为团队小到每个人都能直接试用。

**10-30 人的团队**，加上灰度：

```
原型 → eval → PR review（含安全检查）→ 灰度（3 人试用一周）→ 合并
```

**30 人以上或涉及 enterprise scope**，走完整的六步流程。

关键原则是：**eval 不能省**。其他步骤都可以简化、合并、跳过，但没有 eval 的 Skill 就像没有测试的代码——今天能跑不代表明天还能跑。

## 一个真实的时间线

拿我们团队的 `db-migration-checker` Skill 举例：

- Day 1：我在群里说"我想做个 Skill 检查 migration 文件有没有破坏性变更"
- Day 1-3：在个人目录开发，自己试了两天
- Day 4：写了 3 个 eval 用例，pass_rate 100%
- Day 5：提 PR，同事 review 时指出 allowed-tools 给多了
- Day 6：修复权限，合并到 `.claude/skills/`
- Day 6-12：三个同事试用
- Day 12：收到反馈"对 PostgreSQL 的 ENUM 变更检测不准"，修了
- Day 14：正式标记为 stable

两周，一个人的业余时间。流程不重，但该有的都有了。
