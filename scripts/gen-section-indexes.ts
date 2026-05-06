/**
 * 为每个 content/<book>/<section>/ 目录补一个 index.md（如果缺失）。
 * 内容来源：该目录下的 _meta.ts，列出章节链接。
 * 解决：访问 /book/section 这类 folder 路径时 404 的问题。
 */
import fs from 'node:fs';
import path from 'node:path';

const CONTENT = path.resolve(process.cwd(), 'content');

function listDirs(p: string): string[] {
  return fs.readdirSync(p, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

async function loadMeta(metaPath: string): Promise<Record<string, any> | null> {
  if (!fs.existsSync(metaPath)) return null;
  const raw = fs.readFileSync(metaPath, 'utf8');
  // 极简解析：把 export default {...}; 提取出来 eval —— meta 都是简单字面量
  const m = raw.match(/export\s+default\s+(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) return null;
  try {
    // eslint-disable-next-line no-new-func
    const obj = Function(`"use strict";return (${m[1]})`)();
    return obj;
  } catch {
    return null;
  }
}

function entryTitle(slug: string, value: any): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.title === 'string') return value.title;
  return slug;
}

function isHidden(value: any): boolean {
  return value && typeof value === 'object' && value.display === 'hidden';
}

async function main() {
  const books = listDirs(CONTENT);
  let created = 0;
  for (const book of books) {
    const bookDir = path.join(CONTENT, book);
    const stat = fs.statSync(bookDir);
    if (!stat.isDirectory()) continue;

    const sections = listDirs(bookDir);
    for (const section of sections) {
      const secDir = path.join(bookDir, section);
      const idxMd = path.join(secDir, 'index.md');
      const idxMdx = path.join(secDir, 'index.mdx');
      if (fs.existsSync(idxMd) || fs.existsSync(idxMdx)) continue;

      const meta = await loadMeta(path.join(secDir, '_meta.ts'));
      const sectionTitle = entryTitle(section, null)
        .replace(/^[a-z]/, (c) => c.toUpperCase())
        .replace(/-/g, ' ');

      let body = `# ${sectionTitle}\n\n本章节包含以下内容：\n\n`;
      if (meta) {
        for (const [key, value] of Object.entries(meta)) {
          if (key === 'index' || isHidden(value)) continue;
          const title = entryTitle(key, value);
          body += `- [${title}](/${book}/${section}/${key})\n`;
        }
      }
      body += '\n';

      fs.writeFileSync(idxMd, body, 'utf8');
      created += 1;
      console.log(`created: content/${book}/${section}/index.md`);
    }
  }
  console.log(`\nDone. created ${created} index.md files.`);
}

main();
