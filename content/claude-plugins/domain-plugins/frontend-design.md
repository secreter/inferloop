# frontend-design：反 AI 审美的前端设计 Skill

一个前端 UI/UX 设计 skill，核心诉求是生成有设计感的、不千篇一律的前端界面代码，刻意回避 AI 生成内容常见的"AI 味"审美。

## 技术原理

这个插件使用的是 **skill** 扩展点，定义在 `skills/frontend-design/SKILL.md`。Skill 跟 Agent 和 Command 不同——它是一份领域知识文档，Claude 在识别到相关任务时自动参考。

SKILL.md 的触发条件写在 description 里："when the user asks to build web components, pages, or applications"。不需要 slash command 手动调用，Claude 判断你在做前端开发就会应用这份指导。

指导内容分两大块：

**设计思维流程**。写代码之前先想清楚四个问题：

1. Purpose——这个界面解决什么问题，给谁用
2. Tone——选一个明确的美学方向，而且要走极端：brutal minimal、maximalist chaos、retro-futuristic、organic/natural、luxury/refined、playful/toy-like、editorial/magazine、brutalist/raw、art deco/geometric、soft/pastel、industrial/utilitarian... 列了十几种风格
3. Constraints——技术约束（框架、性能、无障碍）
4. Differentiation——什么东西能让人记住这个界面

**前端审美指南**。这是 SKILL.md 的主体，对五个维度有具体要求：

**Typography**。明确禁止 Arial、Inter 等"通用"字体。要求选"beautiful, unique, and interesting"的字体，display font + body font 的搭配要有个性。

**Color & Theme**。用 CSS variables 保持一致性。鼓励"dominant colors with sharp accents"的大胆配色，反对"timid, evenly-distributed palettes"的平均用力。

**Motion**。优先用纯 CSS 动画。如果有 Motion 库（React 场景）也可以。重点放在页面加载时的 staggered reveal 效果和 scroll-trigger/hover 交互，而不是到处撒细碎微动画。

**Spatial Composition**。鼓励非对称布局、元素重叠、对角线流向、打破网格的布局。要么大面积留白，要么有控制地密集。

**Backgrounds & Visual Details**。不要默认纯色背景。gradient mesh、noise texture、geometric pattern、layered transparency、dramatic shadow、decorative border、custom cursor、grain overlay——这些都是可选的氛围工具。

SKILL.md 明确列出了 **never** 做的事情：用 Inter/Roboto/Arial/系统字体、紫色渐变配白底（这个点名了）、可预测的布局模板、cookie-cutter 无上下文设计。还特别强调了"NEVER converge on common choices (Space Grotesk, for example) across generations"——连 Space Grotesk 这种稍微独特一点的字体都被点名为"用太多了别再用"。

最后有一条风格匹配规则：最大化设计需要繁复的代码（大量动画和特效），极简设计需要克制和精确（间距、字体、细微细节）。不是所有设计都要堆特效。

## 安装与配置

```bash
/plugin install frontend-design@claude-plugins-official
```

零配置。Skill 自动在相关任务中生效。

## 使用方法

直接向 Claude 描述你要做的前端界面：

```
帮我做一个个人博客的首页
```

```
实现一个 dashboard，展示实时数据监控
```

```
做一个产品着陆页，目标是转化率
```

Claude 会先选择一个美学方向，然后按那个方向输出完整的前端代码。生成的是可运行的 HTML/CSS/JS 或 React/Vue 组件代码。

如果你对风格有偏好，直接说：

```
做一个 brutalist 风格的 404 页面
```

```
我要一个很 editorial / 杂志排版感的文章阅读页
```

## 使用场景

**快速原型的视觉差异化**。Hackathon 或者产品 demo，需要一个看起来不像"又一个 AI 生成的页面"的界面。不加这个 skill，Claude 默认生成的前端界面十有八九是白底、Inter 字体、紫蓝渐变。加了之后至少在审美上会有明确的方向性。

**设计探索**。不确定一个项目应该走什么视觉风格。让 Claude 用不同的美学方向各做一版——brutalist 版、retro-futuristic 版、editorial 版——比自己从零在 Figma 里探索快得多。

**个人项目和独立开发者**。没有设计师配合，但不想要 Bootstrap 默认样式那种"功能是有了但看着廉价"的效果。这个 skill 让 Claude 在写代码时同时充当设计师的角色。

**前端面试作品集**。需要几个视觉上有记忆点的项目展示。这个 skill 会推动 Claude 做出有个性的界面，而不是千篇一律的 todo app 样式。

## 局限与注意事项

**"有个性"和"好看"是两回事**。skill 强烈推动 Claude 做出"不一样"的东西——非对称布局、大胆配色、unusual 字体。但不一样不等于好看。asymmetric layout 做不好就是乱，bold accent 用不好就是扎眼。没有设计训练的 Claude 做出来的"大胆"设计，有时候观感比保守设计更差。

**对 Google Fonts 等外部字体的依赖**。要求用独特字体意味着几乎一定要引外部字体服务。如果项目对加载性能敏感，或者在内网环境，这些字体可能加载不出来。

**动画和特效可能影响性能**。gradient mesh、grain overlay、staggered reveal、scroll-trigger... 这些在现代桌面浏览器上没问题，但在低端移动设备上可能导致卡顿。skill 没有提及性能预算。

**无障碍（a11y）只被一句话带过**。Constraints 里提到"accessibility"但没有展开。而 skill 推动的很多设计选择——低对比度文字、unusual 布局、装饰性动画——恰恰是无障碍的雷区。

**生成的代码可能很长**。一个带完整动画、自定义字体、gradient 背景、hover 特效的页面，HTML+CSS+JS 代码量可以非常大。而且因为追求独特性，这些代码的可复用性低——下次做另一个页面又是从头来。

**不做设计系统，做单页**。这个 skill 适合生成一个有视觉冲击力的单页或组件，但不适合做一整套设计系统。它鼓励"每次设计都不同"，这跟设计系统追求一致性的目标是矛盾的。
