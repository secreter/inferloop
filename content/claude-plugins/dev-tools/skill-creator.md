# skill-creator：Skill 创建与迭代优化

一个用来做 skill 的 skill。覆盖 skill 开发的完整生命周期：从需求澄清到草稿编写、测试用例设计、并行运行评估、定量打分、人工审查、迭代改进，最后还有一套 description 触发率的自动优化流程。

## 技术原理

整个插件只有一个 skill（`skill-creator`），但它内部集成了完整的工程化评估体系。

### 核心循环

skill-creator 的工作流是一个"写-测-评-改"的迭代循环：

1. **澄清意图** —— 这个 skill 要做什么？什么时候触发？输出格式是什么？要不要设测试用例？
2. **写草稿** —— 填 frontmatter（name、description）、写正文指令、规划 references/scripts/assets 目录
3. **跑测试** —— 写 2-3 个真实测试 prompt，对每个 prompt 并行启动两个 subagent：一个带 skill 跑（with_skill），一个不带 skill 跑（without_skill/baseline）。同时 draft 定量断言
4. **评估** —— grader agent 对每个 run 的输出做断言检查，aggregate_benchmark.py 汇总统计数据，generate_review.py 生成一个浏览器 HTML 查看器给用户看
5. **用户反馈** —— 用户在查看器里逐条审查输出、写评论，提交后生成 feedback.json
6. **改进 skill** —— 根据反馈修改 skill，重新跑测试，循环直到满意

这个流程的工程化程度远超一般的 prompt 调优。它有严格的文件组织约定：

```
skill-name-workspace/
├── iteration-1/
│   ├── eval-descriptive-name/
│   │   ├── eval_metadata.json
│   │   ├── with_skill/
│   │   │   ├── outputs/
│   │   │   ├── timing.json
│   │   │   └── grading.json
│   │   └── without_skill/
│   │       ├── outputs/
│   │       ├── timing.json
│   │       └── grading.json
│   ├── benchmark.json
│   └── benchmark.md
├── iteration-2/
│   └── ...
└── feedback.json
```

### 三个 Agent

**grader** —— 读 transcript 和输出文件，对每个 assertion 判 pass/fail 并引用证据。有意思的是它有"批评 eval"的职责——如果某个 assertion 太弱（一个错误输出也能过）或者有重要结果没有 assertion 覆盖，它会主动指出来。grading.json 里的 `eval_feedback` 字段就是干这个的。

**comparator** —— 盲评。两个输出标记为 A 和 B，不告诉评估者哪个来自哪个 skill 版本。基于自动生成的评分 rubric（内容和结构两个维度，各三个子项，5 分制）打分，加上 assertion 通过率做辅助参考。这个设计借鉴了 AI 对齐研究中消除评估偏差的思路。

**analyzer** —— 分析 benchmark 结果中的模式。比如某个 assertion 在 with_skill 和 without_skill 下都 100% pass——说明这个 assertion 没有区分度，不能证明 skill 有用。或者某个 eval 方差特别大——可能是 flaky test。这些 aggregate 统计看不出来的洞察由 analyzer 挖掘。

### Python 脚本

`scripts/` 目录下有一组 Python 工具：

- `run_eval.py` —— 用 `claude -p` 命令行接口跑单次评估
- `run_loop.py` —— description 触发率优化循环。把 eval query 分 60%/40% 训练/测试集，每个 query 跑 3 次计算触发率，用 extended thinking 提出改进方案，迭代最多 5 轮，按测试集分数选最佳 description（而不是训练集，避免过拟合）
- `aggregate_benchmark.py` —— 汇总多次 run 的统计数据
- `generate_report.py` —— 生成文本报告
- `improve_description.py` —— 单次 description 改进
- `quick_validate.py` —— 快速校验 skill 格式
- `package_skill.py` —— 打包成 .skill 文件

### Description 优化

这是个独立的子流程，解决一个实际问题：skill 的 description 写得不好，Claude 该用的时候不用，不该用的时候乱用。

流程是：

