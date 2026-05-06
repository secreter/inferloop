# session-report：Claude Code 使用量的可视化分析报告

一句话：session-report 扫描 `~/.claude/projects` 下的 JSONL 会话日志，生成一份自包含的 HTML 报告，展示 token 用量、缓存效率、子 Agent 开销、最贵的 prompt 等指标。

## 技术原理

插件由三个文件组成：

1. **`analyze-sessions.mjs`**（~876 行 Node.js 脚本）—— 扫描日志、统计数据、输出 JSON
2. **`template.html`**（~569 行）—— 报告的交互式前端壳，包含排版、图表、排序表格的全部 JS/CSS
3. **`SKILL.md`** —— 指导 Claude 怎么把两者组合成最终报告

工作流程：

**第一步**：Claude 运行分析脚本：

```bash
node <skill-dir>/analyze-sessions.mjs --json --since 7d > /tmp/session-report.json
```

脚本递归遍历 `~/.claude/projects/`，找到所有 `.jsonl` 文件（主会话、子 Agent 会话、workflow 会话），按类型分类。处理顺序有讲究：先处理主会话文件，再按创建时间排序处理子 Agent 文件。因为子 Agent 的 fork 会话会重放父会话的条目（UUID 相同），先处理父会话可以正确去重。

对每个文件，脚本逐行读取 JSONL，做以下统计：

- **Token 用量**：从 `usage` 字段提取 input_tokens、cache_creation_input_tokens、cache_read_input_tokens、output_tokens。用 requestId 去重（同一个 API 调用会被拆成多行，只取 output_tokens 最大的那条）
- **缓存效率**：cache_read / 总 input_tokens 的比例
- **活跃时间**：相邻消息间隔 > 5 分钟的不计入活跃时长
- **人类消息数**：过滤掉 tool_result、compact_summary、meta 消息、task-notification 等自动续接消息
- **子 Agent 统计**：识别 Agent/Task 工具调用，通过 tool_use_id 把子 Agent 的 token 归因到父级 prompt
- **Skill 调用**：检测 Skill 工具调用和 slash command 消息
- **缓存中断**：单次调用中 uncached input > 100k 的标记为 cache break
- **Prompt 归因**：每条人类消息开启一个 prompt 窗口，后续所有 API 调用（包括子 Agent 调用）的 token 都归到这个 prompt 名下

输出 JSON 包含：`overall`（全局汇总）、`by_project`、`by_subagent_type`、`by_skill`、`cache_breaks`（最多 100 条）、`top_prompts`（最多 100 条）、`by_day`（每天的会话甘特图数据）。

**第二步**：Claude 读取 JSON，把 `template.html` 复制到工作目录。

**第三步**：Claude 用 Edit 工具修改报告：
- 把 JSON 嵌入 `<script id="report-data" type="application/json">` 标签
- 在 `<!-- AGENT: anomalies -->` 区域写 3-5 条发现（比如"某项目占了 41% 的总 token"）
- 在 `<!-- AGENT: optimizations -->` 区域写 1-4 条优化建议

template.html 的前端 JS 从 `#report-data` 读取 JSON，自动渲染：
- Hero 数字（总 token 量）
- 缓存效率指示（>=85% 绿色，<85% 黄色警告）
- 项目维度的 block-char 柱状图
- 每天的会话甘特图（可按天切换，支持键盘左右导航）
- 最贵 prompt 的可展开列表（带 +-2 条上下文消息）
- 缓存中断的可展开列表
- 项目 / 子 Agent 类型 / Skill 的可排序表格

整个 HTML 文件是自包含的（除了一个 Google Fonts 链接）。配色方案参照 Claude Code 的终端调色板，视觉上很像一个终端窗口。

## 安装与配置

```bash
cc --plugin-dir /path/to/session-report
```

依赖 Node.js（运行 analyze-sessions.mjs）。分析的数据来自 `~/.claude/projects/` 目录。

## 使用方法

```
生成一份会话使用报告
```

或

```
/session-report
```

Claude 会按默认窗口（最近 7 天）生成报告。可以指定时间范围：

```
生成最近 24 小时的使用报告
```

```
生成最近 30 天的报告
```

```
生成所有时间的报告
```

报告保存为 `session-report-YYYYMMDD-HHMM.html`，在当前工作目录下。

## 使用场景

**控制 API 成本。** 跑完一周的开发，生成报告看看钱都花在哪了。报告会列出最贵的 prompt，告诉你哪个项目、哪个 slash command 烧的 token 最多。发现某个 Skill 调用平均消耗 1M token，那可能需要优化它的 prompt 或拆分任务。

**诊断缓存问题。** 缓存命中率低于 85% 报告会用黄色标出。缓存中断列表显示哪些调用发生了大规模 uncached input，点开能看到触发中断的具体 prompt 上下文。常见原因：频繁切换项目、子 Agent 太多各跑各的上下文。

**评估子 Agent 的性价比。** 按子 Agent 类型汇总的表格能看到每种 Agent 的平均 token 消耗。如果某个 Agent 类型平均每次调用 >1M token，说明它的任务粒度可能太粗。

**团队用量分析。** 如果多人共用一台开发机或者日志集中存储，全量报告能看到所有项目的用量分布和时间线。甘特图的峰值并发数能帮你判断是否需要调整并行会话数。

**发现低效模式。** 报告的 "findings" 区域由 Claude 根据数据写出 3-5 条发现，比如"某项目只有 3 个会话但占了 41% 的 token"、"某个 prompt 单次消耗了总量的 5%"。这些异常往往指向可以优化的地方。

## 局限与注意事项

**数据来源单一。** 只读 `~/.claude/projects/` 下的 JSONL 文件。如果你用了非标准路径，或者日志被清理过，分析就不完整。可以用 `--dir` 参数指定其他目录，但需要手动改 SKILL.md 里的命令。

**大量日志时性能一般。** 脚本对每个文件逐行读取，全量扫描。几个月的重度使用可能产生几千个 JSONL 文件，分析可能要跑几十秒。

**token 计数是近似的。** JSONL 的格式是"经验发现的"（脚本注释原文："discovered empirically"）。同一个 API 响应被拆成多行，脚本用 requestId 去重并取 output_tokens 最大值来避免重复计数。但 Claude Code 的日志格式没有正式规范，未来可能变化。

**不计费用。** 报告只有 token 数量，没有按 model pricing 换算成美元。你需要自己查对应模型的价格来估算。

**findings 和 recommendations 由 Claude 写。** 这两个区域的内容不是脚本产出的，是 Claude 看完 JSON 数据后写的分析。质量取决于 Claude 的当次表现，不能当作权威审计报告。

**Google Fonts 依赖。** template.html 引用了 Google Fonts 的 JetBrains Mono 字体。离线环境下字体会 fallback 到系统等宽字体，不影响功能但视觉效果打折。

**JSON 体积。** 如果使用量大，嵌入 HTML 的 JSON 可能有好几 MB。SKILL.md 里写了超过 2MB 时应裁剪 top_prompts 和 cache_breaks 到各 100 条，但 Claude 不一定每次都记得做。
