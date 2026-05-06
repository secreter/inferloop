# math-olympiad：竞赛数学对抗验证求解器

一个面向 IMO、Putnam、USAMO 等竞赛数学的求解 skill，核心特点是用对抗式验证（adversarial verification）来抓住自我验证发现不了的证明错误。整个系统比这个仓库里其他所有插件都复杂一个量级。

## 技术原理

这是一个 **skill** 类型的插件，但它的 `SKILL.md` 不是简单的指导文档，而是一套完整的多 Agent 工作流规范，配合 7 个参考文档和 2 个 shell 脚本。

### 整体架构

系统区分两种问题类型：

- **证明题**（IMO/Putnam/USAMO）：走完整的 8 步工作流
- **数值答案题**（AIME 风格）：简化处理，5-7 个求解器多数投票

证明题的完整工作流：

**步骤 1：解题意检查**。在动手之前，列出 2-3 种可能的题意解读，判断哪种是出题者意图。这步的理由是研究数据——63 个"技术上正确"的解中有 50 个解的是错误的题意版本。竞赛题经常故意设一个容易的错误解读作为陷阱。

**步骤 2：并行生成候选解**。启动 8-12 个求解 Agent，每个用不同的切入角度（归纳法、不变量、极端情况、反向推导等）。每个 Agent 内部自带迭代：解题 → 自我改进 → 自我验证 → 纠正 → 重复，最多 5 轮。这个结构来自 Yang-Huang 的 IMO25 研究，单次求解不够，per-attempt refinement 才能达到 85.7% 的 IMO 正确率。

关键约束：**求解 Agent 禁止使用任何工具**。不能跑 Python，不能搜网，不能读文件。纯推理。prompt 里写了 `NO COMPUTATION`，并解释为什么——"I computed n=1..10 and the pattern holds" 不是证明。

**步骤 3：清洗解**。这一步是整个系统最关键的设计。在交给验证器之前，把求解过程中的所有思维痕迹剥掉——"Let me try..."、"Actually wait..."、"Hmm" 这些推导过程全删，只留干净的最终证明。

为什么？因为思维轨迹会偏置验证器。一长串看起来合理的推导过程，即使结论是错的，也会让验证器倾向于同意。这叫"context isolation"，是系统跟普通 verify-and-refine 的第一个核心区别。

**步骤 4：对抗式验证**。为每个清洗后的解启动一个全新的验证 Agent。验证器看到的只有题目和干净证明，不知道求解过程。

验证器不是泛泛地"检查逻辑"，而是带着 12 种具体的错误模式（定义在 `references/verifier_patterns.md`）去**攻击**证明。几个代表性的模式：

- **Pattern #4**：这个证明的骨架如果应用到黎曼 zeta 函数上，是不是证明了一个未解决的公开问题？如果是，证明有 gap。
- **Pattern #40**：证明中最短的一步，提取成一般性引理，找一个 2x2 反例。如果一般引理假但特殊结论对，说明有隐藏结构没被指出。
- **Pattern #18**：把证明链自己建立的恒等式代回最终 gap，看是不是又回到了原始问题——即循环论证。
- **Pattern #5**：每个被引用的定理，从头验证其假设条件是否满足。"entire" 和 "analytic on a domain" 是不同的东西。

**步骤 5：投票验证**。取最好的候选解，投入最多 5 个独立验证器。投票是非对称的：4 票 HOLDS 确认，2 票 HOLE FOUND 否决。为什么非对称？一个不靠谱的验证器不该杀掉一个正确的证明，但两个独立的反对意见是真信号。

双重隔离：每个验证器既看不到求解器的思维过程，也看不到其他验证器的判断。每个验证器都认为自己是第一个也是唯一的审查者。

带鸽巢原理的提前退出：2 个 HOLE FOUND 就停（已否决），4 个 HOLDS 就停（已确认），不浪费剩余的验证器调用。

