# 第 13 章：Ink + React — 组件化终端界面

## 从 stdout.write 到声明式 UI

前面的章节中，所有终端输出都是命令式的：拼接字符串，调用 `console.log`，手动控制光标位置。这种方式在输出简单信息时完全够用，但当界面复杂度上升——比如一个带文件树、diff 预览和状态栏的全屏 Code Review 界面——代码会迅速失控。

问题出在哪里？命令式 UI 的核心困难是**状态同步**。当用户按下方向键切换文件时，你需要：清除旧的高亮行、重绘文件树、更新 diff 预览区、刷新状态栏。每个状态变化都要手动计算哪些区域需要重绘，漏掉任何一个就会出现残影或闪烁。

前端工程师对这个问题不会陌生——这正是 jQuery 时代的痛点，也是 React 诞生的原因。React 的核心思想是：**UI = f(state)**，你只需要描述"在某个状态下界面应该长什么样"，框架负责计算差异并高效更新。

这个思想完全可以搬到终端。终端的"屏幕"本质上是一个字符矩阵，和浏览器的 DOM 树一样可以用虚拟表示层来抽象。Ink 就是做这件事的库——它让你用 React 组件来构建终端界面。

```tsx
// 命令式写法：手动管理每一行输出
process.stdout.write('\x1b[2J')  // 清屏
process.stdout.write('\x1b[1;1H') // 移动光标到左上角
process.stdout.write('\x1b[1m扫描结果\x1b[0m\n')
process.stdout.write(`文件数: ${count}\n`)
if (loading) {
  process.stdout.write('⠋ 分析中...\n')
}

// 声明式写法：描述界面应该是什么样
function ScanResult({ count, loading }) {
  return (
    <Box flexDirection="column">
      <Text bold>扫描结果</Text>
      <Text>文件数: {count}</Text>
      {loading && <Text><Spinner /> 分析中...</Text>}
    </Box>
  )
}
```

声明式写法的优势不只是代码更短。当 `count` 或 `loading` 变化时，Ink 会自动计算差异并只更新变化的部分，不需要手动清屏重绘。组件可以复用、可以组合、可以独立测试——这些都是前端工程师已经熟悉的模式。

## Ink 的核心原理

Ink 的架构可以拆成三层：

```
React 组件 → React Reconciler → Yoga 布局引擎 → ANSI 输出
```

**React Reconciler** 是 React 的核心调度器，负责管理组件树的创建、更新和销毁。React DOM 用它来操作浏览器 DOM，React Native 用它来操作原生视图，Ink 用它来操作终端字符。Reconciler 是 React 能跨平台的关键——它把"何时更新"和"更新什么"分离了。

Ink 实现了一个自定义的 React reconciler（通过 `react-reconciler` 包）。当你写 `<Box><Text>hello</Text></Box>` 时，reconciler 不会创建 DOM 节点，而是创建 Ink 内部的节点对象。这些节点对象记录了布局属性（宽度、高度、内边距等）和文本内容。

**Yoga** 是 Facebook 开源的跨平台布局引擎，实现了 CSS Flexbox 规范的子集。React Native 用它在移动端做布局，Ink 用它在终端里做布局。Yoga 接收节点树和布局属性，计算出每个节点的绝对位置和尺寸。

终端的布局约束和浏览器不同：

- 没有像素概念，最小单位是字符（一个字符占一格）
- 宽度是终端列数（通常 80-200），高度是行数（通常 24-50）
- 中文字符占两列，英文字符占一列
- 没有浮动、定位等复杂布局，Flexbox 足够覆盖所有场景

布局计算完成后，Ink 把每个节点的文本内容按计算出的位置写入一个字符缓冲区，再把缓冲区转换成 ANSI 转义序列输出到终端。每次状态更新，Ink 会重新计算布局、对比新旧缓冲区、只输出差异部分——这就是终端版的"虚拟 DOM diff"。

整个过程对使用者完全透明。你写的是 React 组件，Ink 在底层完成了从组件树到终端字符的全部转换。

## Ink 基础组件

Ink 提供了少量基础组件，数量远少于 HTML 标签，但足以构建复杂界面。

### Box — 布局容器

`Box` 是 Ink 中唯一的布局组件，对应 HTML 的 `<div>`。所有布局相关的属性都在 `Box` 上设置。

