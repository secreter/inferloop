/**
 * sync-from-books.ts
 *
 * 从 workspace 中各书籍项目同步 Markdown 内容到站点 content 目录。
 * 处理：
 * 1. 复制 Markdown 文件并移除 frontmatter
 * 2. 自动生成 _meta.ts
 *
 * 支持两种书籍目录结构（见 BOOK_CONVENTION.md）：
 * - flat   默认，章节是 NN-name/README.md 或 NN-name.md
 * - sections  两层，小节目录 NN-section/ 下含平铺 NN-chapter.md 文件
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
  sections?: boolean;
  // recursive: 三层结构，section-dir/chapter-dir/README.md
  // 只递归进匹配 chapterPattern 但无 README.md 的目录（section 层）
  recursive?: boolean;
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
    chapterPattern: /^\d{2}-/,
    sections: true,
    indexContent: `# Claude Code Skill 开发指南

掌握 Claude Code Skill 开发，构建可复用的 AI 工程能力模块。
`,
  },
  {
    sourceDir: 'claude-plugins-official-guide',
    targetDir: 'claude-plugins',
    chaptersPath: '.',
    chapterPattern: /^\d{2}-/,
    sections: true,
    indexContent: `# Claude 插件官方指南

从开发工具到专业领域，系统掌握 Claude 插件生态。
`,
  },
  {
    sourceDir: 'ling-agent',
    targetDir: 'ling-agent',
    chaptersPath: 'book',
    chapterPattern: /^\d+-/,
    indexContent: `# 自己动手写 AI Agent

从 Claude Code 开源架构到你的第一个编程助手。

全书以 Ling（灵）这个从零构建的 AI 编程助手为主线，覆盖 Agent 运行时、工具系统、MCP 协议、多 Agent 协作等核心主题。
`,
  },
  {
    sourceDir: 'repox',
    targetDir: 'repox',
    chaptersPath: 'docs',
    chapterPattern: /^chapter-\d+/,
    indexContent: `# AI 时代的 CLI 工具开发实战

以 repox 这个 AI 驱动的仓库助手为案例，系统讲解如何用 TypeScript 构建一个现代 CLI 工具。

涵盖命令设计、插件系统、AI 集成、GitHub OAuth、发布与分发等完整工程链路。
`,
  },
  {
    sourceDir: 'book-claude-mem',
    targetDir: 'claude-mem',
    chaptersPath: '.',
    chapterPattern: /^(ch\d+|\d{2})-/,
    recursive: true,
    indexContent: `# Agent Memory 工程实战

从 claude-mem 源码到企业级记忆平台。

深入解析 Agent 记忆系统的工程实现：Hook 生命周期、Worker 服务、MCP Search、渐进式披露机制，以及从单机到企业级的演进路径。
`,
  },
  {
    sourceDir: 'transformer-book',
    targetDir: 'transformer',
    chaptersPath: '.',
    chapterPattern: /^\d+-/,
    indexContent: `# Transformer 工程实战

面向有工程背景、希望转型 AI 方向的工程师。

从词向量到注意力机制，从 Transformer 架构到 HuggingFace 实战，再到微调、推理、RAG，用工程师的方式讲清楚 AI 基础设施的核心原理。
`,
  },
];

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function removeFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) return content.slice(fmMatch[0].length);
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

// "ch01-overview" → "overview"，"01-cognition" → "cognition"，"chapter-01" → "chapter-01"（不变）
function stripNumericPrefix(slug: string): string {
  const stripped = slug.replace(/^(ch\d+|\d+)-/, '');
  return stripped || slug;
}

// 剥除各种"第X章"前缀变体，保证每本书侧边栏标题风格一致
// 处理: "第2章 "、"第 8 章 · "、"第 10 章 — "、"第 1 章："等
function normalizeChapterTitle(title: string): string {
  return title.replace(/^第\s*\d+\s*章\s*[·:：—\-]*\s*/, '').trim() || title;
}

