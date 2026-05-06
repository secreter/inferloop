# code-simplifier：自动代码简化 Agent

一个在你写完代码后自动介入，在不改变功能的前提下简化和打磨代码的 Agent 插件。

## 技术原理

插件结构极简：一个 `plugin.json` 描述文件 + 一个 `agents/code-simplifier.md` Agent 定义文件。没有 command，没有 hook，没有脚本。

它注册的是一个名为 `code-simplifier` 的 Agent，模型指定为 `opus`。Agent 的触发时机写在 description 里——不是用户手动调用，而是 Claude 在完成一段编码任务后自动判断是否需要启动。description 里给了三个触发示例：实现新功能后、修完 bug 后、做完性能优化后。

Agent 的核心逻辑围绕五条原则：

**保持功能不变**。这是红线。Agent 只改代码的写法，不改代码做什么。这个限制不靠代码强制，靠 prompt 约束——所以并非百分之百可靠。

**执行项目规范**。Agent 会读取 CLAUDE.md 中的编码标准。prompt 里预设了一些具体规范作为示例：用 ES modules、优先用 `function` 声明而非箭头函数、顶层函数加显式返回类型注解、React 组件用显式 Props 类型。这些是 Claude Code 项目自身的规范，不是通用的。

**提升清晰度**。减少不必要的嵌套和复杂度、去掉冗余抽象、改善变量和函数命名、合并相关逻辑、删除复述代码的无用注释。特别强调禁止嵌套三元运算符——用 switch 或 if/else 代替。

**维持平衡**。不过度简化。不把太多职责塞进一个函数、不删有用的抽象、不为了减少行数牺牲可读性。"fewer lines" 不等于更好。

**限定范围**。只动最近修改的代码，不主动扩大范围。除非用户明确要求审查更大范围。

工作流程是：找到最近改过的代码段 → 分析优化空间 → 应用项目规范 → 确认功能未变 → 验证简化效果 → 记录重要变更。

## 安装与配置

```bash
/plugin install code-simplifier@claude-plugins-official
```

无配置项。有 CLAUDE.md 的项目效果更好——Agent 会从中提取编码规范来指导简化。

## 使用方法

这个插件设计为**自动触发**。当 Claude 判断你刚完成了一段代码修改，它会自行启动 `code-simplifier` Agent 做一轮简化。你不需要手动调用。

如果你想手动触发，可以在对话中直接提到它：

```
用 code-simplifier agent 检查一下我刚写的代码
```

或者在 `pr-review-toolkit` 里通过 `/review-pr simplify` 调用它。

## 使用场景

**功能实现后的打磨**。写一个新功能时脑子里想的是"让它跑起来"，代码里难免有临时变量名、多余的嵌套、匆忙写的条件判断。功能跑通后让 `code-simplifier` 过一遍，相当于给代码做一次整理。

```typescript
// 简化前：功能没问题但嵌套深
function processItems(items: Item[]): Result[] {
  const results: Result[] = [];
  for (const item of items) {
    if (item.isValid) {
      if (item.type === 'A') {
        results.push(handleTypeA(item));
      } else {
        if (item.type === 'B') {
          results.push(handleTypeB(item));
        } else {
          results.push(handleDefault(item));
        }
      }
    }
  }
  return results;
}

// 简化后：early return + switch 替换嵌套
function processItems(items: Item[]): Result[] {
  return items
    .filter((item) => item.isValid)
    .map((item) => {
      switch (item.type) {
        case 'A': return handleTypeA(item);
        case 'B': return handleTypeB(item);
        default: return handleDefault(item);
      }
    });
}
```

**bug 修复后的清理**。修 bug 经常是加一个判断、包一层 try-catch、插一个 early return。修完之后原来的代码结构可能变得不太协调。`code-simplifier` 会把修复和原代码的结构统一起来。

**团队规范统一**。不同人写的代码风格不同——有人爱箭头函数，有人爱 function 声明；有人用三元，有人用 if/else。如果 CLAUDE.md 里写了规范，`code-simplifier` 会按规范来统一。

## 局限与注意事项

**它会直接改代码**。这不是一个只给建议的工具，它会实际修改文件。如果简化改错了，你得自己撤回。建议在改之前确认 git 状态是干净的，方便回退。

**"功能不变"靠 prompt 保证**。没有自动化测试来验证简化后功能是否真的没变。对于复杂的简化（比如重写了条件逻辑），有可能引入微妙的行为差异。简化后跑一遍测试是必要的。

**预设规范偏向特定技术栈**。prompt 里写的 ES modules、function 声明、React Props 类型这些，显然面向 TypeScript/React 项目。如果你的项目用的是 Python 或 Go，这些规范不适用。Agent 应该会参考你的 CLAUDE.md 来覆盖这些默认值，但如果 CLAUDE.md 没写，它就会按 TypeScript 的习惯来。

**自动触发可能不是你想要的**。有时候你写了一段代码只是临时用用，或者还在迭代中不想被打磨。自动触发机制可能在你不想被打扰的时候介入。

**模型固定为 opus**。不管你当前会话用的是什么模型，`code-simplifier` Agent 都会用 opus。这意味着更高的 token 消耗和延迟。对于小改动来说有点杀鸡用牛刀。