```tsx
import { Box, Text } from 'ink'

// 垂直排列（默认）
<Box flexDirection="column">
  <Text>第一行</Text>
  <Text>第二行</Text>
</Box>

// 水平排列
<Box flexDirection="row">
  <Text>左边</Text>
  <Text>右边</Text>
</Box>

// 带边框和内边距
<Box borderStyle="round" borderColor="cyan" padding={1}>
  <Text>带边框的内容</Text>
</Box>

// 指定宽高
<Box width={40} height={10}>
  <Text>固定大小的容器</Text>
</Box>

// 百分比宽度
<Box width="50%">
  <Text>占父容器一半宽度</Text>
</Box>
```

Box 的边框样式有多种选择：`single`（单线）、`double`（双线）、`round`（圆角）、`bold`（粗线）、`singleDouble`、`doubleSingle`、`classic`（`+--+` 风格）。选择哪种取决于视觉风格，`round` 在现代终端中效果不错，`single` 更通用。

### Text — 文本渲染

`Text` 是唯一能包含文字内容的组件。不能把裸文本直接放在 `Box` 里——这和 React Native 的约束一样。

```tsx
import { Text } from 'ink'

// 颜色
<Text color="green">成功</Text>
<Text color="red">失败</Text>
<Text color="#ff8800">自定义颜色</Text>
<Text color="rgb(255, 136, 0)">RGB 颜色</Text>

// 样式
<Text bold>粗体</Text>
<Text italic>斜体</Text>
<Text underline>下划线</Text>
<Text strikethrough>删除线</Text>
<Text dimColor>暗色（次要信息）</Text>

// 背景色
<Text backgroundColor="red" color="white"> ERROR </Text>

// 组合
<Text bold color="cyan">repox v0.1.0</Text>

// 换行控制
<Text wrap="truncate">很长的文本会被截断而不是换行...</Text>
<Text wrap="truncate-end">截断末尾</Text>
<Text wrap="truncate-middle">截断中间</Text>
```

### Newline 和 Spacer

`Newline` 插入空行，`Spacer` 在 Flexbox 方向上占满剩余空间。

```tsx
import { Box, Text, Newline, Spacer } from 'ink'

// Spacer 把内容推到两端
<Box>
  <Text>左对齐内容</Text>
  <Spacer />
  <Text>右对齐内容</Text>
</Box>

// 输出效果（假设终端宽 40 列）：
// 左对齐内容                  右对齐内容

// Newline 插入空行
<Box flexDirection="column">
  <Text>第一段</Text>
  <Newline />
  <Text>第二段（隔了一行）</Text>
</Box>
```

`Spacer` 在状态栏中特别有用——左边放文件名，右边放行号，中间用 `Spacer` 填充，自动适配任意终端宽度。

## Flexbox 在终端的实践

如果你写过 CSS Flexbox，Ink 的布局属性几乎不需要学习成本。区别在于终端的约束更简单：没有 `position: absolute`、没有 `float`、没有 `z-index`——只有 Flexbox，反而减少了心智负担。

### flexDirection

终端界面最常见的布局是"上下分区"和"左右分区"。

```tsx
// 上下分区：标题 + 内容 + 状态栏
<Box flexDirection="column" height={process.stdout.rows}>
  {/* 标题栏 */}
  <Box borderStyle="single" paddingX={1}>
    <Text bold>repox review</Text>
  </Box>

  {/* 内容区，flexGrow 占满剩余空间 */}
  <Box flexGrow={1}>
    <Text>内容区域</Text>
  </Box>

  {/* 底部状态栏 */}
  <Box borderStyle="single" paddingX={1}>
    <Text dimColor>按 q 退出 | ↑↓ 导航 | Enter 选择</Text>
  </Box>
</Box>
```

```tsx
// 左右分区：侧边栏 + 主内容
<Box flexDirection="row">
  {/* 固定宽度侧边栏 */}
  <Box width={30} borderStyle="single" flexDirection="column">
    <Text>侧边栏</Text>
  </Box>

  {/* 自适应宽度主内容 */}
  <Box flexGrow={1} borderStyle="single" flexDirection="column">
    <Text>主内容区</Text>
  </Box>
</Box>
```

### justifyContent 和 alignItems

