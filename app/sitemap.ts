import type { MetadataRoute } from 'next';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-static';

const SITE_URL = 'https://inferloop.dev';
const CONTENT_DIR = path.resolve(process.cwd(), 'content');

type Entry = MetadataRoute.Sitemap[number];

function walkContent(dir: string, base = ''): Entry[] {
  if (!fs.existsSync(dir)) return [];
  const out: Entry[] = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    if (item.name.startsWith('.') || item.name.startsWith('_')) continue;

    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      out.push(...walkContent(fullPath, path.posix.join(base, item.name)));
      continue;
    }

    if (!/\.(md|mdx)$/.test(item.name)) continue;

    let slug = item.name.replace(/\.(md|mdx)$/, '');
    let urlPath: string;

    if (slug === 'index') {
      urlPath = base ? `/${base}` : '/';
    } else {
      urlPath = base ? `/${base}/${slug}` : `/${slug}`;
    }

    let lastModified: Date | undefined;
    try {
      lastModified = fs.statSync(fullPath).mtime;
    } catch {
      lastModified = undefined;
    }

    const isHome = urlPath === '/';
    const isBookIndex = !isHome && /^\/[^/]+$/.test(urlPath);

    out.push({
      url: `${SITE_URL}${urlPath === '/' ? '' : urlPath}`,
      lastModified,
      changeFrequency: isHome ? 'weekly' : isBookIndex ? 'weekly' : 'monthly',
      priority: isHome ? 1.0 : isBookIndex ? 0.9 : 0.7,
    });
  }
  return out;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const entries = walkContent(CONTENT_DIR);
  // 兜底：确保根存在
  if (!entries.find((e) => e.url === SITE_URL)) {
    entries.unshift({
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    });
  }
  return entries;
}
