# learning-output-style：交互式学习输出风格

在 `explanatory-output-style` 的基础上更进一步——不只解释，还会在关键决策点停下来，要求用户自己写 5-10 行代码，把编码过程变成一个交互式学习体验。

## 技术原理

实现方式与 `explanatory-output-style` 完全相同：一个 `SessionStart` hook 执行 `hooks-handlers/session-start.sh`，输出 JSON 把指令注入到 `additionalContext` 里。

但注入的指令内容复杂得多，包含两大部分：

**学习模式（Learning Mode）**。这是跟 explanatory 的核心区别。Claude 不再全程写代码，而是在遇到"有意义的决策点"时停下来，让用户自己写。

什么算"有意义的决策点"？指令列了 6 类：

- 有多种合理方案的业务逻辑
- 错误处理策略选择
- 算法实现选择
- 数据结构选择
- 影响用户体验的决策
- 设计模式和架构选择

什么**不**应该让用户写？也列了 4 类：

- 样板代码、重复性代码
- 没有什么选择空间的显然实现
- 配置和初始化代码
- 简单的 CRUD

让用户写之前，Claude 要做准备工作：创建文件和周围的上下文代码、写好函数签名和参数/返回类型、加上注释说明目的、在具体位置留 TODO 或占位符。然后向用户解释为什么这个决策重要，有哪些 trade-off 要考虑。

**解释模式（Explanatory Mode）**。完整继承了 `explanatory-output-style` 的 insight 块功能，格式和规则一模一样。

指令里给的示例：

> Context: I've set up the authentication middleware. The session timeout behavior is a security vs. UX trade-off — should sessions auto-extend on activity, or have a hard timeout? This affects both security posture and user experience.
>
> Request: In auth/middleware.ts, implement the handleSessionTimeout() function to define the timeout behavior.
>
> Guidance: Consider: auto-extending improves UX but may leave sessions open longer; hard timeouts are more secure but might frustrate active users.

这种模式的设计意图是：把编码从"Claude 做你看"变成"Claude 搭框架你填核心逻辑"。

## 安装与配置

```bash
/plugin install learning-output-style@claude-plugins-official
```

零配置。如果已经装了 `explanatory-output-style`，建议先卸载再装这个，因为功能是超集关系。

## 使用方法

装好后正常使用 Claude。它会自动在合适的时机停下来让你写代码。

一个典型的交互流程：

```
你：帮我实现用户认证模块

Claude：我已经创建了项目结构和基础代码...
[写好了路由、中间件框架、类型定义]

`★ Insight ─────────────────────────────────────`
JWT 和 session-based 认证在这个项目中各有场景...
`─────────────────────────────────────────────────`

现在需要你来决定 token 刷新策略。在 auth/tokenRefresh.ts 里，
我已经写好了 refreshToken() 函数的签名和周围代码。

这里有一个核心 trade-off：
- 滑动窗口刷新：每次请求都延长 token 有效期，用户体验好但安全窗口更大
- 固定过期 + 显式刷新：更安全但用户可能被突然踢出
- 双 token 策略：access token 短期 + refresh token 长期，平衡但实现复杂

请在 auth/tokenRefresh.ts 的 TODO 位置实现你选择的策略（大约 5-10 行）。

你：[写了代码]

Claude：[继续推进，到下一个决策点再停]
```

## 使用场景

**新手入职的引导式编码**。新人要在项目里加一个功能，但对代码库不熟悉。用 learning 模式，Claude 搭好框架和上下文，新人只需要写核心的业务逻辑。这比让新人从零开始写效率高，又比让 Claude 全写了新人什么都学不到强。

**学习新领域的编程概念**。你是前端开发，要写后端 API。Claude 帮你搭好 Express 路由、中间件管道、数据库连接，但在"请求验证策略"、"错误响应格式"、"数据库事务边界"这些地方让你自己来。你被迫思考这些后端特有的问题，比纯看教程印象深。

**技术面试准备**。让 Claude 出一个系统设计题然后引导你实现。它搭好基础设施代码，在算法选择、数据结构设计、并发处理这些面试会考的点停下来让你写。

**结对编程模拟**。一个人写代码时没人讨论。learning 模式相当于有一个搭档帮你干脏活但在关键决策处跟你讨论 trade-off。

## 局限与注意事项

**会显著降低编码速度**。每到一个决策点就停下来等你写，一个功能实现下来要比全自动慢好几倍。这是设计意图——学习需要时间——但如果你赶进度，这个模式会让你抓狂。

**决策点的选择靠 Claude 判断**。什么时候该停下来、什么时候该自己写，完全由 Claude 自行决定。有时候它会在无关紧要的地方停（"请选择日志格式"），有时候在关键地方一笔带过。没有机制让你校准它的判断标准。

**用户写的代码质量不受控**。Claude 让你写 5-10 行代码，你写了一段有 bug 的。Claude 接下来会在这段有 bug 的代码基础上继续搭建。虽然它可能会在后续发现问题，但也可能不会。

**5-10 行的限制有时候不现实**。有些决策不是 5 行代码能表达清楚的。比如一个复杂的状态机转换逻辑可能需要 30 行。硬限制在 5-10 行会导致 Claude 把一个大问题拆得过碎。

**跟 explanatory-output-style 不要同时装**。两个插件的 explanatory 部分是重复的。同时装了会在系统提示里出现两份 insight 指令，Claude 可能会输出双倍的 insight 块。

**不适合所有类型的任务**。让 Claude 帮你改个 typo、调个 CSS 间距、加个 import——这些场景不需要学习模式。插件没有根据任务类型自动关闭的机制。

**这是一个"未发布"功能的复刻**。plugin.json 的描述说 "mimics the unshipped Learning output style"——这个功能在官方版本中从未正式上线。作为插件复刻出来，说明官方可能对它的效果还不够满意，但社区可以先用着。
