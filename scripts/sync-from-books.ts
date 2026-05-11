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
const PUBLIC_DIR = path.resolve(__dirname, '../public');

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
  // prefacePath: 书的前言文件，相对 sourceDir 的路径。
  // 如果设置且文件存在，前言内容会覆盖 index.md（替代 indexContent），
  // 让"点击书封面 → 进入根目录"直接看到前言而不是几句空泛简介。
  prefacePath?: string;
}

const BOOKS: BookConfig[] = [
  {
    sourceDir: 'llm-infra-book',
    targetDir: 'llm-infra',
    chaptersPath: 'chapters',
    chapterPattern: /^ch\d+-/,
    prefacePath: 'chapters/preface/README.md',
    indexContent: `# LLM Infra 工程实战

面向应用层工程师的 LLM 基础设施系统化学习书籍。
`,
  },
  {
    sourceDir: 'book-hermes-agent',
    targetDir: 'hermes-agent',
    chaptersPath: 'book',
    chapterPattern: /^\d+-/,
    prefacePath: 'book/00-preface.md',
    indexContent: `# Hermes Agent 源码解读

解剖式技术书 — 帮助工程师快速理解 Agent 架构设计。
`,
  },
  {
    sourceDir: 'book-openclaw',
    targetDir: 'openclaw',
    chaptersPath: 'chapters',
    chapterPattern: /^ch\d+-/,
    prefacePath: 'chapters/ch00-preface/README.md',
    indexContent: `# OpenClaw 源码解析

现代 Agent 系统的架构设计与工程实践。
`,
  },
  {
    sourceDir: 'skill-guide',
    targetDir: 'claude-skill',
    chaptersPath: 'book',
    chapterPattern: /^\d{2}-/,
    sections: true,
    prefacePath: 'book/00-preface.md',
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
    prefacePath: '00-preface/01-intro.md',
    indexContent: `# Claude 插件官方指南

从开发工具到专业领域，系统掌握 Claude 插件生态。
`,
  },
  {
    sourceDir: 'ling-agent',
    targetDir: 'ling-agent',
    chaptersPath: 'book',
    chapterPattern: /^\d+-/,
    prefacePath: 'book/00-preface/README.md',
    indexContent: `# 自己动手写 AI Agent

从 Claude Code 开源架构到你的第一个编程助手。
`,
  },
  {
    sourceDir: 'repox',
    targetDir: 'repox',
    chaptersPath: 'docs',
    chapterPattern: /^chapter-\d+/,
    prefacePath: 'docs/preface.md',
    indexContent: `# AI 时代的 CLI 工具开发实战

以 repox 这个 AI 驱动的仓库助手为案例，系统讲解如何用 TypeScript 构建一个现代 CLI 工具。
`,
  },
  {
    sourceDir: 'book-claude-mem',
    targetDir: 'claude-mem',
    chaptersPath: '.',
    chapterPattern: /^(ch\d+|\d{2})-/,
    recursive: true,
    prefacePath: '00-preface/README.md',
    indexContent: `# Agent Memory 工程实战

从 claude-mem 源码到企业级记忆平台。
`,
  },
  {
    sourceDir: 'transformer-book',
    targetDir: 'transformer',
    chaptersPath: '.',
    chapterPattern: /^\d+-/,
    prefacePath: 'preface/README.md',
    indexContent: `# Transformer 工程实战

面向有工程背景、希望转型 AI 方向的工程师。
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

function rewriteAssetPaths(content: string, publicBase: string): string {
  return content.replace(/!\[([^\]]*)\]\(assets\/([^)]+)\)/g, (_, alt, filename) => {
    return `![${alt}](${publicBase}/${filename})`;
  });
}

function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    if (f.isFile()) {
      fs.copyFileSync(path.join(src, f.name), path.join(dest, f.name));
    }
  }
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
  entries: Array<{ slug: string; title: string; hidden?: boolean }>,
  withIndex = true
): string {
  const lines = ["export default {"];
  if (withIndex) lines.push("  index: { title: '简介', display: 'hidden' },");
  for (const e of entries) {
    const escaped = e.title.replace(/'/g, "\\'");
    if (e.hidden) {
      lines.push(`  '${e.slug}': { title: '${escaped}', display: 'hidden' },`);
    } else {
      lines.push(`  '${e.slug}': '${escaped}',`);
    }
  }
  lines.push('};\n');
  return lines.join('\n');
}

// 读取 sourceDir 下的前言文件，剥掉 frontmatter，并保证开头有 h1 让站点页面标题正确。
// 找不到返回 null。
function readPreface(sourceBase: string, prefacePath?: string): string | null {
  if (!prefacePath) return null;
  const full = path.join(sourceBase, prefacePath);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf-8');
  const body = processMarkdown(raw).replace(/^\s+/, '');
  // 前言没有 h1 时补一个，避免站点 <title> 退化为 "Index"
  if (!/^#\s/m.test(body.split('\n')[0] || '')) {
    return `# 前言\n\n${body}`;
  }
  return body;
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

  // 解析前言：有前言时用前言内容覆盖 index.md（书的根目录），
  // 让"点击书封面 → 进入根目录"直接看到前言。
  const prefaceContent = readPreface(sourceBase, config.prefacePath);
  const indexBody = prefaceContent ?? config.indexContent;
  fs.writeFileSync(path.join(targetBase, 'index.md'), indexBody, 'utf-8');
  if (prefaceContent) console.log(`  [PREFACE] index.md ← ${config.prefacePath}`);

  const chaptersDir = path.join(sourceBase, config.chaptersPath);
  if (!fs.existsSync(chaptersDir)) {
    console.log(`  [SKIP] chapters dir not found: ${chaptersDir}`);
    return;
  }

  // recursive 模式：跨多层收集章节目录
  if (config.recursive) {
    const chapterDirs = collectChapterDirs(chaptersDir, config.chapterPattern);
    const chapters: Array<{ slug: string; title: string; hidden?: boolean }> = [];
    for (const { fullPath, name } of chapterDirs) {
      const readmePath = path.join(fullPath, 'README.md');
      const mdContent = fs.readFileSync(readmePath, 'utf-8');
      const slug = stripNumericPrefix(name);
      const title = normalizeChapterTitle(extractTitleFromContent(mdContent) || slug);
      let processed = processMarkdown(mdContent);
      const assetsDir = path.join(fullPath, 'assets');
      if (fs.existsSync(assetsDir)) {
        const publicBase = `/books/${config.targetDir}/${slug}`;
        copyDir(assetsDir, path.join(PUBLIC_DIR, 'books', config.targetDir, slug));
        processed = rewriteAssetPaths(processed, publicBase);
      }
      fs.writeFileSync(path.join(targetBase, `${slug}.md`), processed, 'utf-8');
      // 前言已合并到 index.md，从侧边栏隐藏，避免根目录与"前言"重复入口
      const hidden = prefaceContent != null && slug === 'preface';
      chapters.push({ slug, title, hidden });
      console.log(`  [SYNC] ${slug}${hidden ? ' (hidden in sidebar)' : ''}`);
    }
    fs.writeFileSync(path.join(targetBase, '_meta.ts'), generateMetaTs(chapters), 'utf-8');
    console.log(`  [META] _meta.ts (${chapters.length} chapters)`);
    return;
  }

  const entries = fs.readdirSync(chaptersDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const chapters: Array<{ slug: string; title: string; hidden?: boolean }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    let mdContent: string | null = null;
    let slug = '';

    let assetsSourceDir: string | null = null;

    if (entry.isDirectory() && config.chapterPattern.test(entry.name)) {
      const readmePath = path.join(chaptersDir, entry.name, 'README.md');
      if (fs.existsSync(readmePath)) {
        mdContent = fs.readFileSync(readmePath, 'utf-8');
        slug = stripNumericPrefix(entry.name);
        assetsSourceDir = path.join(chaptersDir, entry.name, 'assets');
      }
    } else if (entry.isFile() && entry.name.endsWith('.md') && config.chapterPattern.test(entry.name)) {
      mdContent = fs.readFileSync(path.join(chaptersDir, entry.name), 'utf-8');
      slug = stripNumericPrefix(entry.name.replace('.md', ''));
    }

    if (mdContent && slug) {
      const title = normalizeChapterTitle(extractTitleFromContent(mdContent) || slug);
      let processed = processMarkdown(mdContent);
      if (assetsSourceDir && fs.existsSync(assetsSourceDir)) {
        const publicBase = `/books/${config.targetDir}/${slug}`;
        copyDir(assetsSourceDir, path.join(PUBLIC_DIR, 'books', config.targetDir, slug));
        processed = rewriteAssetPaths(processed, publicBase);
      }
      fs.writeFileSync(path.join(targetBase, `${slug}.md`), processed, 'utf-8');
      // 前言已合并到 index.md，从侧边栏隐藏，避免根目录与"前言"重复入口
      const hidden = prefaceContent != null && slug === 'preface';
      chapters.push({ slug, title, hidden });
      console.log(`  [SYNC] ${slug}${hidden ? ' (hidden in sidebar)' : ''}`);
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

  // 前言：用前言内容覆盖 index.md，让点击书封面直接看到前言
  const prefaceContent = readPreface(sourceBase, config.prefacePath);
  const indexBody = prefaceContent ?? config.indexContent;
  fs.writeFileSync(path.join(targetBase, 'index.md'), indexBody, 'utf-8');
  if (prefaceContent) console.log(`  [PREFACE] index.md ← ${config.prefacePath}`);

  const chaptersDir = path.join(sourceBase, config.chaptersPath);
  if (!fs.existsSync(chaptersDir)) {
    console.log(`  [SKIP] chapters dir not found: ${chaptersDir}`);
    return;
  }

  const sectionEntries = fs.readdirSync(chaptersDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && config.chapterPattern.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const topSections: Array<{ slug: string; title: string; hidden?: boolean }> = [];

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

    // 加 hidden index：避免 section 自己生成的 index.md 同时作为
    // section 文件夹标题和子章节首项出现（造成名称重复 + 双高亮）。
    fs.writeFileSync(
      path.join(targetSectionDir, '_meta.ts'),
      generateMetaTs(chapterMetas, true),
      'utf-8'
    );

    // 前言 section 已合并到 index.md，从侧边栏隐藏
    const hidden = prefaceContent != null && sectionSlug === 'preface';
    topSections.push({ slug: sectionSlug, title: sectionTitle, hidden });
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
