# 插件化规则体系

## 当 references/ 也开始膨胀

第 9 章解决了 SKILL.md 膨胀的问题——把知识外置到 `references/`。但实际跑了一阵你会发现新问题。

`references/react.md` 本身膨胀到了 500 行。里面既有 hooks 的最佳实践，也有组件性能优化，还有 React 19 的新 API 用法。更大的问题是，审查维度在不断增长：

- 安全审查（XSS、注入、认证）
- 无障碍审查（ARIA 属性、键盘导航）
- 多端适配（移动端、桌面端、小程序）
- 国际化（硬编码文案、RTL 布局）
- 主题适配（暗色模式、CSS 变量）

你不可能把这些全放在一个文件里。放了也没用——审查一个纯逻辑的工具函数时，AI 不需要看 CSS 布局规则。

是时候引入插件化了。

## rules/ 和 references/ 的区别

先厘清概念。这两个目录干的事不一样：

- **references/** 是"参考知识"。AI 读了之后用来理解上下文，辅助判断。比如团队的架构决策、已知的坑。
- **rules/** 是"执行规则"。AI 必须逐条检查，每条规则都是一个审查项。比如"可点击元素最小 44x44pt"。

类比一下：references 是教科书，rules 是 checklist。教科书帮你理解原理，checklist 确保你不漏检。

分开放不只是为了目录好看，而是 AI 处理方式不同。对 references，AI 读了理解了就行；对 rules，AI 要像过 checklist 一样逐条比对代码。

## 插件化设计模式

目录结构：

```
code-review/
├── SKILL.md                    ← 流程编排 + 规则路由
├── rules/
│   ├── base.md                 ← 每次都加载的基础规则
│   ├── security.md             ← OWASP Top 10
│   ├── react.md                ← React 组件审查
│   ├── css-layout.md           ← CSS/响应式/布局
│   ├── multi-platform.md       ← 多端适配
│   ├── theme-compat.md         ← 主题/暗色模式
│   ├── accessibility.md        ← a11y
│   └── i18n.md                 ← 国际化
└── references/                 ← 参考知识（不变）
    ├── react.md
    └── team-knowledge/
        └── known-pitfalls.md
```

`rules/` 和 `references/` 平级。每个规则文件是一个独立的插件，按需加载。

## 规则路由逻辑

在 SKILL.md 中写清楚路由。这是整个插件化体系的核心——AI 根据代码内容自动决定加载哪些规则文件：

```markdown
## 规则加载

始终加载 [rules/base.md](rules/base.md)。
始终加载 [rules/security.md](rules/security.md)。

根据代码内容，额外加载相关规则：
- 包含 `.tsx`/`.jsx` 或 React 导入 → [rules/react.md](rules/react.md)
- 包含 CSS/SCSS/样式文件 → [rules/css-layout.md](rules/css-layout.md)
- 包含 `platform`/`os` 判断或 React Native → [rules/multi-platform.md](rules/multi-platform.md)
- 包含主题/颜色变量/CSS 变量 → [rules/theme-compat.md](rules/theme-compat.md)
- 包含 `aria-`/`role=`/`tabIndex` → [rules/accessibility.md](rules/accessibility.md)
- 包含文案字符串/i18n 函数 → [rules/i18n.md](rules/i18n.md)
```

注意两个设计选择：

1. `base.md` 和 `security.md` 是**始终加载**的。基础规则和安全规则不分场景，每次都检查。
2. 其他规则根据代码特征按需加载。审查一个纯 TypeScript 工具函数，只加载 base + security，干净高效。

## 编写规则文件的原则

三个硬性要求：

1. **每个文件控制在 100-200 行。** 超过了就拆。
2. **每条规则三要素：检查什么 + 为什么 + 正反示例。** 光说"不要用 userAgent"没用，要说为什么不要用，正确做法是什么。
3. **规则要可操作。** "写好代码"不是规则，"可点击元素最小 44x44pt"才是。

来看 `rules/multi-platform.md` 的实际内容：

```markdown
# 多端适配审查规则

## 1. 平台判断不要硬编码

检查是否使用了 `navigator.userAgent` 做平台判断。
因为 userAgent 字符串不可靠且跨平台行为不一致，各浏览器厂商已逐步冻结该字段。

- ❌ `if (navigator.userAgent.includes('iPhone'))`
- ✅ `if (Platform.OS === 'ios')` 或使用 CSS 媒体查询 `@media (pointer: coarse)`

## 2. 触摸目标尺寸

可点击元素的最小尺寸应为 44x44pt（Apple HIG）或 48x48dp（Material Design）。
因为移动端用户用手指操作，过小的目标会导致误触。

- ❌ `<button style={{ width: 24, height: 24 }}>X</button>`
- ✅ `<button style={{ width: 44, height: 44, padding: 10 }}>X</button>`

## 3. 视口单位使用

不要用 `100vh` 做全屏高度。
因为移动端浏览器地址栏会改变视口高度，`100vh` 在 iOS Safari 上会导致底部被遮挡。

- ❌ `height: 100vh`
- ✅ `height: 100dvh` 或 `height: -webkit-fill-available`

## 4. 横屏适配

包含固定布局的页面需要检查横屏表现。
因为平板和折叠屏用户经常在横屏模式下使用应用。

- ❌ 在容器上写死 `width: 375px`
- ✅ 使用 `max-width: 600px` + `margin: 0 auto` 或 CSS Container Queries

## 5. 安全区域

页面底部固定定位的元素需要处理安全区域。
因为 iPhone 的 Home Indicator 和 Android 的导航手势区域会遮挡内容。

- ❌ `position: fixed; bottom: 0;`
- ✅ `position: fixed; bottom: 0; padding-bottom: env(safe-area-inset-bottom);`
```

5 条规则，80 行。每条都具体到能直接检查代码。

再看 `rules/base.md`：

```markdown
# 基础审查规则

## 1. 命名清晰度

变量名和函数名必须自解释。
因为代码被阅读的次数远多于编写的次数，含糊的命名增加每次阅读的认知成本。

- ❌ `const d = new Date()` / `function proc(items)`
- ✅ `const createdAt = new Date()` / `function filterExpiredItems(items)`

## 2. 空 catch 块

catch 块不能为空，至少要记录日志。
因为静默吞掉异常会让 bug 变成幽灵——出了问题你连日志都没有。

- ❌ `catch(e) {}`
- ✅ `catch(e) { logger.error('Payment failed', e) }`

## 3. 魔法数字

业务逻辑中不要出现未命名的数字字面量。
因为三个月后没人记得 `86400` 是什么意思。

- ❌ `if (retryCount > 3)` / `setTimeout(fn, 86400000)`
- ✅ `const MAX_RETRIES = 3` / `const ONE_DAY_MS = 24 * 60 * 60 * 1000`

## 4. 函数长度

单个函数超过 50 行要标记 warning。
因为长函数通常意味着承担了多个职责，应该拆分。

## 5. TODO 和 FIXME

带 TODO/FIXME 注释的代码不应该进入 PR。
因为如果值得写 TODO，就值得开一个 issue 追踪。PR 里的 TODO 大概率会被忘记。

- ❌ `// TODO: handle error later`
- ✅ 开 issue，在代码中引用 issue 编号 `// See #1234`
```

## 团队如何新增规则

流程极简：

1. 写一个新的规则文件，比如 `rules/performance.md`
2. 在 SKILL.md 的路由表中加一行：`- 包含性能敏感操作（大列表渲染、频繁 re-render） → [rules/performance.md](rules/performance.md)`
3. 提 PR
4. 跑 eval 验证效果
5. 合并

不需要改 SKILL.md 的核心逻辑，不需要动其他规则文件。**新增一个审查维度的成本 = 写一个 Markdown 文件 + 加一行路由。** 这是插件化的核心价值。

删除也一样。某个规则过时了？删文件、删路由那一行。不影响任何其他东西。

## 实战：code-review v5 — 插件化规则

完整的 v5 版本 SKILL.md：

```yaml
---
name: code-review
description: "审查代码质量、安全性和可维护性。当用户说 review、审查、检查代码、看看这段代码、帮我 check 一下时使用。"
allowed-tools: "Read Grep Glob"
---
```

```markdown
你是高级代码审查员。审查当前变更的代码。

## 流程

1. 读取变更文件列表，了解本次变更涉及哪些技术栈
2. 按下方规则加载对应的规则文件
3. 如有 references/ 目录，读取相关参考知识了解上下文
4. 逐文件审查，对每条适用的规则检查代码是否合规
5. 按输出格式汇总结果

## 规则加载

始终加载：
- [rules/base.md](rules/base.md) — 基础代码质量
- [rules/security.md](rules/security.md) — 安全审查

根据代码内容额外加载：
- 包含 `.tsx`/`.jsx` 或 React 导入 → [rules/react.md](rules/react.md)
- 包含 CSS/SCSS/样式文件 → [rules/css-layout.md](rules/css-layout.md)
- 包含平台判断或 React Native → [rules/multi-platform.md](rules/multi-platform.md)
- 包含主题/颜色变量/CSS 变量 → [rules/theme-compat.md](rules/theme-compat.md)
- 包含 `aria-`/`role=`/`tabIndex` → [rules/accessibility.md](rules/accessibility.md)
- 包含文案字符串/i18n 函数调用 → [rules/i18n.md](rules/i18n.md)

## 参考知识

如有 references/ 目录，根据技术栈读取对应参考文件了解团队约定和已知问题。

## 输出格式

按严重程度分组：
- 🔴 Critical — 必须修复才能合并
- 🟡 Warning — 强烈建议修复
- 🟢 Suggestion — 提升代码质量

每条意见格式：
**[严重程度] 文件:行号 — 问题描述**
> 规则来源：rules/xxx.md #规则编号
> 修复建议：具体的修复方案
```

和 v4 比，v5 的变化：

1. 明确了"始终加载"和"按需加载"两级
2. 审查流程写成了步骤，AI 按步骤执行
3. 每条输出标注了规则来源，方便追溯

## 反模式

> **"一个规则文件 2000 行"**
>
> 规则文件本身也要按子主题拆分。如果 `security.md` 膨胀到了 2000 行，拆成 `security-xss.md`、`security-injection.md`、`security-auth.md`。判断标准和第 9 章一样——超过 200 行就该考虑拆了。插件化的意义就在于拆分成本极低：拆文件、改路由，完事。
