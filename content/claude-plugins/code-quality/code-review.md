# code-review：多 Agent 协作的 PR 自动审查

一个围绕 GitHub Pull Request 做自动代码审查的插件，核心思路是用多个不同职责的子 Agent 并行审查，再用置信度评分过滤掉误报，最终把结果评论回 PR。

## 技术原理

这个插件只有一个 slash command `/code-review`，定义在 `commands/code-review.md`。它不是一个传统意义上的"代码"插件——没有 TypeScript，没有运行时逻辑，整个实现就是一份给 Claude 的详细指令文档。Claude 按指令编排子 Agent 完成工作。

工作流程分 8 步，概括起来是三个阶段：

**阶段一：预检与情报收集（步骤 1-3）**

用 Haiku 级别的轻量 Agent 做三件事：判断 PR 是否需要审查（已关闭、草稿、自动化 PR 或已审查过的直接跳过）；收集仓库中相关的 CLAUDE.md 文件路径；查看 PR 内容并生成变更摘要。

**阶段二：并行审查 + 置信度评分（步骤 4-5）**

这是核心。同时启动 5 个 Sonnet 级别的 Agent，各有分工：

- Agent #1：对照 CLAUDE.md 检查规范合规性
- Agent #2：浅层扫描明显 bug，只看 diff 本身，不读额外上下文
- Agent #3：查 git blame 和历史提交，结合历史上下文找问题
- Agent #4：查改过同文件的历史 PR 评论，看是否有可复用的反馈
- Agent #5：检查代码注释中的指引，看改动是否违反了注释里的约定

每个 Agent 独立返回问题列表后，再为每个问题启动一个 Haiku Agent 做 0-100 的置信度打分。打分标准写得很具体：0 分是经不起推敲的误报，25 分是可能真可能假，50 分是真问题但不重要，75 分是高置信度的实际问题，100 分是板上钉钉。

**阶段三：过滤 + 输出（步骤 6-8）**

只保留 80 分以上的问题。再做一次资格检查（防止 PR 在审查期间被关了），然后用 `gh pr comment` 把结果评论回 PR。

插件对误报类型给了明确定义：pre-existing 的问题、linter/类型检查器能抓的问题、泛泛的代码质量问题（除非 CLAUDE.md 明确要求）、已被 lint ignore 注释豁免的问题、看起来是有意的功能变更——这些统统算误报。

工具权限方面，`allowed-tools` 只开放了 `gh` 命令的只读操作和评论权限，不能修改代码。

## 安装与配置

```bash
/plugin install code-review@claude-plugins-official
```

使用前提是项目仓库在 GitHub 上，且本地装了 `gh` CLI 并完成了认证。插件本身没有配置项。

## 使用方法

```
/code-review <PR URL 或 PR 编号>
```

Claude 会自动走完整个流程。你看到的最终输出是一条 PR 评论，格式固定：

```markdown
### Code review

Found 3 issues:

1. 某个 bug 的描述 (CLAUDE.md says "xxx")
   https://github.com/org/repo/blob/<full-sha>/path/file.ts#L10-L15

2. ...
```

如果没发现问题：

```markdown
### Code review

No issues found. Checked for bugs and CLAUDE.md compliance.
```

## 使用场景

**CI 集成自动审查**。把 `/code-review` 接入 GitHub Actions，每个 PR 创建时自动触发。比人工审查快，而且不会因为赶进度跳过。它不替代人工审查——80 分阈值意味着它只报高置信度的问题，剩下的还是靠人看。

**大团队的 CLAUDE.md 规范执行**。项目有几十条编码规范写在 CLAUDE.md 里，新人容易漏。Agent #1 专门对照 CLAUDE.md 检查，比人记得牢。

**历史上下文审查**。Agent #3 和 #4 做的事情是大多数人工 reviewer 懒得做的——翻 git blame 看这段代码的历史，翻以前的 PR 评论看有没有同类反馈。这在老项目里特别有价值。

**周末/异步审查**。团队跨时区，PR 提了要等 reviewer 醒来。挂上这个插件至少能先过一遍，reviewer 上线时已经有一份初步报告。

## 局限与注意事项

**不跑构建、不跑测试**。插件明确说了不做 build 和 typecheck，假设 CI 会单独跑。所以编译错误、类型错误、测试失败它抓不到。

**置信度打分的可靠性取决于模型**。80 分阈值听起来不错，但打分本身是 Haiku 做的，对复杂代码逻辑的判断准确度有限。过滤掉了一些真问题是必然会发生的。

**对 CLAUDE.md 的依赖**。5 个 Agent 中有 2 个直接依赖 CLAUDE.md 的内容。如果项目没有写 CLAUDE.md，或者写得很粗糙，这两个 Agent 基本等于空转。

**子 Agent 数量多，token 消耗大**。一次完整审查要启动至少 8 个 Haiku Agent + 5 个 Sonnet Agent，再加上每个问题一个 Haiku 打分 Agent。对于大 PR，成本不低。

**输出格式里要求完整 SHA**。评论中链接代码行用的是 `https://github.com/.../blob/<full-sha>/...` 格式，不能用 `$(git rev-parse HEAD)` 这种动态拼接——因为评论是 Markdown 渲染的，shell 变量不会被执行。这个细节容易被忽略导致链接失效。

**不能审查自己写的代码**。如果你让 Claude 写了代码再让它审查，因为是同一个 session 的上下文，审查的客观性会打折扣。这个插件设计上是审查别人提的 PR。
