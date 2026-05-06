import type { Metadata } from 'next';
import { generateStaticParamsFor, importPage } from 'nextra/pages';
import { useMDXComponents } from '@/mdx-components';
import { BOOKS, getBookBySlug } from '@/lib/books';

export const generateStaticParams = generateStaticParamsFor('mdxPath');

const SITE_URL = 'https://inferloop.dev';
const SITE_NAME = 'InferLoop';
const DEFAULT_DESC =
  'InferLoop · 工程师写给工程师的 AI Infra 与 Agent 工程深度内容。每一本书都让你读完后能独立上手干活。';

const BOOK_TITLE: Record<string, string> = Object.fromEntries(
  BOOKS.map((b) => [b.slug, b.title])
);

function pickFirstHeading(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const m = source.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : undefined;
}

function pickFirstParagraph(source: string | undefined): string | undefined {
  if (!source) return undefined;
  // 去掉 frontmatter
  const body = source.replace(/^---[\s\S]*?---\s*/m, '');
  // 跳过标题/代码块/空行，找第一段普通文字
  const lines = body.split(/\r?\n/);
  let buf: string[] = [];
  let inCode = false;
  for (const ln of lines) {
    if (ln.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const t = ln.trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    if (/^[#>\-*]/.test(t)) {
      if (buf.length) break;
      continue;
    }
    buf.push(t);
    if (buf.join(' ').length > 220) break;
  }
  const para = buf.join(' ').replace(/\s+/g, ' ').trim();
  return para || undefined;
}

export async function generateMetadata(props: any): Promise<Metadata> {
  const params = await props.params;
  const segs: string[] = params.mdxPath ?? [];
  const urlPath = '/' + segs.join('/');

  let pageMetadata: any = {};
  let sourceCode = '';
  try {
    const r = await importPage(segs);
    pageMetadata = r.metadata ?? {};
    sourceCode = r.sourceCode ?? '';
  } catch {
    // pass
  }

  const headingTitle = pickFirstHeading(sourceCode);
  const description: string =
    pageMetadata.description ||
    pickFirstParagraph(sourceCode) ||
    DEFAULT_DESC;

  // 组装标题：章节页用 "章节标题 · 书名"
  let title: string =
    pageMetadata.title || headingTitle || SITE_NAME;
  const bookSlug = segs[0];
  const isChapter = segs.length >= 2 && BOOK_TITLE[bookSlug];
  if (isChapter && !/(InferLoop|·)/.test(title)) {
    title = `${title} · ${BOOK_TITLE[bookSlug]}`;
  }

  const canonical = `${SITE_URL}${urlPath === '/' ? '' : urlPath}`;

  // 选 og:image：当前页所属的书的 ogImage 优先，否则 cover
  const book = bookSlug ? getBookBySlug(bookSlug) : undefined;
  const ogImage = book?.ogImage || book?.cover;

  const meta: Metadata = {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: isChapter ? 'article' : 'website',
      url: canonical,
      title: title === SITE_NAME ? `${SITE_NAME} – Loop to the top.` : `${title} – ${SITE_NAME}`,
      description,
      siteName: SITE_NAME,
      locale: 'zh_CN',
      ...(ogImage ? { images: [{ url: ogImage, alt: book?.title ?? SITE_NAME }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: title === SITE_NAME ? `${SITE_NAME} – Loop to the top.` : title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };

  // 合并页面 frontmatter 中的额外 metadata（如 keywords / authors）
  if (pageMetadata.keywords) meta.keywords = pageMetadata.keywords;
  if (pageMetadata.authors) meta.authors = pageMetadata.authors;

  return meta;
}

const { wrapper: Wrapper } = useMDXComponents();

function buildJsonLd(opts: {
  title: string;
  description: string;
  url: string;
  segs: string[];
}) {
  const { title, description, url, segs } = opts;
  const bookSlug = segs[0];
  const isChapter = segs.length >= 2 && BOOK_TITLE[bookSlug];
  const isBookIndex = segs.length === 1 && BOOK_TITLE[bookSlug];
  const isHome = segs.length === 0;

  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: SITE_URL },
      ...(segs.length >= 1
        ? [
            {
              '@type': 'ListItem',
              position: 2,
              name: BOOK_TITLE[bookSlug] ?? bookSlug,
              item: `${SITE_URL}/${bookSlug}`,
            },
          ]
        : []),
      ...(segs.length >= 2
        ? [
            {
              '@type': 'ListItem',
              position: 3,
              name: title,
              item: url,
            },
          ]
        : []),
    ],
  };

  if (isHome) {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': SITE_URL + '/#website',
          name: SITE_NAME,
          url: SITE_URL,
          description,
          inLanguage: 'zh-CN',
        },
        {
          '@type': 'Person',
          '@id': SITE_URL + '/#author',
          name: '递归客',
          url: SITE_URL + '/about',
          knowsAbout: ['LLM Infra', 'AI Agent', 'vLLM', 'Transformer', 'Claude Code'],
        },
      ],
    };
  }

  if (isBookIndex) {
    const book = getBookBySlug(bookSlug);
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Book',
          '@id': url + '#book',
          name: title,
          description,
          inLanguage: 'zh-CN',
          author: { '@type': 'Person', name: '递归客' },
          publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
          url,
          ...(book?.cover ? { image: book.cover } : {}),
        },
        breadcrumb,
      ],
    };
  }

  if (isChapter) {
    const book = getBookBySlug(bookSlug);
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          '@id': url + '#article',
          headline: title,
          description,
          inLanguage: 'zh-CN',
          author: { '@type': 'Person', name: '递归客' },
          publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
          isPartOf: {
            '@type': 'Book',
            name: BOOK_TITLE[bookSlug],
            url: `${SITE_URL}/${bookSlug}`,
            ...(book?.cover ? { image: book.cover } : {}),
          },
          mainEntityOfPage: { '@type': 'WebPage', '@id': url },
          ...(book?.cover ? { image: book.cover } : {}),
        },
        breadcrumb,
      ],
    };
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url,
    inLanguage: 'zh-CN',
  };
}

export default async function Page(props: any) {
  const params = await props.params;
  const segs: string[] = params.mdxPath ?? [];
  const { default: MDXContent, toc, metadata, sourceCode } = await importPage(segs);

  const urlPath = '/' + segs.join('/');
  const url = `${SITE_URL}${urlPath === '/' ? '' : urlPath}`;
  const title: string =
    (metadata as any)?.title || pickFirstHeading(sourceCode) || SITE_NAME;
  const description: string =
    (metadata as any)?.description || pickFirstParagraph(sourceCode) || DEFAULT_DESC;

  const jsonLd = buildJsonLd({ title, description, url, segs });

  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MDXContent {...props} params={params} />
    </Wrapper>
  );
}
