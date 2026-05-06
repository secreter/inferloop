# 知识的内置与外置

## SKILL.md 从 50 行膨胀到 800 行

这是真实故事。你做了一个 code-review Skill，最初只有 50 行，审查通用的代码质量。挺好用的。

然后你开始往里加东西。

先是 React 的 hooks 规则——依赖数组不能漏、useEffect 里不能直接 async。加了 30 行。然后 Vue 的同事说"你那个 Skill 不认 `<script setup>`"，又加了 40 行 Vue 的规范。后来后端团队也想用，Go 的 API 设计规范进来了，又是 80 行。

三周后，SKILL.md 有 800 行。出现了两个问题：

1. **加载变慢。** 每次触发 Skill，AI 都要读完全部 800 行。审查一个 10 行的小函数也是如此。
2. **交叉污染。** 审查 React 代码时，AI 引用了 Go 的错误处理规范："建议使用 error wrapping 返回上层"。用户一脸问号。

问题不在于规则本身——每条都是对的。问题在于**不是所有知识都需要每次加载**。

## 判断标准

把知识放哪，看四个条件：

| 条件 | 策略 | 例子 |
|------|------|------|
| 每次调用都需要 | 内置（写在 SKILL.md body） | 通用审查原则、输出格式模板 |
| 部分场景需要 | 外置（references/） | React 规则、Go 规则 |
| 超过 300 行 | 外置 + 加目录索引 | 完整的 API 设计规范 |
| 纯参考数据 | 外置 | 错误码表、配置项列表 |

核心逻辑：**SKILL.md body 是首屏，只放每次都要看的东西。** 其他的按需加载。

## 内置知识的写法

内置知识直接写在 SKILL.md body 里，控制在核心原则和流程指令，不放细节。

什么算"核心原则"？就是不管审查什么语言、什么框架，都成立的东西：

```markdown
## 审查原则

1. **命名即文档。** 变量名和函数名必须自解释，不接受 `data`、`temp`、`result` 这类无意义命名。
2. **错误不能静默。** 任何 catch 块不能为空，至少要 log。`catch(e) {}` 直接标记为 critical。
3. **安全红线。** 硬编码密钥、SQL 拼接、未校验的用户输入——发现一个就是 P0。

## 输出格式

按严重程度分组输出：
- 🔴 Critical — 必须修复
- 🟡 Warning — 建议修复
- 🟢 Suggestion — 可以更好
```

就这些。30 行以内搞定。React 的 hooks 规则？那是细节，外置。

## 外置知识的组织

外置知识放在 Skill 目录下的 `references/` 文件夹里：

```
code-review/
├── SKILL.md
└── references/
    ├── react.md
    ├── vue.md
    ├── typescript-strict.md
    └── api-design.md
```

关键是 SKILL.md 里要告诉 AI **什么时候读哪个文件**。不是让它自己猜，是给明确的路由指令：

```markdown
## 参考资料

根据被审查代码的技术栈，读取对应的参考文件：
- React/JSX 文件 → 读取 [references/react.md](references/react.md)
- Vue 文件 → 读取 [references/vue.md](references/vue.md)
- TypeScript 严格模式相关 → 读取 [references/typescript-strict.md](references/typescript-strict.md)
- API 接口代码 → 读取 [references/api-design.md](references/api-design.md)
```

AI 看到 `.tsx` 文件，就去读 `references/react.md`。看到 `.vue` 文件，读 `references/vue.md`。没有交叉污染。

**超过 300 行的文件要加目录索引。** 比如 `api-design.md` 有 500 行，开头加个目录：

```markdown
# API 设计规范 — 目录

- [1. URL 设计](#url-设计)（第 5-60 行）
- [2. 请求体规范](#请求体规范)（第 62-130 行）
- [3. 响应格式](#响应格式)（第 132-200 行）
- [4. 错误处理](#错误处理)（第 202-280 行）
- [5. 版本管理](#版本管理)（第 282-340 行）
- [6. 安全相关](#安全相关)（第 342-500 行）

先看目录，根据被审查代码的内容决定读哪些章节。
```