```tsx
// 居中对齐
<Box justifyContent="center" alignItems="center" height={5}>
  <Text>水平垂直居中</Text>
</Box>

// 两端对齐
<Box justifyContent="space-between" width={60}>
  <Text>文件名.ts</Text>
  <Text dimColor>42 行</Text>
</Box>

// 末尾对齐（右对齐）
<Box justifyContent="flex-end" width={40}>
  <Text color="green">✓ PASS</Text>
</Box>
```

### padding 和 margin

padding 和 margin 的值单位是字符数，不是像素。`padding={1}` 表示上下左右各空一个字符/一行。也可以分别设置：

```tsx
<Box
  paddingX={2}      // 左右各 2 个字符
  paddingY={1}      // 上下各 1 行
  marginLeft={4}    // 左边空 4 个字符（缩进效果）
  borderStyle="round"
>
  <Text>有内边距和左边距的盒子</Text>
</Box>
```

### borderStyle

边框是终端 UI 中最有效的视觉分隔手段。不同边框样式的效果：

```
single:           round:            double:           bold:
┌─────────┐       ╭─────────╮       ╔═════════╗       ┏━━━━━━━━━┓
│  内容   │       │  内容   │       ║  内容   ║       ┃  内容   ┃
└─────────┘       ╰─────────╯       ╚═════════╝       ┗━━━━━━━━━┛
```

一个实用技巧：给边框设置颜色可以传达状态信息——`borderColor="green"` 表示成功，`borderColor="red"` 表示错误，`borderColor="yellow"` 表示警告。

## 交互组件

Ink 生态提供了几个常用的交互组件，以 npm 包的形式安装。

### ink-text-input — 文本输入

```tsx
import React, { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

function SearchBox() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState(false)

  return (
    <Box>
      <Text bold>搜索: </Text>
      {submitted ? (
        <Text color="cyan">{query}</Text>
      ) : (
        <TextInput
          value={query}
          onChange={setQuery}
          onSubmit={() => setSubmitted(true)}
          placeholder="输入关键词..."
        />
      )}
    </Box>
  )
}
```

`TextInput` 的 API 和 React 的受控组件模式一致：`value` + `onChange`。`onSubmit` 在用户按 Enter 时触发。`placeholder` 在输入为空时显示灰色提示文本。

### ink-select-input — 选择列表

```tsx
import React from 'react'
import { Box, Text } from 'ink'
import SelectInput from 'ink-select-input'

function FormatSelector() {
  const items = [
    { label: 'JSON', value: 'json' },
    { label: 'Table', value: 'table' },
    { label: 'Markdown', value: 'markdown' },
    { label: 'CSV', value: 'csv' },
  ]

  const handleSelect = (item) => {
    // item.value 是用户选择的值
    console.log(`选择了: ${item.value}`)
  }

  return (
    <Box flexDirection="column">
      <Text bold>选择输出格式:</Text>
      <SelectInput items={items} onSelect={handleSelect} />
    </Box>
  )
}
```

`SelectInput` 自动处理方向键导航和高亮样式。可以通过 `indicatorComponent` 和 `itemComponent` 自定义渲染。

### ink-spinner — 加载动画

```tsx
import React from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'

function LoadingStatus({ task, done }) {
  return (
    <Box>
      {done ? (
        <Text color="green">✓ </Text>
      ) : (
        <Text color="cyan"><Spinner type="dots" /> </Text>
      )}
      <Text>{task}</Text>
    </Box>
  )
}

// 使用
<Box flexDirection="column">
  <LoadingStatus task="扫描文件结构" done={true} />
  <LoadingStatus task="分析代码复杂度" done={true} />
  <LoadingStatus task="生成 AI 审查报告" done={false} />
  <LoadingStatus task="格式化输出" done={false} />
</Box>
```

`Spinner` 的 `type` 属性支持多种动画风格：`dots`（⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏）、`line`（`-\|/`）、`arc`（◜◠◝◞◡◟）等。`dots` 是最常用的，视觉效果优雅且不刺眼。

## 状态管理

Ink 组件就是 React 组件，状态管理的方式完全一致。但终端环境有一些独特之处值得注意。

### useState 和 useReducer

