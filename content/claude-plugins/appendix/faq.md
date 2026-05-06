# 常见问题与排错

按类别整理 Claude Code 插件开发和使用中的常见问题。每个问题给出症状、原因和解法。

## 安装相关

### 插件安装后不出现在 `/help` 里

**症状**：执行 `/plugin install` 成功了，但 `/help` 看不到插件的命令。

**排查**：

1. 检查 `plugin.json` 是否在 `.claude-plugin/` 目录下，不是在插件根目录：

```
✅ my-plugin/.claude-plugin/plugin.json
❌ my-plugin/plugin.json
```

2. 检查 `plugin.json` 的 JSON 语法。哪怕多一个逗号都会导致加载失败：

```json
{
  "name": "my-plugin",
  "version": "1.0.0"  // ← 末尾不能有逗号
}
```

3. 确认插件名是 kebab-case（小写字母加连字符），不含空格和特殊字符。

4. 重启 Claude Code。部分组件（特别是 hooks）需要重启才能加载。

### `--plugin-dir` 加载无效

**症状**：用 `claude --plugin-dir /path/to/plugin` 启动，但插件没有加载。

**排查**：

- 路径必须指向包含 `.claude-plugin/plugin.json` 的目录
- 路径用绝对路径，不要用 `~` 或相对路径
- 检查目录权限，确保当前用户有读取权限

### 从市场安装失败

**症状**：`/plugin install plugin-name@claude-plugins-official` 报错。

**排查**：

- 确认插件名拼写正确。可以先用 `/plugin > Discover` 浏览确认
- 检查网络连接
- 确认 Claude Code 版本是否支持插件系统（需要较新版本）

## 权限相关

### 工具调用反复弹出权限确认

**症状**：每次执行命令都要确认 Read、Write、Bash 等工具的权限。

**原因**：command 或 skill 没有配置 `allowed-tools`。

**解法**：在 frontmatter 里预批准需要的工具：

```yaml
---
description: My command
allowed-tools: [Read, Write, Grep, Bash]
---
```

对 Bash 工具还可以限制命令范围：

```yaml
allowed-tools: [Read, Bash(git:*), Bash(npm:*)]
```

这样只有 `git` 和 `npm` 开头的命令会被自动批准，其他 Bash 命令仍需确认。

### Hook 脚本没有执行权限

**症状**：hook 不触发，debug 模式下看到 "Permission denied"。

**解法**：

```bash
chmod +x hooks/scripts/validate.sh
```

如果是 Python 脚本，确保文件头有 shebang 行：

```python
#!/usr/bin/env python3
```

并且系统上装了对应版本的 Python。hookify 的所有 hook 脚本都要求 Python 3.7+。

### MCP 服务器认证失败

**症状**：MCP 工具调用返回 401 或认证错误。

**排查**：

1. **OAuth 类型**（SSE）：清除缓存的 token 重新认证
2. **Token 类型**（HTTP）：检查环境变量是否设置：

```bash
echo $API_TOKEN
```

3. 检查 `.mcp.json` 里的 header 配置：

```json
{
  "headers": {
    "Authorization": "Bearer ${API_TOKEN}"
  }
}
```

环境变量名区分大小写。`${API_TOKEN}` 和 `${Api_Token}` 是两个不同的变量。

## 插件冲突

### 两个插件的命令同名

**症状**：安装两个插件后，某个斜杠命令的行为不符合预期。

**原因**：两个插件定义了同名的 command 或 skill。

**排查**：

```
/help
```

查看命令列表，注意命令后面的插件标签（如 `(plugin:plugin-a)` 和 `(plugin:plugin-b)`）。

**解法**：

- 插件开发者：给命令加插件名前缀，如 `plugin-a:review` 而不是 `review`
- 用户：禁用其中一个插件，或联系开发者改名

### Skill 互相抢触发

**症状**：提问时加载了错误的 skill，或者两个 skill 同时加载浪费上下文。

**原因**：两个 skill 的 description 触发条件重叠。

**排查**：用 debug 模式查看哪些 skill 被触发：

```bash
claude --debug
```

**解法**：

- 把 description 的触发短语写得更精确
- 避免使用泛泛的触发词如 "code"、"help"、"fix"
- 用具体的术语：与其写 "when the user asks about database"，不如写 "when the user asks to 'create a migration', 'rollback database schema'"

### Hook 之间产生冲突

**症状**：某个工具调用被意外拦截，或者 hook 输出的消息互相矛盾。

