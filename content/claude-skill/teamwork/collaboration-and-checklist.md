# 多人协作与迭代规范

## Skill Owner 制度

每个 Skill 必须有一个 Owner。

这不是形式主义。你们团队的 code-review Skill 谁都能改，结果就是：小王加了一条 CSS 规则，老张加了一条 SQL 规则，实习生加了一条他在网上看到的"最佳实践"，三个人互相不知道对方改了什么。一个月后 SKILL.md 变成了一锅粥。

Owner 不是唯一能改 Skill 的人——任何人都可以提 PR。Owner 是最终的审批者和质量负责人。

Owner 的职责：

1. **Review PR**：所有 Skill 的修改必须经过 Owner review。不是走流程，是确保新规则不和已有规则矛盾、不让 Skill 膨胀。
2. **跑 eval**：每次修改后 Owner 负责确认 eval 没有退化。这和代码改完跑测试是一个道理。
3. **决定发布**：大的变更（新增规则类别、改变输出格式）由 Owner 最终拍板。

怎么选 Owner？谁写的初版谁就是 Owner。如果那个人离职了，交接时必须指定新 Owner。没有 Owner 的 Skill 应该被归档或删除——没人管的基础设施比没有更危险。

## 变更流程

一个人改了 Skill 的一条规则，全团队的工作方式就跟着变了。这种变更必须有流程。

完整的流程：

```
1. 本地修改 Skill
2. 本地跑 eval，对比 baseline
3. eval 没退化 → 提 PR
4. PR 描述中写明：改了什么、为什么改、eval 结果
5. Owner review
6. CI 自动跑 eval（第 21 章详述）
7. 合并到 main
8. 更新 baseline（如果 eval 提升了）
```

重点：**任何 Skill 的修改都必须跑 eval**。

你不会接受一个没跑测试的代码 PR。Skill 的修改也一样。加了一条新规则，你怎么知道它真的有效？怎么知道它没有让别的规则出问题？只有 eval 能回答。

一个真实场景：老张给 code-review Skill 加了一条"函数不超过 30 行"的规则。听起来很合理。但跑完 eval 发现，原来的 pass_rate 从 0.85 掉到了 0.72。为什么？因为 AI 开始把"函数超过 30 行"标记为问题，但有些测试用例里的函数就是需要 40 行——比如一个包含完整 switch-case 的状态机。

如果不跑 eval，这条规则就会被合并进去，然后团队花一周时间纳闷"为什么 AI 的 review 变蠢了"。

## 分支策略

Skill 文件和业务代码在同一个 repo。这不是偶然——Claude Code 的设计就是让 Skill 跟着项目走。

分支策略和代码一样：

```
feature/add-perf-rules    →  PR  →  merge to main
fix/review-false-positive  →  PR  →  merge to main
```

日常的小改动（修个措辞、调个断言）直接走正常 PR 流程。

重大变更需要在 PR 描述中额外说明影响范围：

```markdown
## Skill 变更说明

**改动类型**：新增规则类别
**影响范围**：code-review Skill
**具体变更**：新增性能检查规则（N+1 查询、大列表渲染）
**eval 结果**：pass_rate 0.85 → 0.88（+0.03）
**兼容性**：无破坏性变更，新增规则不影响已有检查项
```

什么算"重大变更"？三个标准：

- 新增一个规则类别（不是在已有类别里加条目）
- 改变输出格式（比如从 markdown 改成 JSON）
- 修改 frontmatter 配置（比如改 allowed-tools）

## 冲突处理

两个人同时改同一个规则文件——正常的 git merge 冲突，正常解决。Skill 文件都是 markdown，冲突标记很好读。

更常见的冲突不是 git 层面的，而是观点层面的：两个人对同一条规则有不同意见。

比如小王觉得"函数不超过 30 行"，老张觉得"函数不超过 50 行"。

处理方式：

1. 各自跑 eval，拿数据说话。30 行限制的 pass_rate 和 50 行限制的 pass_rate 差多少？
2. 如果数据没有显著差异，Owner 拍板。
3. 在知识库的 architecture-decisions.md 记录决策理由：

