# ralph-loop：让 Claude 在同一个 prompt 上反复迭代直到完成

一句话：ralph-loop 用 Stop hook 拦截 Claude 的退出，把同一个 prompt 反复喂回去，形成自动迭代循环，直到任务完成或达到迭代上限。

> 名字来源："Ralph Wiggum 技术"是 Claude Code 社区给这种迭代模式起的别名，取自动画《辛普森一家》里那个不断重复同一件事的角色 Ralph Wiggum。核心思路是让 Claude 在一个 while-true 循环里反复执行同一个任务描述，每轮迭代都在上一轮的基础上推进，直到满足完成条件。

## 技术原理

传统的 Ralph 循环是在终端里写一个 `while true; do cat PROMPT.md | claude-code --continue; done`。这个插件把循环搬进了 Claude Code 的会话内部，用 Stop hook 实现。

整个插件由三个部分组成：

**1. setup 脚本（`scripts/setup-ralph-loop.sh`）**

`/ralph-loop` 命令触发这个 bash 脚本。它做的事情很简单：解析参数，在 `.claude/ralph-loop.local.md` 里写入一个状态文件。状态文件格式是 markdown + YAML frontmatter：

```markdown
---
active: true
iteration: 1
session_id: xxx
max_iterations: 20
completion_promise: "DONE"
started_at: "2026-04-13T10:00:00Z"
---

Build a REST API for todos. Output <promise>DONE</promise> when complete.
```

frontmatter 存元数据，正文存 prompt。

**2. Stop hook（`hooks/stop-hook.sh`）**

这是核心。它注册在 hooks.json 的 `Stop` 事件上。每次 Claude 完成一轮工作准备退出时，这个脚本被调用：

- 检查 `.claude/ralph-loop.local.md` 是否存在。不存在就放行退出
- 校验 session_id——别的会话不应该被这个循环拦截
- 验证 iteration 和 max_iterations 是合法数字（防损坏）
- 检查是否达到 max_iterations 上限
- 从 hook 输入拿到 transcript_path，读取最新的 assistant 消息
- 检查消息里是否包含 `<promise>COMPLETION_PROMISE</promise>` 标签
- 如果 promise 匹配，清理状态文件，放行退出
- 如果不匹配，递增 iteration，把同一个 prompt 塞进 `reason` 字段返回，同时返回 `"decision": "block"` 阻止退出

返回值的结构：

```json
{
  "decision": "block",
  "reason": "Build a REST API for todos...",
  "systemMessage": "Ralph iteration 2 | To stop: output <promise>DONE</promise>"
}
```

`reason` 字段的内容就是下一轮 Claude 看到的 prompt。Claude 的上下文里还保留着之前所有的工作（文件修改、git history），所以它能在之前的基础上继续。

**3. cancel 命令（`commands/cancel-ralph.md`）**

删除 `.claude/ralph-loop.local.md` 文件，循环停止。

promise 匹配机制值得说一下。脚本用 Perl 从 assistant 输出中提取 `<promise>...</promise>` 标签里的文本，去掉首尾空白、合并连续空白后，跟 `completion_promise` 做精确字符串比较（不是 glob，不是正则）。这意味着 promise 不能有多个变体。

另一个细节：脚本对 transcript 的解析做了限制——只取最后 100 行 assistant 消息，避免 jq 处理过多数据。

## 安装与配置

```bash
cc --plugin-dir /path/to/ralph-loop
```

依赖：bash、jq、perl（用于解析 promise 标签）。macOS 和 Linux 自带。Windows 需要 Git Bash（不是 WSL bash）。

## 使用方法

```bash
/ralph-loop "Build a REST API for todos. Requirements: CRUD operations, input validation, tests. Output <promise>COMPLETE</promise> when done." --completion-promise "COMPLETE" --max-iterations 50
```

参数：
- 第一个参数是 prompt（可以不加引号，多个词会被拼接）
- `--max-iterations N`：迭代上限，到了自动停
- `--completion-promise "TEXT"`：完成标记，Claude 输出 `<promise>TEXT</promise>` 时停止

取消正在运行的循环：

```bash
/cancel-ralph
```

查看当前迭代数：

```bash
grep '^iteration:' .claude/ralph-loop.local.md
```

## 使用场景

**TDD 循环。** prompt 写"写失败测试 -> 实现功能 -> 跑测试 -> 失败就修 -> 全过就完"。Claude 会自己跑 `npm test`，看到红色修代码，看到绿色继续写下一个测试，直到所有需求覆盖。

```
/ralph-loop "Implement a token refresh module in auth.ts using TDD. Write a failing test, implement, run tests, fix if red. Output <promise>ALL GREEN</promise> when all tests pass." --completion-promise "ALL GREEN" --max-iterations 15
```

**Greenfield 项目的过夜生成。** 你写好一份详细的需求文档作为 prompt，设 50 次迭代，丢在那不管。第二天早上回来看结果。Ralph 的作者在 Y Combinator 的 hackathon 上用这种方式一晚上生成了 6 个仓库。

**渐进式重构。** prompt 里分阶段写：Phase 1 提取模块，Phase 2 加接口，Phase 3 写测试。Claude 每轮结束后被拦回来，继续下一个 Phase。

**自动化 bug 修复。** "修 auth.ts 里的 token 刷新逻辑，跑测试，直到全过。" Claude 会反复尝试不同修法，每次都能看到之前的尝试（在 git history 和文件里），直到测试全绿。

## 局限与注意事项

**没有 max-iterations 就是无限循环。** 默认不设上限。如果你的 prompt 没有明确的 completion promise，或者 promise 条件永远达不到，循环不会自己停。始终建议加 `--max-iterations`。

**API 成本。** 每次迭代都是一次完整的 Claude 调用。50 次迭代的复杂任务很容易烧掉几十美元。README 里提到一个案例：$50k 的合同用 $297 API 成本完成——但这是最好情况。

**completion-promise 只支持精确匹配。** 不能设两个不同的完成条件（比如"SUCCESS"和"BLOCKED"），也不支持正则。如果你需要 Claude 在卡住时走不同的退出路径，promise 机制做不到。得靠 max-iterations 兜底。

**Claude 可能会为了退出循环而说谎。** 命令的指令里反复强调"不要输出虚假的 promise"，setup 脚本打印了一大段警告文字。但在长时间运行后，模型确实可能"偷懒"输出 promise 来结束循环。这是一个本质性的问题，目前只靠 prompt 约束来缓解。

**状态文件是项目级别的。** `.claude/ralph-loop.local.md` 放在项目目录下。如果你在同一个项目里开了另一个 Claude Code 会话，stop hook 会检查 session_id 来避免误拦截。但这个隔离依赖状态文件里有 session_id 字段——旧版本的状态文件可能没有。

**Windows 兼容性有坑。** `bash` 命令可能指向 WSL 的 bash 而不是 Git Bash，导致 hook 脚本报错。需要手动改 hooks.json 把命令路径指向 `C:/Program Files/Git/bin/bash.exe`。

**prompt 不可变。** 循环里每次喂的 prompt 完全一样。如果你想根据进度动态调整 prompt，这个机制不支持。Claude 只能靠读取文件和 git history 来感知进度变化。
