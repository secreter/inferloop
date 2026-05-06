# claude-md-management：CLAUDE.md 维护工具

审计和改进 CLAUDE.md 文件质量，从会话中提取经验写回项目记忆。两个工具，一个管长期维护，一个管即时捕获。

## 技术原理

插件包含两个组件，用途不同，互相补充：

### claude-md-improver（模型触发型 skill）

当你说"审计我的 CLAUDE.md"、"检查 CLAUDE.md 是否过时"时触发。工作流分五步：

1. **发现**：`find . -name "CLAUDE.md"` 找出仓库里所有 CLAUDE.md 文件，包括 `.claude.local.md`（个人本地配置）和子目录里的（monorepo 各包的配置）
2. **评估**：对每个文件按六个维度打分，总分 100

| 维度 | 权重 | 检查内容 |
|------|------|----------|
| 命令/工作流 | 20 分 | build、test、lint、deploy 命令是否齐全 |
| 架构清晰度 | 20 分 | 目录结构、模块关系、入口文件是否说明 |
| 非显而易见的模式 | 15 分 | gotcha、quirk、workaround 是否记录 |
| 简洁性 | 15 分 | 有没有废话、有没有重复代码注释 |
| 时效性 | 15 分 | 命令还能用吗、文件路径还对吗 |
| 可操作性 | 15 分 | 命令能直接复制粘贴吗、步骤够具体吗 |

3. **报告**：输出评分表和具体问题列表
4. **提议修改**：以 diff 格式展示建议的修改，附带修改理由
5. **经用户确认后执行**：用 Edit 工具写入文件

评分标准定义在 `references/quality-criteria.md` 里，是一套详细的 rubric。比如"命令/工作流"维度，20 分是"所有关键命令都有上下文说明"，10 分是"只有基础命令，没有工作流"，0 分是"完全没有命令文档"。

`references/templates.md` 提供了四种 CLAUDE.md 模板：最小项目根目录版、完整项目根目录版、monorepo 子包版、monorepo 根目录版。

`references/update-guidelines.md` 定义了什么该写、什么不该写。该写的：发现的命令和工作流、gotcha、包之间的依赖关系、有效的测试方式、配置怪癖。不该写的：从类名就能看出来的信息、通用最佳实践、一次性 bug 修复、长篇大论。

### /revise-claude-md（slash command）

用在会话结束时，回顾整个对话过程中发现的知识，提取出来写进 CLAUDE.md。

指令很短，核心逻辑是：

1. 反思这次会话中什么上下文是缺失的——哪些 bash 命令是探索发现的、哪些代码风格是遵循的、哪些环境配置有坑
2. 找到所有 CLAUDE.md 文件，判断每条信息该写在哪里——团队共享的写 `CLAUDE.md`，个人偏好的写 `.claude.local.md`
3. 每条只写一行，格式是 `<命令或模式> - <简短说明>`
4. 展示 diff，等用户确认后再写入

allowed-tools 限制为 `Read, Edit, Glob`，没有 Bash 和 Write，降低了误操作风险。

## 安装与配置

```bash
/plugin install claude-md-management@claude-plugins-official
```

无配置项。

## 使用方法

审计 CLAUDE.md 质量：

```
审计我的 CLAUDE.md 文件
```

```
检查 CLAUDE.md 是不是过时了
```

在会话结束时捕获经验：

```
/revise-claude-md
```

## 使用场景

**项目改了很多但 CLAUDE.md 没跟上**。三个月前写的 CLAUDE.md，期间重构了目录结构、换了测试框架、加了新的部署脚本。跑一次审计，skill 会交叉验证文件路径是否存在、命令是否还能跑，找出过时的部分。

**接手一个 CLAUDE.md 写得很烂的项目**。评分低于 C 级（50 分以下）的 CLAUDE.md，skill 会根据项目实际情况生成补充建议。比如检测到 Jest 配置但 CLAUDE.md 没提测试命令，它会建议加上。

**长会话结束前保存经验**。花了两小时调一个部署问题，中间发现了一堆环境配置的坑。对话快结束时打 `/revise-claude-md`，Claude 会回顾对话记录，把那些坑提炼成一行行的 gotcha 写进 CLAUDE.md，下次新会话不用重新踩。

**monorepo 的多级 CLAUDE.md 管理**。monorepo 里根目录一个 CLAUDE.md，各包目录各一个。Claude 自动发现所有层级的文件，针对各自内容分别评估。根目录的可能缺跨包依赖说明，子包的可能缺包特有的构建命令。

## 局限与注意事项

- 评分带主观性。100 分制的评分标准虽然有 rubric，但 Claude 的打分不可能完全一致。同一个文件跑两次，分数可能差 5-10 分。把分数当参考，别当 KPI
- "时效性"检查不是真的跑命令。Claude 会"心算"或推断命令是否能跑（比如看 package.json 里有没有对应的 script），但不会真的执行 `npm run build` 验证
- `/revise-claude-md` 依赖会话上下文。如果对话很短或者没做什么有价值的探索，提取出来的东西很有限
- 有个快捷操作值得知道：Claude Code 里按 `#` 键，Claude 会自动把当前上下文学习到的东西写入 CLAUDE.md。`/revise-claude-md` 做的事更系统化，但 `#` 更适合随手记
