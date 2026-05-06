# hookify：用 Markdown 配置 Claude Code 的行为拦截规则

一句话：hookify 让你用 Markdown 文件定义规则，在 Claude Code 执行工具之前/之后拦截特定操作，可以弹警告也可以直接阻止。

## 技术原理

Claude Code 有一套 Hook 机制，允许在工具执行的各个阶段插入自定义脚本。hookify 利用这套机制，注册了四个 Python 脚本分别挂载到四个事件：

| 事件 | 对应脚本 | 触发时机 |
|---|---|---|
| PreToolUse | `pretooluse.py` | 工具执行前 |
| PostToolUse | `posttooluse.py` | 工具执行后 |
| Stop | `stop.py` | Claude 准备结束会话时 |
| UserPromptSubmit | `userpromptsubmit.py` | 用户提交 prompt 时 |

这四个脚本结构几乎一样。每个脚本做三件事：

1. 从 stdin 读取 JSON 格式的 hook 输入（包含 `tool_name`、`tool_input` 等字段）
2. 调用 `core/config_loader.py` 加载 `.claude/hookify.*.local.md` 文件中的规则
3. 调用 `core/rule_engine.py` 评估规则是否匹配

`config_loader.py` 有一个手写的 YAML frontmatter 解析器（没有用 PyYAML，零外部依赖）。它从项目根目录的 `.claude/` 文件夹扫描所有 `hookify.*.local.md` 文件，解析 frontmatter 得到规则定义，解析 markdown body 得到提示消息。

规则的数据结构：

```python
@dataclass
class Rule:
    name: str        # 规则标识
    enabled: bool    # 是否启用
    event: str       # bash / file / stop / prompt / all
    pattern: str     # 简单模式：正则
    conditions: list # 高级模式：多条件列表
    action: str      # warn（警告）或 block（阻止）
    message: str     # 触发时显示的消息
```

`rule_engine.py` 的 `RuleEngine` 类负责评估。它把 hook 输入的各字段（`command`、`file_path`、`new_text` 等）提取出来，跟规则的 conditions 逐个比较。支持 6 种运算符：`regex_match`、`contains`、`equals`、`not_contains`、`starts_with`、`ends_with`。正则用 `lru_cache` 缓存编译结果（最多 128 个）。

所有条件必须同时满足（AND 逻辑）。匹配后根据 `action` 决定行为：

- `warn`：返回 `{"systemMessage": "..."}` 给 Claude 看，但不阻止操作
- `block`：返回 `{"hookSpecificOutput": {"permissionDecision": "deny"}, "systemMessage": "..."}` 阻止操作

关键设计决定：**任何异常都不会阻止操作。** 四个脚本的 finally 块里都写死了 `sys.exit(0)`，import 失败、JSON 解析失败、规则评估出错——全都放行，只在 systemMessage 里打个错误日志。

另外还有一个 `conversation-analyzer` Agent 和一个 `writing-rules` Skill。前者在你不带参数运行 `/hookify` 时启动，扫描对话历史寻找你纠正过 Claude 的地方，自动建议规则。后者是规则写法的参考手册。

## 安装与配置

```bash
cc --plugin-dir /path/to/hookify
```

依赖 Python 3.7+，没有第三方包依赖。

规则文件放在项目根目录的 `.claude/` 下，建议在 `.gitignore` 里加上 `.claude/*.local.md`。

## 使用方法

### 从指令创建规则

```
/hookify 不要用 rm -rf，太危险了
```

Claude 会分析你的需求，问你是要 warn 还是 block，然后生成规则文件。

### 从对话历史自动分析

```
/hookify
```

不带参数时，Claude 会回顾最近的对话，找出你纠正过的行为，建议对应的规则。

### 管理规则

```
/hookify:list        # 查看所有规则
/hookify:configure   # 交互式启用/禁用规则
/hookify:help        # 帮助文档
```

### 手动创建规则

在 `.claude/hookify.block-rm.local.md` 里写：

```markdown
---
name: block-dangerous-rm
enabled: true
event: bash
pattern: rm\s+-rf
action: block
---

危险命令。请确认路径正确再操作。
```

这条规则会阻止所有包含 `rm -rf` 的 Bash 命令。

多条件规则的例子——只在 TypeScript 文件里检查 console.log：

```markdown
---
name: warn-console-log-in-ts
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.tsx?$
  - field: new_text
    operator: regex_match
    pattern: console\.log\(
---

TypeScript 文件里不要留 console.log，用 logger 库。
```

规则改完**不需要重启**，下次工具调用时立刻生效。

## 使用场景

**防止 Claude 删错东西。** 写一条 `event: bash, pattern: rm\s+-rf, action: block` 的规则。Claude 在执行 `rm -rf` 之前会被拦截，操作直接被否决。

**控制代码质量。** 写规则检测 `console.log`、`eval(`、`innerHTML =` 等模式。Claude 写代码时触发 warn，提醒它用正规的替代方案。

**敏感文件保护。** 用 conditions 匹配 `file_path: \.env$` + `new_text: API_KEY`，当 Claude 试图往 .env 文件里写 API key 时弹警告。

**强制测试。** 设一条 `event: stop, action: block` 的规则，检查 transcript 里有没有出现过 `npm test`。如果 Claude 没跑测试就想结束，会被拦回去。

**团队规范自动化。** 你跟 Claude 协作时发现它老是犯同一个错误——直接说 `/hookify`，让它分析对话历史，自动生成规则。下次就不会再犯了。

## 局限与注意事项

**YAML 解析器是手写的。** 不支持完整的 YAML 语法，复杂嵌套结构可能解析出错。在 YAML 里用引号包裹字符串时注意反斜杠转义问题——建议用不带引号的 pattern 值。

**条件只有 AND 逻辑。** 没有 OR 组合。如果你想"匹配 A 或 B"，要么在正则里用 `|`，要么拆成两条规则。

**event 类型粒度有限。** `bash` 和 `file` 的区分靠 `tool_name` 字段硬编码判断（Bash 对应 bash，Edit/Write/MultiEdit 对应 file）。如果以后 Claude Code 加了新工具，hookify 不会自动识别。

**block 在 PostToolUse 阶段效果存疑。** PreToolUse 的 block 会在执行前拦截，但 PostToolUse 是执行后才触发。此时操作已经完成了，block 只能阻止后续操作，已造成的影响无法撤回。

**没有严重程度分级。** 只有 warn 和 block 两档。README 里把 severity levels 列在了"Future Enhancements"里。

**正则不匹配多行。** `re.search` 默认不匹配换行符。如果被检查的字段包含多行内容（比如 `new_text`），`.` 不会匹配换行。需要在正则里显式用 `[\s\S]` 或 `(?s)` 标记。