// "01-cognition" → "Cognition"，"01-dev-tools" → "Dev Tools"
function dirToTitle(dirName: string): string {
  const stripped = stripNumericPrefix(dirName);
  if (/[一-龥]/.test(stripped)) return stripped;
  return stripped.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function generateMetaTs(
  entries: Array<{ slug: string; title: string }>,
  withIndex = true
): string {
  const lines = ["export default {"];
  if (withIndex) lines.push("  index: { title: '简介', display: 'hidden' },");
  for (const e of entries) {
    const escaped = e.title.replace(/'/g, "\\'");
    lines.push(`  '${e.slug}': '${escaped}',`);
  }
  lines.push('};\n');
  return lines.join('\n');
}

// 递归收集所有章节目录（匹配 pattern 且有 README.md）
// 只递归进「匹配 pattern 但无 README.md」的目录（section 层），其余目录跳过
function collectChapterDirs(
  dir: string,
  pattern: RegExp
): Array<{ fullPath: string; name: string }> {
  if (!fs.existsSync(dir)) return [];
  const results: Array<{ fullPath: string; name: string }> = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (!pattern.test(entry.name)) continue; // examples / assets / appendix 等不处理
    if (fs.existsSync(path.join(fullPath, 'README.md'))) {
      results.push({ fullPath, name: entry.name });
    } else {
      results.push(...collectChapterDirs(fullPath, pattern)); // section 层，递归
    }
  }
  return results;
}

// ─── flat 模式（默认）：NN-name/README.md 或 NN-name.md ─────────────────────

function syncBookFlat(config: BookConfig): void {
  const sourceBase = path.join(WORKSPACE, config.sourceDir);
  const targetBase = path.join(CONTENT_DIR, config.targetDir);

  if (!fs.existsSync(sourceBase)) {
    console.log(`  [SKIP] ${config.sourceDir} not found`);
    return;
  }

  fs.mkdirSync(targetBase, { recursive: true });
  fs.writeFileSync(path.join(targetBase, 'index.md'), config.indexContent, 'utf-8');

  const chaptersDir = path.join(sourceBase, config.chaptersPath);
  if (!fs.existsSync(chaptersDir)) {
    console.log(`  [SKIP] chapters dir not found: ${chaptersDir}`);
    return;
  }

  // recursive 模式：跨多层收集章节目录
  if (config.recursive) {
    const chapterDirs = collectChapterDirs(chaptersDir, config.chapterPattern);
    const chapters: Array<{ slug: string; title: string }> = [];
    for (const { fullPath, name } of chapterDirs) {
      const readmePath = path.join(fullPath, 'README.md');
      const mdContent = fs.readFileSync(readmePath, 'utf-8');
      const slug = stripNumericPrefix(name);
      const title = normalizeChapterTitle(extractTitleFromContent(mdContent) || slug);
      const processed = processMarkdown(mdContent);
      fs.writeFileSync(path.join(targetBase, `${slug}.md`), processed, 'utf-8');
      chapters.push({ slug, title });
      console.log(`  [SYNC] ${slug}`);
    }
    fs.writeFileSync(path.join(targetBase, '_meta.ts'), generateMetaTs(chapters), 'utf-8');
    console.log(`  [META] _meta.ts (${chapters.length} chapters)`);
    return;
  }

  const entries = fs.readdirSync(chaptersDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const chapters: Array<{ slug: string; title: string }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    let mdContent: string | null = null;
    let slug = '';

    if (entry.isDirectory() && config.chapterPattern.test(entry.name)) {
      const readmePath = path.join(chaptersDir, entry.name, 'README.md');
      if (fs.existsSync(readmePath)) {
        mdContent = fs.readFileSync(readmePath, 'utf-8');
        slug = stripNumericPrefix(entry.name);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md') && config.chapterPattern.test(entry.name)) {
      mdContent = fs.readFileSync(path.join(chaptersDir, entry.name), 'utf-8');
      slug = stripNumericPrefix(entry.name.replace('.md', ''));
    }

    if (mdContent && slug) {
      const title = normalizeChapterTitle(extractTitleFromContent(mdContent) || slug);
      const processed = processMarkdown(mdContent);
      fs.writeFileSync(path.join(targetBase, `${slug}.md`), processed, 'utf-8');
      chapters.push({ slug, title });
      console.log(`  [SYNC] ${slug}`);
    }
  }

  fs.writeFileSync(path.join(targetBase, '_meta.ts'), generateMetaTs(chapters), 'utf-8');
  console.log(`  [META] _meta.ts (${chapters.length} chapters)`);
}

// ─── sections 模式：NN-section/ 下含平铺 NN-chapter.md ──────────────────────

function syncBookSections(config: BookConfig): void {
  const sourceBase = path.join(WORKSPACE, config.sourceDir);
  const targetBase = path.join(CONTENT_DIR, config.targetDir);

  if (!fs.existsSync(sourceBase)) {
    console.log(`  [SKIP] ${config.sourceDir} not found`);
    return;
  }

  fs.mkdirSync(targetBase, { recursive: true });
  fs.writeFileSync(path.join(targetBase, 'index.md'), config.indexContent, 'utf-8');

  const chaptersDir = path.join(sourceBase, config.chaptersPath);
  if (!fs.existsSync(chaptersDir)) {
    console.log(`  [SKIP] chapters dir not found: ${chaptersDir}`);
    return;
  }

  const sectionEntries = fs.readdirSync(chaptersDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && config.chapterPattern.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const topSections: Array<{ slug: string; title: string }> = [];

  for (const section of sectionEntries) {
    const sectionTitle = dirToTitle(section.name);
    const sectionSlug = stripNumericPrefix(section.name);
    const sourceSectionDir = path.join(chaptersDir, section.name);
    const targetSectionDir = path.join(targetBase, sectionSlug);

    fs.mkdirSync(targetSectionDir, { recursive: true });

    const files = fs.readdirSync(sourceSectionDir, { withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith('.md') && !f.name.startsWith('_'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const chapterMetas: Array<{ slug: string; title: string }> = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(sourceSectionDir, file.name), 'utf-8');
      const title = normalizeChapterTitle(extractTitleFromContent(content) || file.name.replace('.md', ''));
      const processed = processMarkdown(content);
      const slug = stripNumericPrefix(file.name.replace('.md', ''));

      fs.writeFileSync(path.join(targetSectionDir, `${slug}.md`), processed, 'utf-8');
      chapterMetas.push({ slug, title });
      console.log(`  [SYNC] ${sectionSlug}/${slug}`);
    }

    fs.writeFileSync(
      path.join(targetSectionDir, '_meta.ts'),
      generateMetaTs(chapterMetas, false),
      'utf-8'
    );

    topSections.push({ slug: sectionSlug, title: sectionTitle });
  }

  fs.writeFileSync(path.join(targetBase, '_meta.ts'), generateMetaTs(topSections), 'utf-8');
  console.log(`  [META] _meta.ts (${topSections.length} sections)`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

console.log('Syncing books to site content...\n');

for (const book of BOOKS) {
  console.log(`[${book.sourceDir}] → content/${book.targetDir}/`);
  if (book.sections) {
    syncBookSections(book);
  } else {
    syncBookFlat(book); // recursive 分支在 syncBookFlat 内部处理
  }
  console.log('');
}

console.log('Done!');
