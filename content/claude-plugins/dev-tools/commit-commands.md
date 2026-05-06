# commit-commands：Git 工作流一键化

三个 slash command 覆盖日常 git 操作：`/commit` 自动提交，`/commit-push-pr` 一步到 PR，`/clean_gone` 清理过期本地分支。

## 技术原理

三个 command 都在 `commands/` 目录下，用的是旧格式（非 skills/ 目录），但加载机制完全一样。

### /commit

这个命令的设计很精炼。frontmatter 里 `allowed-tools` 只开了三个权限：

```yaml
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
```

注意这里用了 Bash 的 glob 授权语法——`Bash(git add:*)` 表示允许执行所有以 `git add` 开头的 bash 命令。这意味着 Claude 不能执行 `rm`、`npm` 或者其他任何非 git 命令，安全边界很清晰。

命令正文用了 `!` 反引号语法注入动态上下文：

```markdown
- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`
```

`!` 反引号是 Claude Code 的动态上下文注入机制。在 skill/command 加载时，`!`command`` 里的命令会先执行，输出替换到文档里，Claude 看到的是执行结果而不是命令本身。这意味着 Claude 拿到 command 的时候，已经知道当前的 git 状态、diff 内容、分支名和最近 10 条 commit message。

拿到这些上下文后，Claude 的指令是：分析变更内容，创建一次 commit。指令里特别强调"一轮完成"——stage 和 commit 放在同一个回合的工具调用里。

### /commit-push-pr

权限更多，加了 `git push`、`git checkout --branch`、`gh pr create`：

```yaml
allowed-tools: Bash(git checkout --branch:*), Bash(git add:*), Bash(git status:*), Bash(git push:*), Bash(git commit:*), Bash(gh pr create:*)
```

流程：如果当前在 main 分支，先创建新分支；提交变更；push 到 origin；用 GitHub CLI 创建 PR。全部在一轮工具调用里完成。

### /clean_gone

这个命令处理一个实际痛点：PR 合并后远程分支被删了，但本地分支还在。脚本逻辑是：

1. `git branch -v` 列出所有本地分支，找带 `[gone]` 标记的
2. `git worktree list` 检查有没有关联的 worktree
3. 对每个 [gone] 分支，先删 worktree 再删分支

worktree 处理这步很多人会忽略。如果用了 `git worktree` 做多分支并行开发，直接 `git branch -D` 会失败，必须先 `git worktree remove`。

## 安装与配置

```bash
/plugin install commit-commands@claude-plugins-official
```

`/commit-push-pr` 需要 GitHub CLI：

```bash
# macOS
brew install gh
gh auth login

# 其他系统参考 https://cli.github.com/
```

## 使用方法

```
/commit
```

改完代码直接打这个。Claude 分析 diff，自动 stage 相关文件，生成 commit message，提交。

```
/commit-push-pr
```

功能完成了，一步到位——commit、push、开 PR。PR 描述会包含变更摘要和测试计划。

```
/clean_gone
```

PR 合了一堆之后跑一次，清理本地过期分支。

## 使用场景

**日常开发的 commit 节奏**。改了几个文件，不想手写 commit message，`/commit` 搞定。Claude 会看最近的 commit 历史来匹配风格——如果你之前用 conventional commit（`feat:`, `fix:`），它生成的 message 也会遵循这个格式。

**功能完成后的最后一公里**。代码写完了，测试过了，下一步就是提 PR。`/commit-push-pr` 省掉了 `git checkout -b feature/xxx` + `git add .` + `git commit` + `git push -u origin feature/xxx` + 去 GitHub 页面写 PR 描述这一串操作。特别是 PR 描述——它会分析分支上的所有 commit（不只是最后一次），生成 summary 和 test plan。

**多分支开发后的清理**。同时开了五六个 feature 分支，PR 陆续合并后本地 `git branch` 列表越来越长。`/clean_gone` 一次性清掉。如果你用了 worktree，它也能正确处理。

## 局限与注意事项

- `/commit` 会自动 stage 文件。如果你只想提交部分文件，先手动 `git add` 想要的文件，再跑 `/commit`——它会看到已 stage 的内容并据此操作
- commit message 里会带 Claude Code 的署名（`Co-Authored-By: Claude...`）。这是 Claude Code 的默认行为，不是这个插件加的
- `/commit-push-pr` 检测到当前在 main 分支时会自动建分支，但分支命名是 Claude 自己取的，你无法提前指定。如果在意分支名，先自己 `git checkout -b` 再跑命令
- `/clean_gone` 执行前需要先 `git fetch --prune`，否则远程已删除的分支在本地不会标记为 [gone]。命令本身不会帮你 fetch
- 三个命令都不会 `git push --force`、`git reset --hard` 这类破坏性操作，设计上比较安全。但 `/clean_gone` 的 `git branch -D` 是强制删除，不会检查分支上有没有未合并的本地 commit
