/**
 * sync-from-books.ts
 *
 * 从 workspace 中各书籍项目同步 Markdown 内容到站点 content 目录。
 * 处理：
 * 1. 复制 Markdown 文件并重命名为 .mdx
 * 2. 移除 frontmatter 中的飞书专用字段
 * 3. 自动生成 _meta.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const WORKSPACE = path.resolve(__dirname, '../../');
const CONTENT_DIR = path.resolve(__dirname, '../content');

interface BookConfig {
  sourceDir: string;
  targetDir: string;
  chaptersPath: string;
  chapterPattern: RegExp;
  indexContent: string;
}

const BOOKS: BookConfig[] = [
  {
    sourceDir: 'llm-infra-book',
    targetDir: 'llm-infra',
    chaptersPath: 'chapters',
    chapterPattern: /^ch\d+-/,
    indexContent: `# LLM Infra 工程实战

面向应用层工程师的 LLM 基础设施系统化学习书籍。

## 这本书解决什么问题

你是一个有经验的后端/全栈工程师，日常调用 OpenAI API 没问题，但想深入理解模型推理、量化、微调、分布式训练和生产部署背后的工程细节。

这本书从零开始，用工程师能理解的方式讲清楚这些问题。

## 前置要求

- 会 Python（不需要精通，会读写就行）
- 了解基本的 HTTP/API 概念
- 有 Linux 命令行经验
- 不需要机器学习背景，书里会从头讲
`,
  },
  {
    sourceDir: 'book-hermes-agent',
    targetDir: 'hermes-agent',
    chaptersPath: 'book',
    chapterPattern: /^\d+-/,
    indexContent: `# Hermes Agent 源码解读

解剖式技术书 — 帮助工程师快速理解 Agent 架构设计。

通过逐层拆解 Hermes Agent 的源码，掌握 Agent 运行时、Skill 系统、消息网关的核心实现。
`,
  },
  {
    sourceDir: 'book-openclaw',
    targetDir: 'openclaw',
    chaptersPath: 'chapters',
    chapterPattern: /^ch\d+-/,
    indexContent: `# OpenClaw 源码解析

现代 Agent 系统的架构设计与工程实践。

本书正在编写中，持续更新。
`,
  },
  {
    sourceDir: 'skill-guide',
    targetDir: 'claude-skill',
    chaptersPath: 'book',
    chapterPattern: /^\d+-/,
    indexContent: `# Claude Code Skill 开发指南

掌握 Claude Code Skill 开发，构建可复用的 AI 工程能力模块。
`,
  },
  {
    sourceDir: 'claude-plugins-official-guide',
    targetDir: 'claude-plugins',
    chaptersPath: '.',
    chapterPattern: /^\d+-/,
    indexContent: `# Claude 插件官方指南

从开发工具到专业领域，系统掌握 Claude 插件生态。
`,
  },
];

function removeFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    return content.slice(fmMatch[0].length);
  }
  return content;
}

function extractTitleFromContent(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return titleMatch[1].trim();
  }
  const h1Match = content.match(/^#\s+(.+)/m);
  if (h1Match) return h1Match[1].trim();
  return '';
}

function processMarkdown(content: string): string {
  return removeFrontmatter(content);
}

function generateMetaJson(
  chapters: Array<{ slug: string; title: string }>
): string {
  const obj: Record<string, string> = { index: '简介' };
  for (const ch of chapters) {
    obj[ch.slug] = ch.title;
  }
  return JSON.stringify(obj, null, 2) + '\n';
}

function syncBook(config: BookConfig): void {
  const sourceBase = path.join(WORKSPACE, config.sourceDir);
  const targetBase = path.join(CONTENT_DIR, config.targetDir);

  if (!fs.existsSync(sourceBase)) {
    console.log(`  [SKIP] ${config.sourceDir} not found`);
    return;
  }

  // 确保目标目录存在
  fs.mkdirSync(targetBase, { recursive: true });

  // 写入 index.md
  fs.writeFileSync(
    path.join(targetBase, 'index.md'),
    config.indexContent,
    'utf-8'
  );

  const chaptersDir = path.join(sourceBase, config.chaptersPath);
  if (!fs.existsSync(chaptersDir)) {
    console.log(`  [SKIP] chapters dir not found: ${chaptersDir}`);
    return;
  }

  const entries = fs.readdirSync(chaptersDir, { withFileTypes: true });
  const chapters: Array<{ slug: string; title: string }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    let mdContent: string | null = null;
    let slug = '';

    if (entry.isDirectory() && config.chapterPattern.test(entry.name)) {
      const readmePath = path.join(chaptersDir, entry.name, 'README.md');
      if (fs.existsSync(readmePath)) {
        mdContent = fs.readFileSync(readmePath, 'utf-8');
        slug = entry.name;
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      config.chapterPattern.test(entry.name)
    ) {
      mdContent = fs.readFileSync(
        path.join(chaptersDir, entry.name),
        'utf-8'
      );
      slug = entry.name.replace('.md', '');
    }

    if (mdContent && slug) {
      const title = extractTitleFromContent(mdContent) || slug;
      const processed = processMarkdown(mdContent);
      const targetPath = path.join(targetBase, `${slug}.md`);

      fs.writeFileSync(targetPath, processed, 'utf-8');
      chapters.push({ slug, title });
      console.log(`  [SYNC] ${slug}`);
    }
  }

  // 生成 _meta.json
  const metaPath = path.join(targetBase, '_meta.json');
  fs.writeFileSync(metaPath, generateMetaJson(chapters), 'utf-8');
  console.log(`  [META] _meta.json (${chapters.length} chapters)`);
}

// Main
console.log('Syncing books to site content...\n');

for (const book of BOOKS) {
  console.log(`[${book.sourceDir}] → content/${book.targetDir}/`);
  syncBook(book);
  console.log('');
}

console.log('Done!');
