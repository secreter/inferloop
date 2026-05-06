# 团队知识库与规则治理

## 规则和知识库不是一回事

很多团队把所有东西都塞进 Skill 的规则文件，分不清"规则"和"知识库"。这两者的区别很关键。

**规则**告诉 AI "怎么做"：

- 所有用户输入必须经过 XSS 转义
- 数据库查询使用参数化查询
- 组件命名使用 PascalCase

**知识库**告诉 AI "我们团队的上下文"：

- 我们用 Zustand 不用 Redux，因为 2024 年初做过一次状态管理方案评估，Zustand 在 bundle size 和 API 简洁性上胜出
- Auth SDK 在 SSR 环境下会抛一个 `window is not defined` 的错误，需要延迟到 `useEffect` 中初始化
- 支付模块的 `retryPayment` 函数有一个已知的竞态条件，在并发请求下会导致重复扣款，目前用了一个分布式锁绕过，等 v3.0 重构时彻底修复

规则是通用的，AI 根据规则可以直接执行检查。知识库是特殊的，AI 需要理解这些上下文才能做出正确判断——不是"所有项目都该这么做"，而是"我们的项目因为这些原因需要这么做"。

## 知识库的三种内容类型

### 1. 命名约定

文件：`references/naming-conventions.md`

```markdown
# 命名约定
<!-- 更新日期：2025-03 -->

## 文件命名
- React 组件：PascalCase，如 `UserProfile.tsx`
- Hook：camelCase + use 前缀，如 `useAuth.ts`
- 工具函数：camelCase，如 `formatCurrency.ts`
- 常量文件：camelCase，如 `apiEndpoints.ts`
- 测试文件：与被测文件同名 + .test，如 `UserProfile.test.tsx`

## 变量命名
- 布尔值用 is/has/should 前缀：`isLoading`、`hasPermission`
- 事件处理函数用 handle 前缀：`handleSubmit`、`handleClick`
- 回调 prop 用 on 前缀：`onSubmit`、`onClick`

## 特殊约定
- API 返回的字段保持 snake_case，在 adapter 层转为 camelCase
  原因：后端是 Python 团队，字段用 snake_case，我们不想每次联调都争论命名风格
```

### 2. 已知陷阱

文件：`references/known-pitfalls.md`

```markdown
# 已知陷阱
<!-- 更新日期：2025-03 -->

## Auth SDK SSR 问题
Auth SDK 的 `initAuth()` 内部访问了 `window.localStorage`。
在 Next.js 的 SSR 阶段调用会报 `ReferenceError: window is not defined`。
解法：将 `initAuth()` 调用放在 `useEffect` 中，并在 SSR 阶段返回 loading 状态。
影响范围：所有使用了认证的页面组件。

## Zustand 持久化 + SSR 水合不一致
使用 zustand/middleware 的 persist 时，SSR 渲染的初始状态和客户端从 localStorage 恢复的状态不一致，会导致 hydration mismatch 警告。
解法：用 `skipHydration: true` 配置，在客户端 `useEffect` 中手动触发水合。
关联 PR：#1247

## dayjs 时区插件内存泄漏
dayjs 的 timezone 插件在 Node.js 环境下有内存泄漏问题（已提 issue：dayjs#2316）。
临时方案：在 API route 中使用原生 `Intl.DateTimeFormat` 替代。
预计修复版本：dayjs 2.0
```

### 3. 架构决策记录

文件：`references/architecture-decisions.md`

```markdown
# 架构决策记录
<!-- 更新日期：2025-02 -->

## ADR-001：状态管理选型 Zustand
日期：2024-01
决策：使用 Zustand 替代 Redux
原因：
- Redux boilerplate 太多，团队反馈开发体验差
- Zustand 的 bundle size 是 Redux Toolkit 的 1/10
- API 更简洁，新人上手快
影响：所有全局状态通过 Zustand store 管理，不使用 React Context 做跨组件状态共享

## ADR-002：API 层使用 Adapter 模式
日期：2024-03
决策：后端返回的 snake_case 数据在 adapter 层统一转为 camelCase
原因：
- 前端用 camelCase，后端用 snake_case，在组件里混用两种风格导致过多次 bug
- 统一在 adapter 转换，组件层只看到 camelCase
影响：所有 API 调用必须经过 `src/adapters/` 目录下的 adapter 函数，不允许在组件中直接调用 fetch

## ADR-003：错误边界策略
日期：2024-06
决策：每个路由页面包一层 ErrorBoundary，公共组件不加
原因：
- 公共组件加 ErrorBoundary 会吞掉错误，让调试变困难
- 页面级兜底足够了，用户看到"页面出错"比白屏好
影响：`src/pages/` 下的每个页面组件外层都要有 ErrorBoundary 包裹
```

## 知识库怎么被 Skill 使用

知识库文件放在 `references/` 目录下，在 SKILL.md 中引用：

```yaml
---
name: code-review
description: "按团队规范审查前端代码"
---

审查代码时，参考以下团队知识：
- 命名约定见 references/naming-conventions.md
- 已知陷阱见 references/known-pitfalls.md
- 架构决策见 references/architecture-decisions.md

根据这些上下文判断代码是否符合团队实践。不要机械套用通用最佳实践——如果团队有特定的做法（比如状态管理用 Zustand），以团队决策为准。
```

AI 在审查代码时，会读取这些文件，理解团队的上下文，然后做出更精准的判断。比如看到有人用了 Redux，它不会说"Redux 很好"，而是会指出"团队使用 Zustand 管理状态（ADR-001），请改用 Zustand"。

## 维护机制

知识库不维护，三个月就过期。以下是三个必须执行的机制。

### 每条知识带日期标签

上面的示例你已经看到了——每个文件头部和每条记录都有日期。没有日期的知识不可信。当你看到一条标注"2023-06"的已知陷阱，你的第一反应应该是"这个还存在吗"。

### 季度清理

每季度花一个小时过一遍知识库：

- dayjs 的内存泄漏修了没有？修了就删
- Auth SDK 的 SSR 问题在新版本还存在吗？查一下 changelog
- ADR-001 的 Zustand 选型，团队有没有新的考虑？

过时的知识比没有知识更危险。AI 会认真对待你写的每一条内容。如果你写了一个已经修复的 bug 仍然存在，AI 会在 review 中反复提醒一个不存在的问题。

### 新人入职 review

新人入职第一周，给他一个任务：读一遍知识库，提一个 PR。

两个好处：

1. 新人快速了解团队的技术决策和已知问题
2. 新人的 PR 本身就是一次清理——新人会问"这条还对吗"，逼着团队去验证

## 实战：为 code-review 添加团队知识文件

完整的目录结构：

```
.claude/skills/code-review/
  SKILL.md
  references/
    naming-conventions.md     # 命名约定
    known-pitfalls.md         # 已知陷阱
    architecture-decisions.md # 架构决策记录
  rules/
    security.md
    error-handling.md
```

规则文件告诉 AI "检查什么"，知识库文件告诉 AI "在我们的项目里，这些东西是什么样的"。

分开放，分开维护。规则相对稳定，知识库随项目演进不断更新。一个月改一次规则算正常，但知识库可能每周都会有新内容加进来——踩了一个新坑、做了一个新的架构决策、发现了一个第三方库的 bug。

把知识库的更新纳入日常开发流程。踩坑了？修完 bug 之后，花 2 分钟在 known-pitfalls.md 加一条记录。做了技术选型？在 architecture-decisions.md 补一条 ADR。这不是额外工作，是让团队的集体经验不再只存在于某个人的脑子里。
