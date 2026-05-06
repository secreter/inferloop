# 5 分钟，你的第一个 Skill

别急着看理论。先花 5 分钟做一个能跑的 Skill，体会一下"有 Skill"和"没 Skill"的区别。

## 场景

你让 Claude 解释一段代码，它通常会逐行翻译——正确但无聊，读完跟没读一样。

你真正想要的是：一个类比帮你秒懂，一张 ASCII 图看清流程，再点出容易踩的坑。

这种"解释风格"的偏好，说一次可以，每次都说就烦了。Skill 就是干这个的。

## 动手

两步。

**第一步**，创建目录：

```bash
mkdir -p ~/.claude/skills/explain-code
```

**第二步**，创建 `~/.claude/skills/explain-code/SKILL.md`，内容如下：

```yaml
---
name: explain-code
description: "用类比和图解的方式解释代码。当用户问'这段代码干什么'、'解释一下这个函数'、'这个模块怎么工作的'时使用。"
---

解释代码时，按这个结构来：

1. **一句话概括**：这段代码在做什么，用一句大白话说清楚
2. **类比**：找一个日常生活中的类比，帮助理解核心逻辑
3. **流程图**：用 ASCII art 画出代码的执行流程或数据流向
4. **逐段解读**：分段解释关键逻辑，跳过显而易见的部分
5. **容易踩的坑**：指出一个初学者容易误解或犯错的地方

语气保持口语化，像是在白板前给同事讲解。
```

完了。总共 15 行。

## 试一下

打开 Claude Code，扔一段代码给它：

```
解释一下这段代码：

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}
```

## 效果对比

**没有 Skill 时**，你大概会得到这样的回复：

> 这个函数接收 `value` 和 `delay` 两个参数。它使用 `useState` 创建了一个状态 `debouncedValue`。在 `useEffect` 中，它设置了一个 `setTimeout`，在 `delay` 毫秒后更新 `debouncedValue`。清理函数会清除定时器。当 `value` 或 `delay` 变化时，effect 会重新执行。

正确，但读完你还是不太确定"为什么要这么写"。

**有 Skill 后**，回复变成这样：

> **一句话概括**：用户狂敲键盘时别急着响应，等他停下来再说。
>
> **类比**：就像电梯关门——有人按按钮，门就重新计时。只有没人再按了，门才真正关上。每次 `value` 变化就是"有人按了按钮"，`delay` 就是电梯等待的秒数。
>
> **流程图**：
> ```
> value 变化
>     │
>     ▼
> 清掉上一个定时器
>     │
>     ▼
> 启动新定时器（delay ms）
>     │
>     ├── delay 内 value 又变了 ──→ 回到顶部
>     │
>     └── delay 到了，没有新变化
>             │
>             ▼
>       更新 debouncedValue
> ```
>
> **逐段解读**：核心就一个 `useEffect`。每次 value 变化时先清掉旧定时器（`clearTimeout`），再设新的。这样只有最后一次变化会真正生效。
>
> **容易踩的坑**：别忘了 `delay` 也在依赖数组里。如果你把 `delay` 写成一个每次渲染都变的表达式（比如直接传对象属性），会导致 effect 疯狂重跑，debounce 形同虚设。

同样的问题，回答的信息密度和可理解性完全不同。

## 这就是一个 Skill

一个文件夹，一个 `SKILL.md`，没了。

你刚才做的事情就是：把"我希望你每次都这样回答"写成了一个可复用的指令文件。Claude 会在合适的时机自动加载它。

接下来我们用同样的方式，构建一个更复杂的 code-review Skill——它不只是改变回答风格，还会调用工具、读取文件、执行多步检查。
