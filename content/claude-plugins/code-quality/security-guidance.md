# security-guidance：编辑时的安全风险提醒

一个 PreToolUse hook 插件，在 Claude 编辑文件时实时检测安全风险模式（命令注入、XSS、不安全的反序列化等），弹出警告阻止操作。

## 技术原理

这个插件跟前面几个完全不同——它不用 Agent、不用 command、不用 skill，纯粹靠 **hook** 机制工作。

核心是一个 Python 脚本 `hooks/security_reminder_hook.py`，通过 `hooks.json` 注册为 `PreToolUse` hook，匹配 `Edit|Write|MultiEdit` 三种文件编辑工具。每当 Claude 要写文件或编辑文件时，这个 hook 都会先跑一遍。

检测逻辑分两类：

**路径匹配**。检查被编辑文件的路径。目前只有一条规则：如果文件在 `.github/workflows/` 下且是 `.yml` 或 `.yaml`，触发 GitHub Actions 安全提醒——列出所有容易被命令注入的 `github.event.*` 变量，给出安全写法示例。

**内容匹配**。检查编辑内容中的子字符串。目前有 8 条规则：

| 规则 | 检测内容 | 风险 |
|------|---------|------|
| `child_process_exec` | `child_process.exec`、`exec(`、`execSync(` | 命令注入 |
| `new_function_injection` | `new Function` | 代码注入 |
| `eval_injection` | `eval(` | 任意代码执行 |
| `react_dangerously_set_html` | `dangerouslySetInnerHTML` | XSS |
| `document_write_xss` | `document.write` | XSS |
| `innerHTML_xss` | `.innerHTML =`、`.innerHTML=` | XSS |
| `pickle_deserialization` | `pickle` | Python 反序列化执行 |
| `os_system_injection` | `os.system`、`from os import system` | 命令注入 |

检测触发后，脚本以退出码 2 退出（`PreToolUse` hook 的退出码 2 表示阻止工具执行），并把警告信息输出到 stderr。

**去重机制**。同一个 session 中，同一个文件的同一条规则只触发一次。去重状态存在 `~/.claude/security_warnings_state_{session_id}.json` 里。也就是说，如果你在同一个 session 里第二次往同一个文件里写 `eval(`，不会再次弹窗。

**状态文件清理**。每次 hook 执行有 10% 的概率清理 30 天以上的旧状态文件。用随机概率而非定时任务，算是个简单的自清理机制。

**开关**。通过环境变量 `ENABLE_SECURITY_REMINDER` 控制。设为 `"0"` 关闭，默认开启。

从 stdin 读取 hook 输入，解析 JSON 获取 `session_id`、`tool_name`、`tool_input`。对于 `Write` 工具取 `content` 字段，对于 `Edit` 取 `new_string` 字段，对于 `MultiEdit` 拼接所有 `edits` 的 `new_string`。

## 安装与配置

```bash
/plugin install security-guidance@claude-plugins-official
```

关闭安全提醒（不推荐）：

```bash
export ENABLE_SECURITY_REMINDER=0
```

需要 Python 3 环境。

## 使用方法

这个插件是被动的——你不需要调用它，它自己会在 Claude 编辑文件时触发。

当检测到风险模式时，Claude 的编辑操作会被暂停，你会看到一条安全警告。比如 Claude 试图往代码里写 `exec()` 调用时：

```
⚠️ Security Warning: Using child_process.exec() can lead to command injection vulnerabilities.

This codebase provides a safer alternative: src/utils/execFileNoThrow.ts

Instead of:
  exec(`command ${userInput}`)

Use:
  import { execFileNoThrow } from '../utils/execFileNoThrow.js'
  await execFileNoThrow('command', [userInput])
```

Claude 看到这个警告后会调整它的实现方案，用更安全的方式重写代码。

## 使用场景

**日常开发中的安全兜底**。你让 Claude 帮你写一个执行 shell 命令的功能，它可能会直接用 `exec()` 拼字符串。hook 会在它真正写入前拦截，提醒它用 `execFile` 替代。你不需要记住这些安全规则，hook 替你记着。

**GitHub Actions 工作流编写**。GitHub Actions 的命令注入是一个出了名容易踩的坑——直接在 `run:` 里用 `${{ github.event.issue.title }}` 就可能被注入。hook 会在你编辑 workflow 文件时详细列出所有危险变量和安全写法。

**前端代码安全**。`dangerouslySetInnerHTML`、`innerHTML`、`document.write` 这些 XSS 高危操作，hook 都会拦截并建议用安全替代方案。对于需要用 HTML 的场景，它建议用 DOMPurify 做清洗。

**Python 项目中的 pickle 使用**。`pickle` 反序列化不受信任的数据可以执行任意代码，这是 Python 安全的老问题。hook 检测到 pickle 使用就会提醒考虑 JSON 等安全替代。

## 局限与注意事项

**检测是纯子字符串匹配**。`eval(` 会匹配到所有包含这个子串的内容，包括 `someFunction_eval(` 或注释里提到 `eval(`。误报不可避免。同样，`pickle` 作为子串会匹配到变量名包含 pickle 的情况。

**规则覆盖面窄**。8 条内容匹配规则加 1 条路径匹配规则（GitHub Actions 工作流），总共 9 条，只覆盖了一小部分常见安全问题。SQL 注入、路径遍历、SSRF、不安全的加密用法、硬编码密钥——这些都不在检测范围内。

**`child_process_exec` 规则里硬编码了 Claude Code 项目自身的路径**。提醒信息里推荐用 `src/utils/execFileNoThrow.ts`，这是 Claude Code 项目自己的安全包装工具，你的项目里不会有这个文件。用在其他项目时，这条建议会误导 Claude 去找一个不存在的模块。建议 fork 后把推荐路径改成你项目的对应实现，或者直接删掉这行让 Claude 用 Node.js 标准的 `execFile` 替代。

**第一次触发是阻断的，后续是放行的**。同一规则同一文件只阻断一次。如果 Claude 第一次被拦截后换了写法但还是不安全，第二次就不会被拦了。去重逻辑按 `文件路径-规则名` 维度，不按具体内容。

**不检查已有代码**。hook 只在 Claude 编辑文件时触发，不会扫描项目中已有的安全问题。它是一个写入时守门员，不是静态分析工具。

**debug 日志写在 `/tmp/security-warnings-log.txt`**。如果 hook 行为异常，可以看这个文件排查。但正常使用时这个日志基本是空的——只在 JSON 解析失败或状态文件写入失败时才记。