**步骤 5b：卡壳时的退一步策略**。如果证明分成两种情况，一种容易另一种死活证不出来——先问有没有办法让分类消失。具体案例：证 f(n) ≤ cn 时按素数 p 分情况，一种用指标论秒杀，另一种怎么都不行。退一步发现 "p | f(n)" 代回原方程直接给出 f(p) = p，Fermat+Dirichlet 三行解决两种情况。分情况讨论本身就是弯路。

**步骤 6：修复**。验证找到 hole 后，启动修复 Agent。修复 Agent 看到的是干净证明 + hole 报告，仍然看不到原始思维过程。最多 3 轮修复。如果 Pattern #40 被触发（一行证明太干净），修复 Agent 收到特殊的"对抗简报"，逼它二选一：要么找到让这个特殊情况成立的隐藏结构，要么承认证明是错的。不能回答"看着没问题"。

**步骤 6c：深度模式**。当标准流程放弃后，启动一个不限时、可以使用有限计算的深度 Agent。允许做 mod 运算、小情况枚举（n≤10）、符号恒等式验证，但绝对禁止上网搜索——"Finding the solution on AoPS or a blog is not solving the problem — it's cheating on an olympiad"。60 秒计算时间限制。如果 n≤10 的暴力搜索揭示了纯推理求解器没发现的模式，"that pattern IS the proof structure"。

**步骤 7：校准放弃**。3 轮修复都失败后，诚实报告"没有可信解"。列出尝试了什么、证明了什么（部分结果）、在哪里断了。原文说得直白："A wrong confident answer is worse than an honest 'couldn't solve it.'"

**步骤 8：展示润色**。正确的证明不等于漂亮的证明。发现的顺序几乎从来不是展示的最佳顺序。一个新的展示 Agent（没有发现过程的上下文）拿着验证通过的证明，问四个问题：最简单的说法是什么？哪些引理该内联？有没有用了大炮打蚊子的地方？现在知道答案了，有没有三行的事后证明？最终输出 LaTeX，如果有 `pdflatex` 还会编译成 PDF。

### 模型分级配置

不同模型能力不同，参数不同：

| | Haiku | Sonnet | Opus |
|---|---|---|---|
| 并行求解器数 | 12 | 6 | 4 |
| 验证票数 | 7 (5确认/3否决) | 5 (4/2) | 5通用 + 12专项 |
| 放弃阈值 | 3轮失败 | 3轮失败 | 5轮失败 |
| 展示润色 | 3稿选最佳 | 2稿选最佳 | 3稿不同风格 |

逻辑是：弱模型靠宽度补精度（多开几个求解器），强模型靠深度（更多修复轮次、每个验证模式单独一个 Agent）。

### 辅助文件

- `references/solver_heuristics.md`：Polya 式启发法 + 竞赛专用技巧（不变量、极端元素、双重计数、反演...），还有几何题专用的坐标爆算、辅助点、幂、角度追踪
- `references/verifier_patterns.md`：12 种验证模式的完整说明
- `references/adversarial_prompts.md`：7 种即用型验证器 prompt（通用对抗、Pattern #4、#40、#18、#60、五轮验证、对抗简报）
- `references/presentation_prompts.md`：展示润色 prompt + LaTeX 模板 + 反模式清单
- `references/model_tier_defaults.md`：分模型配置表
- `references/known_constructions.md`：构造法模式（spread vs cluster、moment curve、√n 结构识别）
- `references/attempt_agent.md`：求解 Agent 的完整 prompt 模板
- `scripts/check_latex.sh`：检查 pdflatex/xelatex 是否可用
- `scripts/compile_pdf.sh`：用最小 preamble 包裹证明体编译 PDF
- `evals/trigger_eval.json`：触发评估数据——哪些 query 应该激活这个 skill，哪些不应该

## 安装与配置

```bash
/plugin install math-olympiad@claude-plugins-official
```

如果要 PDF 输出，需要安装 LaTeX：