```markdown
## ADR-012：函数行数限制
日期：2025-04
决策：函数体不超过 50 行
讨论：30 行 vs 50 行
- 30 行：eval pass_rate 0.72（部分合理的长函数被误报）
- 50 行：eval pass_rate 0.85（覆盖了真正需要拆分的情况）
结论：50 行是更务实的阈值。真正需要强制拆分的函数通常超过 50 行。
```

决策记录不是做给领导看的。它让半年后有人问"为什么是 50 行不是 30 行"的时候，不需要再吵一次。

## Skill Review Checklist

每次 Skill 的 PR，Owner 按这个 checklist 过一遍。

| 维度 | 检查项 | 通过标准 |
|------|--------|---------|
| 结构 | frontmatter 字段合法 | name、description 必填，无未知字段 |
| 结构 | name 使用 kebab-case | 无大写字母、无空格、无下划线 |
| 结构 | description 不超过 250 字符 | 关键信息前置，触发场景明确 |
| 内容 | 指令使用祈使句 | 写"检查错误处理"，不写"你应该检查错误处理" |
| 内容 | 每条指令附带 why | 没有孤立的命令，每条规则都解释了原因 |
| 内容 | 无全大写命令词 | 不用 MUST、NEVER、ALWAYS，用正常语气 |
| 质量 | evals.json 存在 | 至少包含 2 个测试用例 |
| 质量 | pass_rate 不低于 baseline | 新版本不能让通过率退化 |
| 安全 | allowed-tools 最小权限 | 只授权 Skill 实际需要的工具 |
| 安全 | 无敏感信息硬编码 | 无 API key、密码、token |
| 性能 | SKILL.md body 不超过 500 行 | 超过就该拆分 |
| 性能 | 支撑文件按需加载 | 非必需的文件不内置在 references/ 中 |

这个 checklist 不需要每条都手动检查。前几项可以写个脚本自动验证：

```bash
#!/bin/bash
# quick_validate.sh - Skill 结构快速检查
SKILL_DIR=$1
SKILL_MD="$SKILL_DIR/SKILL.md"

# 检查 SKILL.md 存在
[ -f "$SKILL_MD" ] || { echo "FAIL: SKILL.md not found"; exit 1; }

# 检查 name 字段
NAME=$(grep "^name:" "$SKILL_MD" | head -1 | awk '{print $2}')
echo "$NAME" | grep -qE '^[a-z][a-z0-9-]*$' || { echo "FAIL: name not kebab-case: $NAME"; exit 1; }

# 检查 description 长度
DESC_LEN=$(grep "^description:" "$SKILL_MD" | head -1 | sed 's/^description: *//' | wc -c)
[ "$DESC_LEN" -le 250 ] || { echo "FAIL: description too long: $DESC_LEN chars"; exit 1; }

# 检查 body 行数
BODY_LINES=$(sed -n '/^---$/,/^---$/d; p' "$SKILL_MD" | wc -l)
[ "$BODY_LINES" -le 500 ] || { echo "WARN: body too long: $BODY_LINES lines"; }

# 检查敏感信息
grep -rqiE '(api[_-]?key|password|secret|token)\s*[:=]' "$SKILL_DIR" && { echo "FAIL: possible sensitive data"; exit 1; }

# 检查 evals.json
[ -f "$SKILL_DIR/evals.json" ] || { echo "WARN: evals.json not found"; }

echo "PASS: basic validation passed"
```

把这个脚本放在 repo 里，CI 里调一下，PR 创建时自动跑。

## 实操建议

别一上来就搞全套流程。按团队大小分步走：

**2-3 人的小团队**：每个 Skill 有个 Owner，改 Skill 要跑 eval，其他的口头约定就够了。

**5-10 人的团队**：加上 PR review 流程和 checklist，CI 里跑自动验证。

**10 人以上的团队**：考虑加入 Skill 的变更日志（CHANGELOG.md），大变更发团队公告，新人入职时安排 Skill 知识库的 onboarding。

流程是为了减少摩擦，不是制造摩擦。如果你的团队只有三个人，搞一套复杂的审批流程只会让大家懒得改 Skill，最后 Skill 就烂在那里了。