**原因**：多个插件的 hook 匹配了同一个工具，且它们并行执行。

**排查**：

```
/hooks
```

查看当前加载的所有 hook。

**关键认知**：同一 matcher 下的多个 hook 并行执行，互相看不到对方的输出。如果一个 hook 返回 `allow`、另一个返回 `deny`，最终结果取决于 Claude Code 的合并策略——通常 `deny` 优先。

**解法**：

- 收窄 matcher 范围。用 `"Write"` 而不是 `"*"`
- 用正则精确匹配：`"mcp__plugin_myname_.*"` 只匹配自己插件的 MCP 工具

## 性能问题

### Claude Code 启动变慢

**症状**：安装多个插件后，Claude Code 的启动时间明显变长。

**原因**：

- MCP 服务器启动需要时间（特别是 stdio 类型的本地进程）
- SessionStart hook 执行了耗时操作
- 插件数量过多，元数据加载累积

**解法**：

1. 禁用不常用的插件
2. SessionStart hook 加 timeout：

```json
{
  "type": "command",
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/init.sh",
  "timeout": 5
}
```

3. MCP 服务器是惰性连接的（第一次调用工具时才连），不需要特别优化
4. 检查 SessionStart hook 脚本是否有阻塞操作（如网络请求、大文件读取）

### Hook 拖慢每次工具调用

**症状**：每次文件编辑或命令执行都有明显延迟。

**原因**：PreToolUse hook 执行时间长，或者 matcher 范围太宽。

**排查**：debug 模式下查看每个 hook 的执行耗时。

**解法**：

1. 确定性检查用 command hook（毫秒级），复杂判断才用 prompt hook（秒级）
2. 收窄 matcher：

```json
// 只在写文件时检查，不是所有工具调用
"matcher": "Write|Edit"

// 而不是
"matcher": "*"
```

3. 设置合理的 timeout。command hook 默认 60 秒太长了，大多数检查 5-10 秒足够：

```json
{
  "type": "command",
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/check.sh",
  "timeout": 10
}
```

4. hook 脚本里缓存检查结果。如果同一个文件被反复检查，把结果缓存在临时文件中：

```bash
CACHE_FILE="/tmp/hook-cache-$(echo "$file_path" | md5sum | cut -d' ' -f1)"
if [ -f "$CACHE_FILE" ] && [ "$(stat -c %Y "$CACHE_FILE")" -gt "$(( $(date +%s) - 60 ))" ]; then
  cat "$CACHE_FILE"
  exit 0
fi
```

### Skill 的上下文窗口被占满

**症状**：Claude 的回答质量下降，或者提示上下文不够。

**原因**：太多 skill 同时被触发，SKILL.md 正文加起来占了太多上下文。

**解法**：

- 遵循渐进式披露原则：SKILL.md 控制在 1500-2000 词，详细内容放 references/
- 如果你的 SKILL.md 超过 3000 词，拆分到 references/ 目录
- 精确化 description 的触发条件，减少误触发

## LSP 相关问题

这部分针对 typescript-lsp、pyright-lsp 等 LSP 类插件。

### LSP 服务器未启动

**症状**：类型检查和智能补全功能不工作。

**排查**：

1. 检查 MCP 服务器状态：

```
/mcp
```

2. 确认语言服务器的运行时已安装。比如 typescript-lsp 需要 Node.js，pyright-lsp 需要 Python 环境。

3. 检查 `.mcp.json` 里的 command 路径是否正确：

```json
{
  "command": "npx",
  "args": ["-y", "typescript-language-server", "--stdio"]
}
```

4. 手动在终端运行 language server 命令，看是否报错。

### LSP 工具调用返回空结果

**症状**：类型检查没有返回任何诊断信息。

**排查**：

- 检查 `extensionToLanguage` 映射是否包含了你的文件类型
- 确认项目根目录有正确的配置文件（`tsconfig.json`、`pyrightconfig.json` 等）
- 某些 LSP 需要先 index 项目，第一次调用可能返回空

### 类型检查结果过多

**症状**：LSP 返回大量诊断信息淹没了有用的输出。

**解法**：

- 在 LSP 配置中调整诊断级别
- 使用更精确的文件路径范围
- 排除 node_modules 等目录

## 各种报错的排查思路

### "Invalid JSON" 类报错

出现在：hooks.json、.mcp.json、plugin.json

**排查**：

```bash
# 验证 JSON 语法
cat hooks/hooks.json | python3 -m json.tool
```

常见的 JSON 错误：