```bash
# Ubuntu/Debian
sudo apt install texlive-latex-recommended texlive-fonts-recommended

# macOS
brew install --cask mactex-no-gui
```

没有 LaTeX 也能用，只是最终证明以文本形式输出。

## 使用方法

直接把竞赛题丢给 Claude：

```
Solve this IMO problem: Let n ≥ 2 be an integer...
```

```
Prove this olympiad inequality: for positive reals a,b,c with a+b+c=1...
```

```
Is this proof correct? [贴入一段证明]
```

```
Verify my solution to AIME 2024 problem 12
```

对于已有证明的验证，Claude 会跳过求解直接进入步骤 4 的对抗验证。对于"简化这个证明"，直接进入步骤 8 的展示润色。

全套竞赛题（比如 6 道 IMO 题）也支持——按题并行跑完整工作流，最后汇编成一个 PDF。

## 使用场景

**竞赛训练的自动验证**。你写了一个 IMO 题的证明，但不确定有没有漏洞。把证明扔给 `math-olympiad`，它会用 12 种具体模式去攻击你的证明。这比自己重看一遍或者让 ChatGPT"帮我检查"管用得多——因为验证器带着具体的错误模式去找，而不是泛泛地"看看逻辑有没有问题"。

**解题能力的压力测试**。拿到一道难题，不想看别人的解法，想知道 AI 能不能纯靠推理解出来。这个 skill 禁止上网搜索、禁止查 AoPS，是一个真实的求解能力测试。

**证明润色**。你有一个证明但写得不好——发现顺序的叙述方式、用了大炮打蚊子的工具、引理太碎。让展示 Agent 处理一遍，它会找到更简洁的表达方式。

**AIME 级别的答案验证**。做完一套 AIME 想核实答案。5-7 个求解器用不同方法并行解，多数投票。

## 局限与注意事项

**Token 消耗极大**。一个证明题的完整流程：8-12 个求解 Agent（每个内部迭代最多 5 轮）+ 清洗 + 最多 5 个验证器 + 可能的修复循环 + 展示润色。一道题跑下来几十万 token 是常态。六道 IMO 题全跑就更不用说了。

**"禁止工具"靠 prompt 而非技术手段执行**。SKILL.md 自己承认了这一点——"The Agent tool cannot enforce tool restriction. Subagents get the full tool set. The only mechanism is the prompt." 求解 Agent 可能无视 prompt 约束去跑 Python，这会污染证明的可靠性。

**验证器模式偏向分析数论和代数**。12 种验证模式大部分面向的是"证明了太强的结论"、"引用定理条件不满足"、"循环论证"这类分析和代数题常见的错误。组合数学和几何题的专用验证模式相对少。

**自我报告的正确率不等于实际正确率**。SKILL.md 引用了 arXiv:2503.21934 的数据——自我验证声称 85.7% 正确率，但人工审查后不到 5%。这个 skill 的对抗验证比自我验证强很多，但具体能把正确率提到多少，没有给数据。

**深度模式（步骤 6c）的计算限制容易被突破**。60 秒计算限制和 n≤10 枚举限制都是 prompt 级别的约束。而且对于指数增长的递推关系，即使 n≤10 也可能计算量爆炸——SKILL.md 自己提到了 b_{n+1}=2b_n^2+b_n+1 这类双指数增长的例子。

**LaTeX 编译脚本有一个小问题**。`compile_pdf.sh` 里 `\usepackage{enumitem}` 被加载了两次（一次带 `[shortlabels]` 选项，一次不带），某些 LaTeX 版本会报 option clash 警告。不影响编译成功，但日志里会有噪音。

**触发条件可能误判**。`evals/trigger_eval.json` 列出了触发评估数据。像"Explain the proof of the fundamental theorem of calculus to a high schooler"这种不应该触发但包含"proof"关键词的 query，理论上不该触发，但实际行为取决于 Claude 的判断。如果你只是想聊聊数学而不是解竞赛题，可能会意外触发整套工作流。
