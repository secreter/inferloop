# pr-review-toolkit：模块化 PR 审查工具箱

一套由 6 个专项审查 Agent 组成的 PR 审查工具箱，可以按需组合使用，也可以一键全跑。

## 技术原理

跟 `code-review` 插件不同，`pr-review-toolkit` 不是一个单一的审查流程，而是一个 Agent 集合。它注册了一个 slash command `/review-pr` 和 6 个独立的 Agent。

**command 层**（`commands/review-pr.md`）是调度器。它分析 git diff 的文件变更，根据变更类型决定跑哪些 Agent。逻辑很直白：

- 测试文件改了 → 跑 `pr-test-analyzer`
- 注释/文档改了 → 跑 `comment-analyzer`
- 错误处理代码改了 → 跑 `silent-failure-hunter`
- 新增类型定义 → 跑 `type-design-analyzer`
- `code-reviewer` 始终跑
- `code-simplifier` 在其他审查通过后跑

6 个 Agent 各有特色，逐个说：

**comment-analyzer** —— 专门审查代码注释。它验证注释是否跟实际代码一致（函数签名、行为描述、边界条件），评估注释的长期维护价值（解释 why 比解释 what 有价值），找出过时的、误导的、无用的注释。用 `inherit` 模型，颜色标记为绿色。

**pr-test-analyzer** —— 审查测试覆盖质量。注意是"质量"不是"覆盖率"。它关注行为覆盖而非行数覆盖，找未测试的关键路径和边界条件，评估测试是否会因为实现细节变动而脆断。每个建议附带 1-10 的关键度评分，9-10 是可能导致数据丢失或安全问题的必测项。

**silent-failure-hunter** —— 猎杀静默失败。这个 Agent 的态度最强硬，原文说"zero tolerance for silent failures"。它检查所有 try-catch 块、错误回调、fallback 逻辑，追问几个问题：错误有没有带上下文地记日志？用户有没有收到可操作的反馈？catch 块是不是捕获范围太宽把不相关的错误也吞了？fallback 行为是不是在掩盖根本问题？它的检查清单很有针对性，比如空 catch 块是绝对禁止的，optional chaining（`?.`）可能在悄悄跳过该报错的操作。

**type-design-analyzer** —— 类型设计分析。用四个维度给类型打分：封装性（内部细节是否隐藏了）、不变量表达（类型结构是否自文档化了约束）、不变量有用性（防不防真 bug）、不变量执行（构造时和变更时有没有检查）。每个维度 1-10 分。它标记的反模式包括贫血模型、暴露可变内部状态、靠文档而非代码强制不变量。用 `inherit` 模型，颜色标记为粉色。

**code-reviewer** —— 通用代码审查。对照 CLAUDE.md 检查规范合规、找 bug、评估代码质量。跟 `code-review` 插件里的 Agent 类似，也用 0-100 置信度评分，只报 80 分以上的问题。关键区别是这个 Agent 指定用 `opus` 模型，更重。

**code-simplifier** —— 代码简化。这个 Agent 跟独立插件 `code-simplifier` 内容完全相同（后面第三节会详细讲），在这里作为审查流程的最后一步出现，用于在其他问题修完后打磨代码。

command 层支持两种执行模式：顺序执行（默认，每个 Agent 的报告出完再跑下一个）和并行执行（加 `parallel` 参数）。最终汇总为四级输出：Critical Issues → Important Issues → Suggestions → Positive Observations。

## 安装与配置

```bash
/plugin install pr-review-toolkit@claude-plugins-official
```

无额外配置。项目有 CLAUDE.md 的话，`code-reviewer` 和 `code-simplifier` 能发挥更大作用。

## 使用方法

全量审查：

```
/review-pr
```

指定审查方面：

```
/review-pr tests errors      # 只审查测试和错误处理
/review-pr comments           # 只审查注释
/review-pr simplify           # 只做代码简化
/review-pr all parallel       # 全量并行审查
```

6 个 Agent 也可以直接作为 Agent 单独调用，不通过 command 层。

## 使用场景

**提 PR 前的自检**。这是推荐的主用法。提交代码后、创建 PR 前，跑一遍 `/review-pr`，把 Critical 和 Important 的问题修了再提。比提完 PR 再被 reviewer 打回来效率高。

**针对性审查**。改了一堆错误处理逻辑，不确定有没有遗漏静默失败的情况——单独跑 `silent-failure-hunter`。新加了几个类型定义——跑 `type-design-analyzer` 看看封装性和不变量设计。不用每次都全量跑。

**注释维护**。代码改了但注释没更新是很常见的问题。`comment-analyzer` 专门交叉验证注释跟代码的一致性，在老项目里特别管用。它还会标记那些只是复述代码的无用注释。

**新人代码打磨**。新人写的代码功能没问题但风格不一致、嵌套太深、命名不好。先跑 `code-reviewer` 查问题，修完后跑 `code-simplifier` 做一轮简化，省去 reviewer 反复提 nit 的来回。

## 局限与注意事项

**Agent 的模型选择不一致**。`code-reviewer` 和 `code-simplifier` 指定了 `opus` 模型，其他四个用 `inherit`（继承当前会话模型）。用 Haiku 跑 `silent-failure-hunter` 和用 Opus 跑效果差距明显。

**多个 Agent 的 prompt 里硬编码了 Claude Code 项目自身的路径和函数名**。`silent-failure-hunter` 引用了 `src/utils/execFileNoThrow.ts`、`constants/errorIds.ts`、`logForDebugging`、`logError`、`logEvent`——这些在你的项目里不存在。直接用的话，这些检查项不仅是噪音，还可能让 Agent 在你的代码里找不着北。要在其他项目使用，建议 fork 后把 prompt 中的硬编码引用替换成你项目的对应工具。

**顺序 vs 并行的取舍**。并行模式快，但 6 个 Agent 同时跑 token 消耗大。顺序模式慢，但每个报告出来后可以先处理，不用等全部跑完。

**`code-simplifier` 会直接改代码**。跟其他 5 个只做分析的 Agent 不同，`code-simplifier` 是会动手的——它会真的修改文件。如果你只想要建议不想被改，绕过这个 Agent。

**与 `code-review` 插件的重叠**。两个插件的 `code-reviewer` Agent 功能基本相同。如果两个插件都装了，要搞清楚自己在用哪个，避免重复工作。
