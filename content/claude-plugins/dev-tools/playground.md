# playground：生成独立的交互式 HTML 探索工具

一句话：playground 插件指导 Claude 生成单文件的交互式 HTML 页面——左边控件、右边实时预览、底部生成一段可复制的 prompt，用于把视觉化的选择结果喂回 Claude。

## 技术原理

这是一个纯 Skill 插件，包含一个 `playground` Skill 和六个模板文件。没有可执行代码。

Skill 的核心指令定义了"什么是 playground"：一个自包含的 HTML 文件，内联所有 CSS 和 JS，不依赖任何 CDN。文件内部维护一个全局 state 对象，所有控件写入 state，所有渲染读取 state，每次控件变化立刻触发 `updateAll()` 更新预览和 prompt 输出。

六个模板覆盖六种场景：

| 模板 | 用途 | 典型控件 |
|---|---|---|
| `design-playground` | 视觉设计决策（组件、布局、间距、色彩） | slider、toggle、dropdown、色彩 HSL 滑块 |
| `data-explorer` | 数据查询构建（SQL、API、pipeline、正则） | 可点击卡片、筛选行、dropdown、slider |
| `concept-map` | 概念图谱、知识探索 | Canvas 拖拽节点、连线、知识等级切换 |
| `document-critique` | 文档评审（approve/reject/comment 工作流） | 行号高亮、建议卡片、筛选标签页 |
| `diff-review` | 代码 diff 审查、行级评论 | 点击 diff 行添加评论、评论指示器 |
| `code-map` | 代码架构可视化（SVG 节点 + 连线） | SVG Canvas、图层筛选、连线类型过滤、点击评论 |

每个模板文件不是可复制粘贴的完整 HTML，而是一份建造指南——包含布局 ASCII 图、控件类型表、渲染逻辑的 JS 片段、prompt 输出格式、样式参考。Claude 读完后，根据你的具体需求，把这些零件组装成一个完整的 HTML 文件。

Skill 指令里有几个硬性要求：
- 单文件，所有东西内联
- 实时预览，不能有"应用"按钮
- prompt 输出用自然语言而不是参数值列表，只提及非默认的选项
- 必须有 Copy 按钮和"Copied!"反馈
- 3-5 个预设（preset），首次加载就好看
- 深色主题，系统字体

生成完 HTML 后，Claude 会用 `open <filename>.html` 在浏览器里打开。

## 安装与配置

```bash
cc --plugin-dir /path/to/playground
```

无依赖，无配置项。

## 使用方法

对 Claude 说你想要一个什么样的 playground：

```
帮我做一个按钮样式探索器，可以调整圆角、内边距、阴影、hover 效果
```

Claude 会加载 `design-playground` 模板，生成一个 HTML 文件，然后在浏览器里打开。

你在页面上调整各种控件，底部会实时生成一段自然语言 prompt，比如：

> "Update the button to use 12px border-radius, 24px horizontal padding, a medium box-shadow (0 4px 12px rgba(0,0,0,0.1)). On hover, lift with translateY(-1px) and deepen the shadow slightly."

点 Copy，把这段话粘贴回 Claude 的对话框，Claude 就知道你的设计决定了。

其他用法示例：

```
做一个 SQL 查询构建器的 playground，表有 users、orders、products
```

```
帮我做一个代码架构图 playground，基于当前项目的结构
```

```
给这个 SKILL.md 文件做一个评审 playground，列出改进建议让我逐条审
```

## 使用场景

**探索 CSS 设计。** 你在实现一个卡片组件，但不确定圆角要多大、阴影要多深。生成一个设计 playground，拖几个滑块就能看到效果，选定后直接复制 prompt 让 Claude 去改代码。比在代码里来回调数值快得多。

**构建复杂查询。** SQL 查询条件多、join 关系复杂。生成一个 data-explorer playground，用可视化方式拼出查询结构，比在对话里来回描述要精确。

**代码审查。** 拿到一个 PR 的 diff，生成一个 diff-review playground，逐行添加评论，最后一键复制出结构化的 review 意见。

**项目架构理解。** 新加入一个项目，让 Claude 生成一个 code-map playground 展示架构图，点击组件写备注（"这里需要加连接池"），最后复制出带上下文的改进清单。

**文档评审。** 写了一份设计文档，让 Claude 分析后生成一个 document-critique playground，它列出改进建议，你逐条 approve/reject，最后只把 approved 的导出为 prompt。

## 局限与注意事项

**产出质量波动大。** 模板只是建造指南，最终 HTML 是 Claude 现写的。复杂的 playground（比如 code-map 的 SVG 布局）可能需要几轮修改才能用。

**单文件的限制。** 所有东西内联意味着文件可能很大。code-map 或 concept-map 模板涉及 Canvas/SVG 绑定逻辑和布局算法，生成的文件可能有好几百行，调试不方便。

**不能用外部依赖。** 这是个硬性约束。如果你想要的功能需要 D3.js 或 React，playground 做不到。只能用原生 DOM 和 Canvas API。

**prompt 输出的质量取决于设计。** Skill 指令强调 prompt 要写成自然语言而不是值列表，但 Claude 不是每次都能做到。有时候生成的 prompt 就是一堆 "border-radius: 12px, padding: 24px"。

**没有状态持久化。** 页面刷新后所有设置回到默认。如果你调了半天忘了点 Copy，就白费了。模板里没有 localStorage 的要求。

**只在浏览器里用。** 生成完后 Claude 用 `open` 命令打开。如果你在远程 SSH 上用 Claude Code，浏览器打不开，需要自己把文件传回本地。
