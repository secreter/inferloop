# 第 24 章 毕业项目：从零构建 changelog-generator

## 任务描述

构建一个 `changelog-generator` Skill，实现以下功能：

1. 读取当前项目的 git log，生成结构化的变更日志
2. 按 conventional commits 规范分类：feat / fix / refactor / docs / chore
3. 支持通过参数指定版本范围，例如 `/changelog v1.2.0..v1.3.0`
4. 输出标准的 Markdown 格式

这个项目覆盖了本书大部分核心知识点。完成它，说明你已经掌握了 Skill 开发的完整流程。

## 知识点覆盖

这个项目不是凭空设计的，每个需求都对应本书的特定章节：

| 需求 | 对应章节 | 具体知识点 |
|------|---------|-----------|
| 读取 git log 注入上下文 | 第 8 章 动态上下文 | `!`command`` 语法 |
| Markdown 输出格式 | 第 7 章 输出格式约束 | 模板 + 示例驱动 |
| 不同项目使用不同分类规则 | 第 10 章 插件化规则 | references/ 外挂规则文件 |
| TypeScript 脚本解析 git log | 第 11 章 脚本 | scripts/ 目录使用 |
| 评估分类准确率 | 第 12 章 自评分 | 内置评分逻辑 |
| 生成后自动 commit | 第 13 章 Hooks | hooks 配置 |
| 测试用例和断言 | 第 20 章 evals | evals.json 编写 |

如果你在做的过程中发现某个部分不确定怎么写，回去翻对应的章节。

## 目录结构

最终的 Skill 目录结构应该是这样的：

```
changelog-generator/
├── SKILL.md
├── scripts/
│   └── parse-commits.ts
├── references/
│   └── commit-categories.md
├── evals/
│   └── evals.json
└── hooks/
    └── ... (你来决定用什么 hook)
```

## 验收标准

完成后，用这个清单自检：

- [ ] **SKILL.md 不超过 200 行。** 如果超过了，说明你塞了太多东西。把规则抽到 references/，把逻辑抽到 scripts/。
- [ ] **description 覆盖三种表达。** 用户说"生成 changelog"、"最近改了什么"、"release notes"时都能触发。你的 description 要覆盖这些意图。
- [ ] **支持 $0 参数指定版本范围。** `/changelog v1.2.0..v1.3.0` 应该只生成这个范围内的变更。不传参数时，默认使用最近一个 tag 到 HEAD。
- [ ] **输出按分类组织。** 不是把 commit 列表扔出来就完了。至少按 feat / fix / refactor / docs / chore 分组，每组有标题。不符合 conventional commits 格式的 commit 放到"其他"分类。
- [ ] **有 scripts/parse-commits.ts。** 这个脚本负责解析 git log 的原始输出，返回结构化的 JSON。不要让 Claude 自己解析原始文本——用脚本解析更可靠。
- [ ] **有 evals/evals.json，至少 3 个用例。** 用例要覆盖：正常情况、无 commit 的情况、有不规范 commit message 的情况。每个用例至少有一个断言。
- [ ] **有 hooks 配置。** 生成 changelog 后自动做一件事（commit、格式化、或其他你觉得合理的操作）。

## 提示

不给答案，给方向。

### git log 的格式化输出

```bash
git log --format="%H|%s|%an|%ad" --date=short v1.2.0..v1.3.0
```

这个格式输出：完整 hash、commit message 主题、作者名、日期，用 `|` 分隔。这样你的 TypeScript 脚本可以简单地按 `|` 分割来解析。

如果不传版本范围，获取最近一个 tag：

```bash
git describe --tags --abbrev=0
```

### conventional commits 的解析

一个 conventional commit message 的格式：

```
feat(auth): add OAuth2 support
fix: resolve memory leak in parser
refactor(api)!: restructure endpoint naming
docs: update API documentation
chore: bump dependencies
```

匹配的正则大致是：

```
/^(feat|fix|refactor|docs|chore)(\(.+\))?!?: .+/
```

不匹配的 commit 不是错误，归入"其他"分类就行。现实项目中总有人不按规范写 commit message。

### 输出格式参考

大致像这样（具体格式你来定）：

```markdown
# Changelog v1.2.0 → v1.3.0

## Features
- **auth**: add OAuth2 support (a1b2c3d)
- add dark mode toggle (e4f5g6h)

## Bug Fixes
- resolve memory leak in parser (i7j8k9l)

## Refactoring
- **api**: restructure endpoint naming (m0n1o2p)

## Documentation
- update API documentation (q3r4s5t)

## Other
- bump dependencies (u6v7w8x)
- misc cleanup (y9z0a1b)
```

### scripts/parse-commits.ts 的职责

这个脚本做三件事：

1. 接收 git log 的原始输出（stdin 或文件参数）
2. 解析每一行，提取 hash、type、scope、description、author、date
3. 输出结构化的 JSON

Claude 拿到 JSON 后负责格式化成 Markdown。职责分离：脚本负责解析，Skill 负责格式化。

### 关于 evals

三个用例的思路：

1. **正常项目**：有一堆规范的 conventional commits，验证分类是否正确
2. **空范围**：指定的版本范围内没有 commit，验证是否给出合理的提示
3. **混合 commit**：一部分是规范的，一部分不是，验证不规范的是否归入"其他"

### 参考答案

完成后可以对照 `examples/ch24-graduation/changelog-generator/` 中的参考实现。但先自己做，做完再看。参考答案只是一种实现方式，不是标准答案。

## 做完之后

如果你完成了这个项目，你已经具备了以下能力：

- 从零设计一个 Skill 的结构
- 使用动态上下文注入运行时信息
- 用脚本处理复杂的数据解析
- 用 references 实现可配置的规则
- 为 Skill 编写 evals
- 配置 hooks 实现自动化后处理

下一步？把它放到你的真实项目里用起来。按第 22 章的流程走一遍——个人试用一周，写 eval，提 PR，让同事试用。这就是从"学会了"到"用起来"的最后一步。
