# feature-dev：结构化功能开发工作流

一套七阶段的功能开发流程。不是直接写代码，而是先理解代码库、问清楚需求、设计架构方案、选定后再实现，最后代码审查。通过三类 subagent（code-explorer、code-architect、code-reviewer）并行工作。

## 技术原理

插件包含一个 slash command（`/feature-dev`）和三个 agent 定义。核心逻辑全在 command 文件里——它是一份给 Claude 的分阶段工作指令。

### 七阶段流程

**Phase 1: Discovery** —— 理解需求。如果用户的描述含糊，Claude 会主动追问：解决什么问题？有什么约束？期望什么结果？

**Phase 2: Codebase Exploration** —— 这一步是这个插件最有意思的地方。Claude 会并行启动 2-3 个 `code-explorer` subagent，每个探索不同维度：

```
- "Find features similar to [feature] and trace implementation"
- "Map the architecture and abstractions for [area]"
- "Analyze current implementation of [related feature]"
```

每个 subagent 跑在独立的上下文窗口里，用 sonnet 模型，有 Glob、Grep、Read 等只读工具。它们的任务是追踪代码执行路径——从入口点到数据存储，经过所有抽象层，记录关键文件路径和行号。

subagent 返回后，Claude 会读取它们标注的所有关键文件，构建对现有代码的深度理解。

**Phase 3: Clarifying Questions** —— 命令里用了加粗和大写标注：**CRITICAL: This is one of the most important phases. DO NOT SKIP.** 这说明在实际使用中，Claude 经常想跳过这步直接开干。这个阶段的要求是：列出所有含糊的地方——边界情况、错误处理、集成点、向后兼容、性能需求——然后等用户回答。

**Phase 4: Architecture Design** —— 并行启动 2-3 个 `code-architect` subagent，各自用不同策略：
- 最小改动：最少的变更、最大化复用
- 清晰架构：可维护性优先、抽象设计
- 务实平衡：速度和质量折中

Claude 汇总所有方案，形成自己的推荐意见，然后让用户选。

**Phase 5: Implementation** —— 需要用户明确批准才开始。写代码时严格遵循 Phase 2 发现的代码风格和 Phase 4 选定的架构。

**Phase 6: Quality Review** —— 并行启动 3 个 `code-reviewer` subagent：
- 简洁性/DRY/可读性
- bug/逻辑正确性
- 项目规范/抽象一致性

每个 reviewer 对发现的问题标注置信度（0-100），只报告置信度 80 以上的。这个阈值设定是为了减少误报——误报太多会让人烦了直接忽略。

**Phase 7: Summary** —— 输出完成报告：做了什么、关键决策、修改了哪些文件、下一步建议。

### Agent 设计

三个 agent 的共同特点：

- 都用 sonnet 模型，不用 opus——在 subagent 场景下 sonnet 的性价比更高
- 都有 `color` 字段（yellow、green、red），终端里能直观区分
- tools 列表中有 `BashOutput`（Bash 工具的只读输出变体）和 `KillShell`（终止挂起的 shell 进程），但没有 `Write` 和 `Edit`——explorer 和 reviewer 是只读的
- code-architect 也没有写权限，它只输出设计蓝图，不动代码

code-reviewer 的 description 里明确写了"review unstaged changes from `git diff`"——默认审查未提交的变更，不是整个代码库。

## 安装与配置

```bash
/plugin install feature-dev@claude-plugins-official
```

无额外依赖。需要在 git 仓库里使用（Phase 6 依赖 git diff）。

## 使用方法

```
/feature-dev 给 API 端点加上速率限制
```

或者不带参数：

```
/feature-dev
```

Claude 会问你想做什么。

也可以单独调用 agent，不走完整流程：

```
启动 code-explorer 看一下认证模块是怎么实现的
```

```
启动 code-reviewer 检查我刚写的代码
```

## 使用场景

**中大型功能开发**。涉及多个文件、需要架构决策的功能。比如"给现有系统加 OAuth 登录"——需要先理解现有的认证机制、会话管理、路由结构，再决定怎么集成。这正是 Phase 2 和 Phase 4 发力的地方。

**不熟悉的代码库里做开发**。接手一个不了解的项目要加功能，Phase 2 的代码探索能帮你快速建立对项目的理解。三个 explorer 并行跑，各自追踪不同维度，比自己一个文件一个文件读高效得多。

**需要多种方案对比的场景**。Phase 4 的多架构方案设计在做技术决策时很有用。"最小改动"方案能看到 quick fix 的样子，"清晰架构"方案能看到理想重构的样子，"务实平衡"方案居中。各自的 trade-off 摆出来，选起来有谱。

**单独用 code-reviewer 做代码审查**。不走完整流程，只在写完代码后启动 code-reviewer。它会读 CLAUDE.md 里的项目规范，对照检查代码。置信度过滤保证了报出来的问题多数是真问题。

## 局限与注意事项

- 完整七阶段流程很耗时间和 token。简单的 bug 修复或者改个配置文件，不要用这个插件，直接做就行
- Phase 2 的 subagent 探索在大代码库上可能跑很久。官方说法是"this is normal for large codebases"，但如果你的项目有几万个文件，等待时间会比较可观
- Phase 3 问的问题有时候太多。如果你对需求很明确，可以说"你觉得合理就行"来跳过，但 Claude 会给出它的建议再让你确认，不会完全跳过
- Phase 4 生成的架构方案质量取决于 Phase 2 的代码探索结果。如果 explorer 没找到相关的代码，architect 设计的方案可能脱离项目实际
- 三个 agent 都不能执行写操作。所有代码修改都由主会话的 Claude 完成，subagent 只负责分析和审查
- 命令里用了 `TodoWrite` 跟踪进度。如果你的 Claude Code 环境不支持 TodoWrite 工具，部分流程会有差异
