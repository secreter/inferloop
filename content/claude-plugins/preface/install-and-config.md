# 插件的安装配置与管理

## 安装插件

### 从官方插件目录安装

最常用的方式，一行命令：

```bash
/plugin install plugin-name@claude-plugins-official
```

比如装 GitHub 集成插件：

```bash
/plugin install github@claude-plugins-official
```

`@claude-plugins-official` 指定了插件来源是 Anthropic 官方仓库。`/external_plugins` 目录下的第三方插件也在这个仓库里，安装方式一样——但它们由第三方开发者维护，Anthropic 不对其质量和安全性做保证。

### 浏览并安装

如果你不确定要装哪个，可以用发现功能：

```bash
/plugin > Discover
```

这会列出可用的插件供你选择。在交互式列表里浏览比记命令名方便。

### 本地开发模式

开发自己的插件时，不需要把它发布到仓库。直接指定本地目录：

```bash
claude --plugin-dir /path/to/my-plugin
```

或者简写：

```bash
cc --plugin-dir /path/to/my-plugin
```

这种方式下，每次启动 Claude Code 都需要带上 `--plugin-dir` 参数。改了插件代码后重启 Claude Code 即可生效（hooks 除外——hooks 只在会话启动时加载）。

## 查看已安装的插件

```bash
/plugin
```

不带参数直接执行 `/plugin` 命令，会进入插件管理界面，列出所有已安装的插件及其状态。

要查看当前加载的 hooks，可以用：

```bash
/hooks
```

这会显示所有已注册的 hooks，包括来自插件和用户配置的。调试 hook 不生效的问题时这个命令很有用。

## 更新插件

插件更新目前的体验比较粗糙。没有 `/plugin update` 这样的一键更新命令。实际操作取决于你的安装方式：

**从官方目录安装的插件**：重新执行 install 命令会拉取最新版本：

```bash
/plugin install plugin-name@claude-plugins-official
```

**本地开发的插件**：直接改文件就行，重启 Claude Code 生效。

关于版本管理：`plugin.json` 里有 `version` 字段，但目前 Claude Code 的插件系统对语义化版本的支持还很初级。不要指望它能帮你做版本冲突检测或者自动回滚。

## 卸载插件

通过 `/plugin` 命令进入管理界面，选择要卸载的插件执行卸载操作。

本地开发模式的插件不存在卸载的问题——不传 `--plugin-dir` 参数就行了。

## 插件的权限管理

插件的权限体系是个重要话题，因为它直接影响安全性。

### 工具权限

每个 Command 和 Agent 可以通过 `allowed-tools` / `tools` 字段声明需要预授权的工具：

```markdown
---
allowed-tools: [Read, Glob, Grep, Bash]
---
```

列在这里的工具在该命令执行期间不会弹确认框。没列的工具仍然需要用户逐次确认。

这是一种便利性和安全性的权衡。如果你写了一个命令需要大量读文件，不预授权 Read 的话每次都要点确认，体验很差。但预授权 Bash 就意味着命令执行期间可以不经确认地跑任意 shell 命令，要想清楚。

### MCP 服务器的权限

MCP 服务器提供的工具在被调用时也会触发权限确认。这个行为跟内置工具一样。

但有一点不同：MCP 服务器本身的启动不需要额外确认——它在插件启用时就自动启动了。所以安装一个带 MCP 的插件，实际上就是同意它在后台运行一个服务进程。

### Hooks 的权限

Hooks 是权限模型里最敏感的部分。Command 类型的 hook 可以执行任意 shell 命令，而且是自动触发的——每次 Claude 调用匹配的工具时，hook 脚本就会执行。

插件安装时 Claude Code 会提示用户审查插件包含的 hooks。但说实话，大多数用户不会逐行读 hook 脚本。所以 README 里写清楚 hooks 干了什么，对建立信任很重要。

### 信任边界

仓库 README 开头的警告值得重复一遍：

> Anthropic does not control what MCP servers, files, or other software are included in plugins and cannot verify that they will work as intended or that they won't change.

即使是 `/plugins` 目录下 Anthropic 自己的插件，也不代表 Anthropic 做了安全审计。`/external_plugins` 下的第三方插件更是如此。装插件之前看一眼它的源码，尤其是 hooks 脚本和 MCP 配置，是个好习惯。

## 插件的作用域

### 全局 vs 项目级

Claude Code 的插件有两个作用域层级：

**全局安装的插件**对你所有的 Claude Code 会话生效。通过 `/plugin install` 安装的插件默认就是全局的。

**项目级插件**只在特定项目目录下生效。使用 `--plugin-dir` 指向项目内的插件目录时，它只在当前会话中生效。

如果你希望某个插件只对特定项目起作用，可以把插件目录放在项目内部，然后通过项目级的启动配置来加载。

### 作用域冲突

当全局插件和项目级插件定义了同名的 command 或 skill 时，具体的优先级行为可能因版本而异。目前的经验是：同名 command 会产生冲突，Claude Code 会警告你。给命令加前缀（比如 `pluginname:command`）可以避免这个问题——仓库里不少插件已经这么做了，比如 plugin-dev 的 `/plugin-dev:create-plugin`。

### Hooks 的合并

不同来源的 hooks 不会互相覆盖，而是合并后并行执行。你的用户级 hooks、全局插件的 hooks、项目级插件的 hooks 会同时生效。

这意味着如果两个插件都注册了 `PreToolUse` hook 来检查 Write 操作，两个 hook 都会跑。但它们互相看不到对方的输出，执行顺序也不确定。设计 hook 时不能假设有其他 hook 存在，也不能依赖执行顺序。

## 快速排错

插件不工作时，先跑这三步：

1. `claude --debug` 启动，看插件加载日志
2. `/hooks` 确认 hook 是否注册成功
3. 检查所有 JSON 文件的语法（`python3 -m json.tool < hooks/hooks.json`）

最常踩的两个坑：

- **改了 hooks.json 没重启 Claude Code**。Hooks 只在会话启动时加载，运行中改不会生效。
- **路径没用 `${CLAUDE_PLUGIN_ROOT}`**。hooks.json 和 .mcp.json 里写 `./scripts/xxx.sh` 是不行的，工作目录不是插件目录。

更完整的问题分类和排查方法见**附录·常见问题与排错**。

## 开发阶段的工作流建议

如果你打算边读本书边动手改插件做实验，推荐这个工作流：

```bash
# 1. 把官方仓库 clone 到本地
git clone https://github.com/anthropics/claude-plugins-official.git

# 2. 用 --plugin-dir 加载你感兴趣的插件
claude --plugin-dir ./claude-plugins-official/plugins/plugin-dev

# 3. 改了代码后退出重进
# Ctrl+C 退出当前会话，重新执行上面的命令

# 4. 调试模式看详细日志
claude --debug --plugin-dir ./claude-plugins-official/plugins/plugin-dev
```

多个插件可以同时加载：

```bash
claude \
  --plugin-dir ./claude-plugins-official/plugins/plugin-dev \
  --plugin-dir ./claude-plugins-official/plugins/code-review
```

这种本地加载方式不影响你全局安装的插件，两边互不干扰。实验完想清理干净，不传 `--plugin-dir` 就回到了只有全局插件的状态。
