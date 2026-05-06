# example-plugin：插件开发的脚手架参考

Claude Code 插件系统的官方示例，展示了插件的三种核心扩展机制——slash command、skill 和 MCP server——的最小可运行结构。

## 技术原理

一个 Claude Code 插件的识别入口是 `.claude-plugin/plugin.json`。Claude Code 启动时扫描到这个文件，就知道这是一个插件目录，然后按约定路径自动发现组件：

- `commands/*.md` —— 注册为 slash command（用户输入 `/命令名` 触发）
- `skills/*/SKILL.md` —— 注册为 skill（Claude 根据上下文自动调用，或用户手动 `/skill名` 触发）
- `.mcp.json` —— 声明 MCP server 配置

example-plugin 里这三种都有，而且故意展示了同一个 command 的两种写法：

**旧格式**：`commands/example-command.md`，文件名即命令名。

**新格式**：`skills/example-command/SKILL.md`，目录名即命令名，SKILL.md 里通过 frontmatter 的 `name` 字段指定。

两种写法被 Claude Code 以完全相同的方式加载，区别仅在文件组织。官方推荐新格式，因为 skill 目录下可以放 `references/`、`scripts/`、`examples/` 等子目录，方便打包更多资源。

### Skill 的两种模式

这个插件同时包含两种 skill，区分方式在 frontmatter：

用户触发型（有 argument-hint 和 allowed-tools），文件是 `skills/example-command/SKILL.md`：

```yaml
---
name: example-command
description: An example user-invoked skill
argument-hint: <required-arg> [optional-arg]
allowed-tools: [Read, Glob, Grep, Bash]
---
```

模型触发型（靠 description 字段做语义匹配），文件是 `skills/example-skill/SKILL.md`：

```yaml
---
name: example-skill
description: This skill should be used when the user asks to "demonstrate skills"...
version: 1.0.0
---
```

用户触发型在 `/help` 里出现，用户打 `/example-command` 才会执行。模型触发型则由 Claude 判断当前对话是否匹配 description 描述的场景，匹配就自动加载。

### MCP Server

`.mcp.json` 的内容极简：

```json
{
  "example-server": {
    "type": "http",
    "url": "https://mcp.example.com/api"
  }
}
```

声明一个 HTTP 类型的 MCP server。实际使用中 URL 换成真实服务地址就行。支持的类型还有 `stdio`（本地进程）、`sse`（Server-Sent Events）等。

## 安装与配置

这个插件本身是教学用途，不需要真的安装。如果你想拿来当模板：

```bash
cp -r plugins/example-plugin/ my-new-plugin/
# 然后改 .claude-plugin/plugin.json 里的 name
# 删掉不需要的组件目录
```

本地测试：

```bash
claude --plugin-dir /path/to/my-new-plugin
```

## 使用方法

```
/example-command my-argument
```

执行后 Claude 会解析参数、用 allowed-tools 里指定的工具执行操作、返回结果。

对 example-skill，不需要手动触发。在对话中提到"skill 模板"、"skill 开发"之类的话题，Claude 会自动把这个 skill 的内容加载到上下文里。

## 使用场景

**新建插件时当起点**。与其从零开始写 plugin.json 和目录结构，不如复制 example-plugin 然后删改。目录结构和 frontmatter 格式都是对的，不用翻文档。

**搞清楚 commands/ 和 skills/ 的关系**。很多人第一次接触插件系统会困惑：commands 和 skills 到底什么区别？这个插件直接用同一个 command 展示两种写法，一目了然。

**理解 skill description 怎么写**。模型触发型 skill 的关键是 description 字段。example-skill 的 description 示范了推荐写法：列出具体的触发短语（"demonstrate skills"、"show skill format"），加上话题关键词。

## 局限与注意事项

- MCP server 配置指向一个不存在的示例 URL，不要期望它能连通
- 两种格式的 command 同名（都叫 example-command），实际项目里不要这样做，会冲突
- 这个插件没有 hooks 和 agents 的示例。要看这两类组件的例子，得去 feature-dev 或 plugin-dev 插件
- Skill 的 `allowed-tools` 字段作用是预授权——这些工具执行时不再弹确认提示。写少了需要频繁点确认，写多了会降低安全性
