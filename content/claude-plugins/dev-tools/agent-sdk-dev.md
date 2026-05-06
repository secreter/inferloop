# agent-sdk-dev：Agent SDK 项目脚手架与验证

一句话：提供一个交互式命令 `/new-sdk-app` 来创建 Claude Agent SDK 项目，外加两个验证 Agent 检查项目是否符合 SDK 最佳实践。

## 技术原理

插件由三个部分组成：

1. **`/new-sdk-app` 命令**（`commands/new-sdk-app.md`）—— 一个纯 Markdown 指令文件，定义了一个多步交互流程
2. **`agent-sdk-verifier-ts`**（`agents/agent-sdk-verifier-ts.md`）—— TypeScript 项目验证 Agent
3. **`agent-sdk-verifier-py`**（`agents/agent-sdk-verifier-py.md`）—— Python 项目验证 Agent

这三个都不是可执行代码，而是给 Claude 的行为指令。

`/new-sdk-app` 的工作流程被设计成严格的一问一答模式（不是一次性抛出所有问题）：

1. 问语言（TypeScript / Python）
2. 问项目名
3. 问 Agent 类型（编码 / 业务 / 自定义）
4. 问起步模板（最小化 / 基础 / 按场景定制）
5. 问工具链偏好（npm / yarn / pnpm）

收集完需求后，Claude 会：
- 用 WebFetch 拉取 Agent SDK 官方文档确认最新 API
- 用 WebSearch 查最新包版本
- 创建项目目录、初始化包管理器、安装 SDK
- 生成入口文件、tsconfig.json（TS）或 requirements.txt（Python）
- 创建 .env.example 和 .gitignore
- 对 TypeScript 项目运行 `npx tsc --noEmit` 验证类型

最后自动调用对应的 verifier Agent。verifier Agent 使用 `model: sonnet` 运行（比主对话用的模型小），按清单逐项检查：

- SDK 版本是否够新
- tsconfig.json / pyproject.toml 配置是否正确
- Agent 初始化和调用方式是否符合文档
- 类型安全（TS）/ 导入正确性（Python）
- .env 不在版本控制中
- API key 没有硬编码
- 错误处理是否覆盖了 SDK 特有的异常

检查结果输出为结构化报告：PASS / PASS WITH WARNINGS / FAIL，列出具体问题和修复建议。

## 安装与配置

```bash
cc --plugin-dir /path/to/agent-sdk-dev
```

依赖：
- Node.js 或 Python（取决于你选的语言）
- 需要联网（命令会用 WebFetch 拉文档、用 WebSearch 查版本）

## 使用方法

创建新项目：

```
/new-sdk-app customer-support-agent
```

不带参数也行，Claude 会问你项目名：

```
/new-sdk-app
```

手动触发验证（不新建项目，对已有项目）：

```
验证我的 TypeScript Agent SDK 应用
```

或

```
检查我的 SDK 应用是否符合最佳实践
```

创建后 Claude 会告诉你怎么运行：

```bash
# 设置 API key
echo "ANTHROPIC_API_KEY=sk-xxx" > .env

# TypeScript
npm start

# Python
python main.py
```

## 使用场景

**从零开始写一个 Claude Agent。** 你想用 Agent SDK 搭一个自动化客服 Agent，但不确定项目结构该怎么组织、SDK 的最新 API 长什么样。`/new-sdk-app` 帮你搞定脚手架，确保用的是最新版本和正确的初始化模式。

**接手一个别人写的 Agent 项目，不确定是否合规。** 直接让 Claude 跑 verifier Agent，几分钟出一份检查报告，告诉你哪里有问题。

**SDK 升级后做合规检查。** Agent SDK 更新了 API，你改完代码不确定改对了。verifier 会对照最新文档逐项核验。

## 局限与注意事项

**强依赖联网。** `/new-sdk-app` 在创建过程中要用 WebFetch 拉官方文档（`docs.claude.com`）和查 npm/PyPI 的最新版本。离线环境下跑不起来。

**Verifier 的检查深度有限。** 它只做静态检查（读文件、跑 `tsc --noEmit`），不会真正启动你的 Agent 跑一遍。运行时才暴露的问题（比如 API key 权限不对、prompt 效果差）它查不出来。

**一问一答的交互模式有点慢。** 命令被设计成每次只问一个问题等你回复，5 个问题走完要好几轮对话。如果你已经知道自己要什么，可以一次性把所有需求塞在参数里，Claude 会跳过已回答的问题。

**文档链接可能过期。** 命令里硬编码了 `docs.claude.com/en/api/agent-sdk/overview` 等 URL。如果 Anthropic 改了文档结构，WebFetch 会失败。这时候 Claude 会降级到用自己的训练数据，但可能不是最新的。

**Verifier Agent 用的是 Sonnet 模型。** 指令里写了 `model: sonnet`，检查精细度不如主对话用的大模型。对于复杂项目，verifier 可能漏掉一些微妙的问题。
