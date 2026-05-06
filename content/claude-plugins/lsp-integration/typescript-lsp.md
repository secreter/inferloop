# TypeScript LSP

**语言服务器**：typescript-language-server（基于 TypeScript 自带的 tsserver）

**支持的扩展名**：`.ts`、`.tsx`、`.js`、`.jsx`、`.mts`、`.cts`、`.mjs`、`.cjs`

## 安装

```bash
npm install -g typescript-language-server typescript
```

注意这里装了两个包：`typescript-language-server` 是 LSP 协议适配层，`typescript` 是底层的 TypeScript 编译器。前者依赖后者来做实际的分析工作。用 yarn 也行：

```bash
yarn global add typescript-language-server typescript
```

如果你项目本地有自己的 TypeScript 版本（大部分项目都有），语言服务器默认会优先用项目本地的版本。这是好事——保证分析结果和你实际编译时一致。

## 特有功能

TypeScript 的语言服务器是 12 个里面功能最全的，这不奇怪——LSP 协议本身就是从 TypeScript 的工具链抽象出来的。

- **自动导入建议**。补全一个没 import 的符号时，能自动加上 import 语句。
- **代码修复（Code Actions）**。类型错误附带修复建议，比如"把 `string` 改成 `number`"或"加一个缺失的属性"。
- **重构操作**。提取函数、提取变量、移动到文件等。
- **JSX/TSX 支持**。对 React 项目，能正确分析 JSX 语法和组件 props 的类型。
- **JavaScript 支持**。即使是纯 JS 项目，只要有 `jsconfig.json` 或 `// @ts-check` 注释，也能提供类型检查。

## 项目配置

语言服务器读的是 `tsconfig.json`。没有这个文件的话，它会用默认配置，但结果可能和你预期不同——比如默认不开 `strict` 模式，有些类型错误就查不出来。

多包仓库（monorepo）的场景下，要确保每个包都有自己的 `tsconfig.json`，并且 `references` 字段配置正确。语言服务器跨项目引用时依赖这些信息。

## 典型场景

TypeScript 项目里用 LSP 最能体现价值的场景是**类型相关的重构**。比如你要把一个函数的返回类型从同步改成异步（返回 `Promise<T>`），所有调用方都需要加 `await`。Claude 通过引用查找找到所有调用方，逐个加 `await`，再跑诊断确认没遗漏——整个流程一轮对话搞定。

另一个高频场景是处理第三方库的类型。你升级了一个 npm 包，类型定义变了，编辑器里满屏红线。让 Claude 跑一次诊断，拿到完整的错误列表，逐个修掉。

## 注意事项

- 全局安装的 `typescript` 版本和项目本地的版本不一致时，偶尔会出现分析结果矛盾的情况。优先保证项目本地版本正确。
- `node_modules` 很大的项目，首次加载可能比较慢。这是 tsserver 在建索引，不是插件的问题。
- 如果项目用了 path aliases（`tsconfig.json` 里的 `paths` 字段），确保配置正确，否则跳转定义会失败。