- 尾部多余的逗号（JSON 不允许，JavaScript 允许）
- 用了单引号（JSON 只接受双引号）
- 注释（JSON 不支持注释，但很多人从 JavaScript 习惯带过来）

### "Hook script not found"

**排查**：

1. 检查 hooks.json 里的路径是否用了 `${CLAUDE_PLUGIN_ROOT}`
2. 确认脚本文件确实存在于指定位置
3. 检查文件扩展名是否匹配

```json
// 路径里别漏了 bash 或 python3
"command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/validate.sh"
"command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/check.py"
```

### "SKILL.md not found" / Skill 不加载

**排查**：

1. 文件名必须是 `SKILL.md`，大小写敏感。`skill.md`、`Skill.md` 都不行
2. SKILL.md 必须在 `skills/<skill-name>/` 子目录下，不能直接放在 skills/ 根目录
3. YAML frontmatter 格式必须正确：

```yaml
---
name: my-skill
description: Trigger description here
---
```

`---` 必须在文件的最开头，前面不能有空行或 BOM 字符。

### "Agent validation failed"

**排查**：

agent 的 frontmatter 有明确的验证规则：

- `name`：3-50 字符，小写字母+数字+连字符，首尾必须是字母或数字
- `description`：10-5000 字符，应包含 `<example>` 块
- `model`：只接受 `inherit`、`sonnet`、`opus`、`haiku`
- `color`：只接受 `blue`、`cyan`、`green`、`yellow`、`magenta`、`red`

```yaml
# 这些名字会报错
name: ag            # 太短（< 3 字符）
name: -start-       # 以连字符开头和结尾
name: my_agent      # 下划线不允许
name: My-Agent      # 大写不允许
```

### MCP 连接超时

**症状**：MCP 工具调用无响应或报超时。

**排查**：

1. stdio 类型：检查本地进程是否正常运行

```bash
# 手动测试 MCP 服务器是否能启动
npx -y @modelcontextprotocol/server-filesystem /tmp
```

2. SSE/HTTP/WS 类型：检查网络连通性

```bash
curl -I https://mcp.example.com/sse
```

3. 如果在公司网络后面，检查是否有代理设置需要配置

### 环境变量未展开

**症状**：`${CLAUDE_PLUGIN_ROOT}` 或其他环境变量没有被替换。

**排查**：

- 确认变量名拼写正确，区分大小写
- `${CLAUDE_PLUGIN_ROOT}` 只在 hooks.json 和 .mcp.json 的特定字段中展开
- 在 hook 脚本里，环境变量通过 shell 正常读取：`$CLAUDE_PLUGIN_ROOT`
- 在 SKILL.md 正文里，`${CLAUDE_PLUGIN_ROOT}` 作为文本引用，不会自动展开——Claude 会根据上下文理解它指的是什么

### Hook 输出格式错误

**症状**：hook 执行了但行为不符合预期——没有拦截该拦截的操作，或者消息没出现在对话中。

**排查**：

hook 脚本的 stdout 必须是合法 JSON。验证方法：

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | \
  bash hooks/scripts/my-hook.sh | \
  python3 -m json.tool
```

常见输出格式错误：

- 脚本输出了 JSON 以外的内容（如调试日志混在 stdout 里）
- JSON 字段名拼写错误（`permissionDecision` 不是 `permission_decision`）
- 嵌套层级不对（`hookSpecificOutput.permissionDecision` 不是顶层的 `permissionDecision`）

正确的 PreToolUse hook 输出：

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny"
  },
  "systemMessage": "Operation blocked: writing to system path"
}
```

不是：

```json
{
  "permissionDecision": "deny",
  "systemMessage": "Operation blocked"
}
```

## 通用排查流程

遇到任何插件问题时的标准排查步骤：

1. **开 debug 模式**：`claude --debug`，观察插件加载、hook 注册、MCP 连接的日志
2. **检查 JSON 语法**：所有 `.json` 文件过一遍 `python3 -m json.tool`
3. **检查文件位置**：`.claude-plugin/plugin.json` 在不在、组件目录是否在插件根目录下
4. **检查命名规范**：kebab-case、SKILL.md 大写、frontmatter 字段名
5. **重启 Claude Code**：hooks 和 MCP 配置的变更需要重启
6. **独立测试组件**：hook 脚本可以用 echo + pipe 独立测试，MCP 服务器可以手动启动测试
7. **查看 `/hooks` 和 `/mcp`**：确认组件是否被正确加载和注册