```tsx
import React, { useState, useReducer } from 'react'
import { Box, Text } from 'ink'

// useState：简单状态
function Counter() {
  const [count, setCount] = useState(0)
  // ...
  return <Text>计数: {count}</Text>
}

// useReducer：复杂状态（推荐用于 TUI 应用）
interface ReviewState {
  selectedFile: number
  expandedDiffs: Set<string>
  filterPattern: string
  viewMode: 'split' | 'unified'
}

type ReviewAction =
  | { type: 'SELECT_FILE'; index: number }
  | { type: 'TOGGLE_DIFF'; file: string }
  | { type: 'SET_FILTER'; pattern: string }
  | { type: 'TOGGLE_VIEW_MODE' }

function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'SELECT_FILE':
      return { ...state, selectedFile: action.index }
    case 'TOGGLE_DIFF':
      const next = new Set(state.expandedDiffs)
      next.has(action.file) ? next.delete(action.file) : next.add(action.file)
      return { ...state, expandedDiffs: next }
    case 'SET_FILTER':
      return { ...state, filterPattern: action.pattern, selectedFile: 0 }
    case 'TOGGLE_VIEW_MODE':
      return {
        ...state,
        viewMode: state.viewMode === 'split' ? 'unified' : 'split',
      }
    default:
      return state
  }
}
```

TUI 应用的状态通常比普通终端输出复杂得多——选中项、展开/折叠、过滤条件、视图模式……`useReducer` 比 `useState` 更适合管理这类状态，因为状态转换逻辑集中在 reducer 里，方便测试和调试。

### useInput — 键盘事件钩子

`useInput` 是 Ink 提供的键盘事件钩子，这是终端 UI 和 Web UI 最大的交互差异——终端没有鼠标点击（部分终端支持但不通用），所有交互都靠键盘。

```tsx
import { useInput, useApp } from 'ink'

function NavigableList({ items }) {
  const [selected, setSelected] = useState(0)
  const { exit } = useApp()

  useInput((input, key) => {
    // 方向键导航
    if (key.upArrow) {
      setSelected(prev => Math.max(0, prev - 1))
    }
    if (key.downArrow) {
      setSelected(prev => Math.min(items.length - 1, prev + 1))
    }

    // Page Up / Page Down（大跳转）
    if (key.pageUp) {
      setSelected(prev => Math.max(0, prev - 10))
    }
    if (key.pageDown) {
      setSelected(prev => Math.min(items.length - 1, prev + 10))
    }

    // Enter 确认
    if (key.return) {
      handleSelect(items[selected])
    }

    // q 退出
    if (input === 'q') {
      exit()
    }

    // Ctrl+C 也能退出（useInput 能捕获）
    if (input === 'c' && key.ctrl) {
      exit()
    }

    // / 进入搜索模式
    if (input === '/') {
      setSearchMode(true)
    }
  })

  // ...渲染逻辑
}
```

`useInput` 的回调接收两个参数：`input` 是按下的字符（`'a'`、`'q'`、`'/'` 等），`key` 是一个对象，包含修饰键和特殊键的布尔值（`key.upArrow`、`key.ctrl`、`key.shift`、`key.return`、`key.escape` 等）。

设计键盘快捷键时有几个原则：

1. **遵循惯例**：`q` 退出、`/` 搜索、`j/k` 上下移动（Vim 风格）——这些是终端用户的肌肉记忆
2. **提供视觉提示**：在状态栏显示可用快捷键，降低学习成本
3. **区分模式**：导航模式和输入模式的快捷键要分开，否则用户想输入 `q` 时会意外退出

### useEffect 和异步数据

终端 UI 同样需要处理异步数据加载，`useEffect` 的用法和 Web 端一致：

```tsx
import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'

function AIReview({ filePath }) {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  const [result, setResult] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchReview() {
      try {
        const review = await callAI(filePath)
        if (!cancelled) {
          setResult(review)
          setStatus('done')
        }
      } catch (err) {
        if (!cancelled) {
          setResult(err.message)
          setStatus('error')
        }
      }
    }

    fetchReview()
    return () => { cancelled = true }
  }, [filePath])

  if (status === 'loading') {
    return (
      <Box>
        <Spinner type="dots" />
        <Text> 正在分析 {filePath}...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text color={status === 'error' ? 'red' : 'green'}>
        {status === 'error' ? '✗' : '✓'} {filePath}
      </Text>
      <Text>{result}</Text>
    </Box>
  )
}
```

注意 `cancelled` 标志——当用户快速切换文件时，前一个请求的回调可能在组件已经更新后才返回。`cancelled` 确保过时的结果不会覆盖新的状态。这在 Web 开发中也是常见模式，但在 TUI 中更容易被忽略。