这样 AI 不需要读完 500 行，看了 URL 相关的代码就只读 URL 设计那一节。

## 团队知识库

`references/` 下再建一个 `team-knowledge/` 子目录，放团队特有的上下文：

```
references/
├── react.md                    ← 通用规则（React 社区公认的最佳实践）
├── vue.md
└── team-knowledge/
    ├── naming-conventions.md   ← 我们团队的命名约定
    ├── known-pitfalls.md       ← 踩过的坑
    └── architecture-decisions.md  ← 架构决策记录
```

通用规则和团队知识的区别：**通用规则是"怎么做"，团队知识是"我们为什么这么做"。**

`naming-conventions.md` 长这样：

```markdown
## 命名约定

- 组件用 PascalCase（`UserProfile.tsx`），因为 React 社区惯例，也方便在 JSX 里区分 HTML 标签和自定义组件。
- 工具函数用 camelCase（`formatDate.ts`），因为这些函数不是组件，不需要在 JSX 里被识别。
- API 请求函数统一用 `fetch` 前缀（`fetchUserList`），不用 `get`，因为我们的 `getXxx` 保留给同步的 getter 用。
```

`known-pitfalls.md` 长这样：

```markdown
## 已知的坑

### Auth SDK 在 SSR 环境返回 null
我们的 `@internal/auth` SDK 在服务端渲染时 `getCurrentUser()` 会返回 null，不是 undefined。
很多新人写 `if (!user)` 以为自己处理了，但其实还需要区分"未登录"和"SSR 环境还没拿到"。
正确做法：检查 `typeof window !== 'undefined'` 再调用 Auth SDK。

### DatePicker 组件和 dayjs 版本冲突
v2.3.0 之前的 DatePicker 内置了 dayjs 1.x，如果项目用了 dayjs 2.x 会出现日期格式化异常。
2024-06 已升级到 v2.3.0，但如果看到旧版 import 要提醒升级。
```

这些信息只有你的团队才知道。写进团队知识库，每个新人用 code-review Skill 的时候都能自动获得这些经验。

## 实战：code-review v4 — 内置 + 外置知识分层

完整的 v4 版本 SKILL.md：

```yaml
---
name: code-review
description: "审查代码质量、安全性和可维护性。当用户说 review、审查、检查代码、看看这段代码、帮我 check 一下时使用。"
allowed-tools: "Read Grep Glob"
---
```

```markdown
你是高级代码审查员。审查当前变更的代码。

## 审查原则

1. **命名即文档。** 变量名和函数名必须自解释。`data`、`temp`、`result` 标记为 warning。
2. **错误不能静默。** 空 catch 块是 critical。
3. **安全红线。** 硬编码密钥、SQL 拼接、未校验用户输入，发现即 critical。

## 参考资料

根据代码技术栈，读取对应参考文件：
- React/JSX → 读取 [references/react.md](references/react.md)
- Vue → 读取 [references/vue.md](references/vue.md)
- TypeScript 严格模式 → 读取 [references/typescript-strict.md](references/typescript-strict.md)
- API 接口 → 读取 [references/api-design.md](references/api-design.md)

## 团队上下文

如果项目中存在 `references/team-knowledge/` 目录，读取相关文件了解团队约定和已知问题。

## 输出格式

按严重程度分组：
- 🔴 Critical — 必须修复才能合并
- 🟡 Warning — 强烈建议修复
- 🟢 Suggestion — 提升代码质量的建议

每条意见包含：文件路径 + 行号 + 问题描述 + 修复建议。
```

和之前 800 行的版本比，body 只有不到 40 行。React 规则、Vue 规则、团队知识，全部按需加载。审查 React 代码就只读 React 相关的参考，干净利落。

## 反模式

> **"把整个 React 官方文档塞进 SKILL.md"**
>
> 见过有人把 React 文档的 hooks 章节、并发模式章节、服务端组件章节全部复制进 SKILL.md。上下文窗口是有限的，核心指令会被海量参考信息稀释。AI 读了 2000 行的 React 知识后，反而记不住你在第 3 行写的"空 catch 块是 critical"。核心指令要精简、要突出，参考知识按需加载。