1. 生成 20 条 eval query（10 条该触发 + 10 条不该触发），要求必须真实——不能写"Format this data"这种抽象 prompt，要写"ok so my boss just sent me this xlsx file called 'Q4 sales final FINAL v2.xlsx'..."这种带上下文的真实表述
2. 用 HTML 模板让用户审查和编辑这些 query
3. `run_loop.py` 跑自动优化——训练/测试集拆分、多次触发测试、Claude extended thinking 提出改进、迭代评估
4. 取测试集上表现最好的 description 更新 SKILL.md

SKILL.md 里对此有一段解释："Claude 有'欠触发'的倾向——该用 skill 时不用。为了对抗这个，description 要写得稍微'主动'一些。"具体做法是在 description 末尾加"Make sure to use this skill whenever the user mentions X, Y, Z, even if they don't explicitly ask for..."

### 适配不同环境

SKILL.md 里专门写了三种环境的差异处理：

- **Claude Code**：完整功能，有 subagent、有浏览器、有 `claude -p` CLI
- **Claude.ai**：没有 subagent，测试用例只能串行跑，跳过 baseline 对比和定量 benchmark，用对话内直接展示结果代替浏览器查看器
- **Cowork**：有 subagent 但没有浏览器显示，生成静态 HTML 文件让用户下载查看，feedback 通过文件下载回传

## 安装与配置

```bash
/plugin install skill-creator@claude-plugins-official
```

Python 脚本需要 Python 3 环境。description 优化功能需要 `claude` CLI 工具（Claude Code 环境自带）。

## 使用方法

从零开始创建 skill：

```
我想做一个 skill，帮我把 markdown 表格转成 Excel 文件
```

改进现有 skill：

```
这个 skill 跑出来的结果不太好，帮我优化一下
```

优化 skill 触发率：

```
优化一下这个 skill 的 description
```

跑 benchmark 对比：

```
跑个 benchmark 看看新版 skill 和旧版的差距
```

## 使用场景

**正经做一个准备长期用的 skill**。如果你的 skill 会被用很多次（团队共用、或者自己频繁使用），投入时间做几轮迭代是值得的。skill-creator 的评估体系能客观量化"加了 skill 后比没加好多少"——pass rate 提升了多少、哪些 case 还没覆盖。

**从一次成功的对话中提取 skill**。你跟 Claude 的一次对话里摸索出了一套好用的工作流。说"把这个变成 skill"，skill-creator 会从对话历史里提取步骤、用过的工具、你做的修正，整理成 SKILL.md。

**调试一个"不怎么被触发"的 skill**。写了个 skill 但 Claude 经常不用。description 优化流程专门解决这个问题——生成真实 query，测试触发率，自动迭代 description 文本。

**量化评估 skill 改进效果**。改了 skill 指令，怎么知道是变好了还是变差了？跑 benchmark，with_skill vs without_skill（或 old_skill vs new_skill），看 pass rate、执行时间、token 消耗的对比。盲评（comparator）还能消除知道"哪个是新版"带来的评估偏差。

## 局限与注意事项

- 完整的迭代评估流程非常消耗 token。每轮迭代要跑 2-3 个测试 prompt，每个 prompt 启动两个 subagent（with_skill 和 baseline），再加 grader、analyzer。一个三轮迭代的优化过程，token 消耗可能超过你日常用量的几倍
- 这套流程对"输出可客观验证"的 skill 效果好（文件转换、数据提取、代码生成、固定工作流步骤），对"输出偏主观"的 skill（写作风格、设计质量）效果有限。SKILL.md 里也说了：主观类 skill 别硬套 assertion，用人工评审就行
- description 优化的 `run_loop.py` 依赖 `claude -p` 命令行接口。Claude.ai 环境下这个功能用不了
- 浏览器查看器（generate_review.py）在无头环境（服务器、CI）里需要加 `--static` 参数生成静态 HTML。SKILL.md 里强调了好几次"一定要用 generate_review.py 生成查看器，不要自己手写 HTML"——看来 Claude 经常想自己生成
- eval query 的质量决定了优化效果。SKILL.md 花了大量篇幅教怎么写好的 eval query：不能太抽象、should-not-trigger 的 case 要是"近似miss"而不是明显无关、要有上下文细节和口语化表达。这部分写得非常实在
- `.skill` 打包功能需要 `present_files` 工具。不是所有环境都有这个工具，没有就跳过打包步骤