## 自定义组件开发思路

基础组件能覆盖大部分场景，但真正的 TUI 应用需要领域特定的组件。以下是 repox 可能用到的几个自定义组件的设计思路。

### StatusBar — 状态栏

```tsx
// 概念性代码：展示状态栏组件的设计
import React from 'react'
import { Box, Text, Spacer } from 'ink'

interface StatusBarProps {
  filename?: string
  line?: number
  total?: number
  mode?: string
  branch?: string
}

function StatusBar({ filename, line, total, mode, branch }: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      {/* 左侧：模式和文件信息 */}
      <Text backgroundColor="blue" color="white" bold>
        {' '}{mode || 'NORMAL'}{' '}
      </Text>
      <Text> </Text>
      {filename && <Text>{filename}</Text>}

      <Spacer />

      {/* 右侧：分支和位置 */}
      {branch && (
        <Text dimColor>
          ⎇ {branch}
        </Text>
      )}
      <Text> </Text>
      {line != null && total != null && (
        <Text dimColor>
          {line}/{total}
        </Text>
      )}
    </Box>
  )
}
```

状态栏是 TUI 应用的标配。好的状态栏遵循一个原则：**左边是上下文信息（当前在哪），右边是元数据（统计和状态）**。这和 VS Code 底部状态栏的布局思路一致。

### DiffView — 差异预览

```tsx
// 概念性代码：展示 diff 渲染组件的设计
import React from 'react'
import { Box, Text } from 'ink'

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header'
  content: string
  lineNumber?: number
}

function DiffView({ lines, scrollOffset = 0, visibleHeight = 20 }: {
  lines: DiffLine[]
  scrollOffset?: number
  visibleHeight?: number
}) {
  const visible = lines.slice(scrollOffset, scrollOffset + visibleHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((line, i) => {
        const lineNum = line.lineNumber
          ? String(line.lineNumber).padStart(4)
          : '    '

        const colorMap = {
          add: 'green',
          remove: 'red',
          context: 'white',
          header: 'cyan',
        } as const

        const prefixMap = {
          add: '+',
          remove: '-',
          context: ' ',
          header: '@',
        }

        return (
          <Box key={i}>
            <Text dimColor>{lineNum} </Text>
            <Text color={colorMap[line.type]}>
              {prefixMap[line.type]} {line.content}
            </Text>
          </Box>
        )
      })}

      {/* 滚动指示器 */}
      {lines.length > visibleHeight && (
        <Box justifyContent="flex-end">
          <Text dimColor>
            [{scrollOffset + 1}-{Math.min(scrollOffset + visibleHeight, lines.length)}/{lines.length}]
          </Text>
        </Box>
      )}
    </Box>
  )
}
```

DiffView 的关键设计决策是滚动。终端不像浏览器有原生滚动条，需要自己实现虚拟滚动——维护一个 `scrollOffset` 状态，只渲染可见范围内的行。这和 React 的虚拟列表（react-window / react-virtualized）是同一个思路。

### StreamingText — 流式文本

AI 应用中最常见的 UI 需求是流式输出——文本逐字/逐词出现。

```tsx
// 概念性代码：展示流式文本组件的设计
import React, { useState, useEffect } from 'react'
import { Text } from 'ink'

function StreamingText({ stream }: { stream: AsyncIterable<string> }) {
  const [text, setText] = useState('')

  useEffect(() => {
    let cancelled = false

    async function consume() {
      for await (const chunk of stream) {
        if (cancelled) break
        setText(prev => prev + chunk)
      }
    }

    consume()
    return () => { cancelled = true }
  }, [stream])

  return <Text>{text}</Text>
}
```

这里的 `stream` 参数是一个异步可迭代对象（`AsyncIterable<string>`），可以对接 AI API 的流式响应。每当收到新的文本片段，组件状态更新，Ink 自动重绘。

### FileTree — 文件树

