# Lua LSP

**语言服务器**：lua-language-server（LuaLS，社区开发的主流 Lua 语言服务器）

**支持的扩展名**：`.lua`

## 安装

```bash
# macOS
brew install lua-language-server

# Ubuntu/Debian（via snap）
sudo snap install lua-language-server --classic

# Arch
sudo pacman -S lua-language-server

# Fedora
sudo dnf install lua-language-server
```

也可以从 [GitHub Releases](https://github.com/LuaLS/lua-language-server/releases) 下载预编译二进制。

## 特有功能

Lua 是动态类型语言，但 lua-language-server 有一套自己的类型注解系统（基于 EmmyLua 注解格式），能提供不错的类型分析：

- **EmmyLua 注解支持**。在注释里用 `---@param name string` 这样的格式声明类型，语言服务器能据此做类型检查。
- **多运行时支持**。可以配置目标 Lua 版本（5.1、5.2、5.3、5.4、LuaJIT），不同版本的标准库 API 不一样。
- **第三方库定义**。通过 `.luarc.json` 配置额外的库定义路径，常见的游戏引擎（比如 Love2D、Defold）和嵌入式环境（OpenResty）都有社区维护的定义文件。

## 项目配置

在项目根目录放一个 `.luarc.json`：

```json
{
  "runtime": {
    "version": "Lua 5.4"
  },
  "workspace": {
    "library": ["/path/to/love2d/definitions"]
  },
  "diagnostics": {
    "globals": ["vim"]
  }
}
```

`diagnostics.globals` 很重要——Lua 经常在特定环境下有全局变量（比如 Neovim 里的 `vim`、Roblox 里的 `game`），不声明的话语言服务器会把它们当未定义变量报错。

## 典型场景

Lua 的使用场景比较集中：游戏开发（Love2D、Roblox、游戏引擎内嵌脚本）、编辑器配置（Neovim）、Web 网关（OpenResty/Nginx Lua）。每个场景的全局环境完全不同。

LSP 在 Lua 项目里最大的价值是弥补动态类型的不足。配合 EmmyLua 注解，Claude 修改代码后能做基本的类型检查。没有注解的纯 Lua 代码，分析能力就很有限了。

Neovim 用户是另一个大群体。Neovim 配置和插件全是 Lua 写的，lua-language-server 配合 Neovim 的类型定义文件，能有效辅助 Claude 理解和修改 Neovim 插件代码。

## 注意事项

- Lua 版本之间的差异不小（5.1 和 5.4 的标准库 API 有不少区别），一定要在配置里指定正确的版本，否则诊断结果会误报。
- LuaJIT 和 Lua 5.1 兼容但有差异（比如 LuaJIT 支持 `goto` 语句），配置里有单独的 LuaJIT 选项。
- 对于高度动态的 Lua 代码（大量使用 metatables、`setfenv`、动态加载），静态分析能做的很有限。这是语言特性决定的，不是工具的问题。