```tsx
// 概念性代码：展示文件树组件的设计
import React from 'react'
import { Box, Text } from 'ink'

interface TreeNode {
  name: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  status?: 'added' | 'modified' | 'deleted'
}

function FileTree({ nodes, selected, depth = 0, expanded }: {
  nodes: TreeNode[]
  selected: string
  depth?: number
  expanded: Set<string>
}) {
  return (
    <Box flexDirection="column">
      {nodes.map(node => {
        const isSelected = node.name === selected
        const indent = '  '.repeat(depth)
        const icon = node.type === 'directory'
          ? (expanded.has(node.name) ? '▾ ' : '▸ ')
          : '  '

        const statusColor = {
          added: 'green',
          modified: 'yellow',
          deleted: 'red',
        }[node.status || ''] || 'white'

        return (
          <Box key={node.name} flexDirection="column">
            <Text
              color={isSelected ? 'cyan' : statusColor}
              bold={isSelected}
              backgroundColor={isSelected ? 'gray' : undefined}
            >
              {indent}{icon}{node.name}
            </Text>
            {node.children && expanded.has(node.name) && (
              <FileTree
                nodes={node.children}
                selected={selected}
                depth={depth + 1}
                expanded={expanded}
              />
            )}
          </Box>
        )
      })}
    </Box>
  )
}
```

递归组件在终端里和浏览器里一样好用。文件树的核心状态是"哪些目录展开了"（`expanded: Set<string>`）和"当前选中项"（`selected`），用方向键改变选中项、用 Enter 或右方向键展开/折叠目录。

## 案例拆解：Claude Code 的终端 UI 组件架构

Claude Code 是目前最复杂的 Ink 应用之一，它的 UI 层提供了很好的学习参考。

### 架构概览

Claude Code 的终端界面包含 25 个以上的 React 组件，核心架构特点：

1. **自定义 React Reconciler**：Claude Code 没有直接使用 Ink 的标准 reconciler，而是在其基础上做了扩展。原因是标准 Ink 的渲染策略是"状态变化时完整重绘可见区域"，对于大量流式文本输出的场景，性能开销不可接受。自定义 reconciler 实现了更细粒度的增量更新。

2. **ANSI Parser**：Claude Code 需要正确处理来自子进程（如 `git diff`、`cat` 命令）的 ANSI 输出。它内置了一个 ANSI 转义序列解析器，能正确拆分和渲染带颜色的外部命令输出，而不是把转义序列当作普通文本显示。

3. **组件分层**：
   - 基础层：`Text`、`Box` 等 Ink 原生组件
   - 通用层：`Spinner`、`Markdown`、`SyntaxHighlight`、`Table` 等可复用组件
   - 业务层：`MessageThread`、`ToolCallResult`、`PermissionPrompt`、`CostDisplay` 等特定于 Claude Code 功能的组件
   - 布局层：`AppLayout` 管理整体结构——输入框在底部、消息流在中间、状态栏在顶部

4. **Markdown 渲染**：这是 Claude Code UI 中最复杂的组件之一。AI 返回的内容是 Markdown 格式，需要在终端中正确渲染标题、列表、代码块、链接等元素。它使用了 AST 解析（而非正则匹配）来处理 Markdown，确保嵌套结构的正确渲染。

5. **权限确认界面**：当 AI 需要执行文件写入、命令执行等敏感操作时，Claude Code 会弹出一个交互式确认界面，高亮显示即将执行的操作和影响范围。这个组件需要临时接管键盘输入（拦截 `y`/`n` 按键），处理完后归还控制权。

### 关键设计决策

Claude Code 的 UI 有几个值得借鉴的设计决策：

**输入框固定在底部**。和大多数聊天 UI 一样，输入区域在屏幕最下方，消息流从下往上滚动。这个布局用 Flexbox 实现很简单——内容区 `flexGrow={1}`，输入区固定高度。

**流式输出不闪烁**。AI 返回的文本是逐 token 流式到达的。如果每个 token 都触发完整重绘，在长回复时会有明显闪烁。Claude Code 的做法是把流式文本当作一个"追加区域"，新文本直接 append 到 stdout，不触发全局重绘。只有当需要改变已有内容（比如用户按 Ctrl+C 中断）时才回退到完整重绘。

**语法高亮按需加载**。代码块的语法高亮是计算密集型操作，Claude Code 不会在每次 token 到达时都重新高亮整个代码块。而是等代码块结束（检测到 ``` 闭合标记）后一次性高亮，减少中间状态的计算量。

## 实战概念：repox review --tui

基于前面的知识，设计一个全屏 TUI Code Review 界面。以下代码是概念性的，展示组件化 TUI 的架构思路，而非 repox 中可直接运行的代码。

### 整体布局

```tsx
// 概念性代码：repox review --tui 的整体布局
import React, { useState, useReducer } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import Spinner from 'ink-spinner'

// ===== 文件树组件 =====
function FileTree({ files, selected, onSelect }) {
  return (
    <Box flexDirection="column" borderStyle="single" width={30}>
      <Box paddingX={1} borderStyle="single" borderLeft={false} borderRight={false} borderTop={false}>
        <Text bold>变更文件</Text>
        <Spacer />
        <Text dimColor>{files.length}</Text>
      </Box>
      {files.map((file, i) => (
        <Box key={file.path} paddingX={1}>
          <Text
            color={i === selected ? 'cyan' : file.status === 'added' ? 'green' : file.status === 'deleted' ? 'red' : 'yellow'}
            bold={i === selected}
            backgroundColor={i === selected ? 'gray' : undefined}
          >
            {i === selected ? '▸ ' : '  '}
            {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}{' '}
            {file.path}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// ===== Diff 预览组件 =====
function DiffView({ diff, scrollOffset }) {
  const lines = diff.split('\n')
  const visibleHeight = (process.stdout.rows || 24) - 6  // 减去边框和状态栏
  const visible = lines.slice(scrollOffset, scrollOffset + visibleHeight)

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single">
      <Box paddingX={1} borderStyle="single" borderLeft={false} borderRight={false} borderTop={false}>
        <Text bold>差异预览</Text>
      </Box>
      {visible.map((line, i) => (
        <Text
          key={scrollOffset + i}
          color={
            line.startsWith('@@') ? 'cyan' :
            line.startsWith('+') ? 'green' :
            line.startsWith('-') ? 'red' :
            'white'
          }
        >
          {' '}{line}
        </Text>
      ))}
    </Box>
  )
}

// ===== 状态栏组件 =====
function StatusBar({ filename, position, total, branch }) {
  return (
    <Box paddingX={1}>
      <Text backgroundColor="blue" color="white" bold>
        {' '}REVIEW{' '}
      </Text>
      <Text> {filename} </Text>
      <Spacer />
      <Text dimColor>⎇ {branch}</Text>
      <Text> </Text>
      <Text dimColor>{position}/{total}</Text>
      <Text>  </Text>
      <Text dimColor>↑↓ 导航  Enter 选择  q 退出</Text>
    </Box>
  )
}

// ===== 主应用 =====
function ReviewTUI({ files, diffs, branch }) {
  const [selected, setSelected] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const { exit } = useApp()

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(prev => Math.max(0, prev - 1))
      setScrollOffset(0) // 切换文件时重置滚动
    }
    if (key.downArrow) {
      setSelected(prev => Math.min(files.length - 1, prev + 1))
      setScrollOffset(0)
    }
    // j/k Vim 风格滚动 diff 内容
    if (input === 'j') {
      setScrollOffset(prev => prev + 1)
    }
    if (input === 'k') {
      setScrollOffset(prev => Math.max(0, prev - 1))
    }
    if (input === 'q') {
      exit()
    }
  })

  return (
    <Box flexDirection="column" height={process.stdout.rows}>
      {/* 主内容区：左右分栏 */}
      <Box flexDirection="row" flexGrow={1}>
        <FileTree
          files={files}
          selected={selected}
          onSelect={setSelected}
        />
        <DiffView
          diff={diffs[selected] || ''}
          scrollOffset={scrollOffset}
        />
      </Box>

      {/* 底部状态栏 */}
      <StatusBar
        filename={files[selected]?.path || ''}
        position={selected + 1}
        total={files.length}
        branch={branch}
      />
    </Box>
  )
}
```

### 交互设计

这个 TUI 界面的交互模型：

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 在文件列表中上下移动 |
| `j` / `k` | 滚动 diff 内容 |
| `Enter` | 打开文件详情（可扩展） |
| `/` | 进入搜索模式，过滤文件列表 |
| `q` | 退出 |
| `Ctrl+C` | 强制退出 |

快捷键的设计遵循"方向键给所有人，Vim 键给高级用户"的原则。`↑↓` 人人都会用，`j/k` 是给终端老手的加速键。两套快捷键不冲突。

### 集成到命令系统

TUI 模式作为 `review` 命令的一个选项：

```typescript
// 概念性代码：命令注册
program
  .command('review')
  .option('--tui', '启动全屏 TUI 界面')
  .option('-f, --format <format>', '输出格式', 'text')
  .action(async (options) => {
    const { files, diffs } = await analyzeChanges()

    if (options.tui) {
      // TUI 模式：全屏交互界面
      const { waitUntilExit } = render(
        <ReviewTUI files={files} diffs={diffs} branch="main" />
      )
      await waitUntilExit()
    } else {
      // 标准模式：纯文本输出
      printReviewResult(files, diffs, options.format)
    }
  })
```

`render()` 返回的 `waitUntilExit` 是一个 Promise，在用户退出 TUI（调用 `exit()`）时 resolve。这确保了 TUI 运行期间主进程不会提前退出。

### 从概念到实现的注意事项

把上面的概念代码变成可运行的实现，还需要解决几个问题：

1. **终端尺寸变化**：用户可能在 TUI 运行时调整终端窗口大小。需要监听 `process.stdout.on('resize')` 事件，触发重新布局。Ink 内置了对 resize 的基本处理，但自定义的滚动逻辑需要手动适配。

2. **大文件性能**：如果 diff 有几千行，渲染所有行再靠 Ink 裁剪可见区域是低效的。应该在组件层面做虚拟滚动——只创建可见行的组件节点。

3. **非 TTY 降级**：如果用户在管道中使用了 `--tui` 标志（`repox review --tui | less`），应该检测 `process.stdout.isTTY` 并给出错误提示，而不是尝试渲染 TUI。

4. **替代光标**：全屏 TUI 应该在启动时切换到终端的 alternate screen buffer（`\x1b[?1049h`），退出时切换回来（`\x1b[?1049l`）。这样 TUI 关闭后终端恢复原样，不会留下一屏渲染残留。Ink 的 `fullscreen` 选项可以自动处理这个。

```tsx
// 启用全屏模式
const { waitUntilExit } = render(<ReviewTUI />, {
  exitOnCtrlC: true,
  // Ink v4+ 支持 stdout 配置
})
```

## 小结

这一章从命令式输出跳到了声明式 UI，核心要点：

- **Ink 的本质**是一个 React 运行时，用 React reconciler 管理组件树，用 Yoga 计算 Flexbox 布局，最终输出 ANSI 字符。前端工程师的 React 经验可以直接复用。
- **基础组件**只有 `Box`（布局）和 `Text`（文本）两个，加上 `Spacer` 和 `Newline` 辅助。简单的组件库能构建出复杂的界面。
- **Flexbox 在终端中完全可用**，`flexDirection`、`flexGrow`、`justifyContent`、`padding`、`borderStyle` 等属性和 CSS 一致。终端的约束反而让布局更简单。
- **交互靠键盘**。`useInput` 钩子处理所有键盘事件，快捷键设计要兼顾新手（方向键）和老手（Vim 键）。
- **状态管理是标准 React**。`useState` 处理简单状态，`useReducer` 处理复杂交互逻辑，`useEffect` 处理异步数据。
- **自定义组件**遵循单一职责——`FileTree` 负责文件列表、`DiffView` 负责差异渲染、`StatusBar` 负责状态展示、`StreamingText` 负责流式输出。
- **Claude Code 展示了 Ink 的上限**：25+ 组件、自定义 reconciler、ANSI parser、流式渲染优化。Ink 不只能做简单的列表和 spinner，它能支撑生产级的复杂 TUI 应用。

TUI 不是 CLI 的必需品，但它是 CLI 的能力上限。当纯文本输出无法满足交互需求时，Ink 提供了一条从简单到复杂的平滑路径——不需要抛弃已有的 React 经验，不需要学习全新的 UI 框架。下一章将视野拉远，看看 CLI 工具在 AI 基础设施中的定位。

## 动手试一试

1. 给 ReviewApp 添加 Tab 切换功能：按 Tab 键在"文件列表""diff 预览""AI 评论"三个面板之间切换焦点
2. 实现一个 `ProgressBar` 组件：接受 `current` 和 `total` 属性，渲染 `[████░░░░░░] 40%` 形式的进度条
3. 尝试用 Ink 实现一个简单的 dashboard：上方显示 `repox scan` 的结果摘要，下方显示最近 5 条 commit 记录，整个界面自适应终端宽度
