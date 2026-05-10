import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import { Suspense } from 'react';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head, Search } from 'nextra/components';
import { GitHubIcon } from 'nextra/icons';
import { getPageMap } from 'nextra/page-map';
import 'nextra-theme-docs/style.css';
import './globals.css';
import { BOOKS } from '@/lib/books';
import { GoogleAnalyticsEvents, GoogleAnalyticsPageView } from '@/components/google-analytics';

const CF_ANALYTICS_TOKEN = process.env.NEXT_PUBLIC_CF_ANALYTICS_TOKEN;
const GA_MEASUREMENT_ID = 'G-VSR6HNJK82';

const SITE_URL = 'https://inferloop.dev';
const SITE_NAME = 'InferLoop';
const SITE_TAGLINE = 'Loop to the top.';
const SITE_DESCRIPTION =
  'InferLoop · 工程师写给工程师的 AI Infra 与 Agent 工程深度内容。每一本书都让你读完后能独立上手干活。';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} – ${SITE_TAGLINE}`,
    template: '%s · InferLoop',
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'LLM Infra',
    'AI Infra',
    'AI Agent',
    'Agent 工程',
    'vLLM',
    'Transformer',
    '推理引擎',
    'Claude Code',
    'Skill',
    'OpenClaw',
    'Hermes Agent',
    'RAG',
    '微调',
    '分布式训练',
  ],
  authors: [{ name: '递归客' }],
  creator: '递归客',
  publisher: 'InferLoop',
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} – ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: `${SITE_URL}/og.png`,
        width: 1200,
        height: 630,
        alt: 'InferLoop · 工程师写给工程师的 AI Infra 与 Agent 工程',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} – ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    creator: '@inferloop',
    images: [`${SITE_URL}/og.png`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    // 与 Head faviconGlyph 配合，emoji 用作动态 favicon
    other: [{ rel: 'mask-icon', url: '/favicon.svg' }],
  },
  category: 'technology',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
};

const navbar = (
  <Navbar
    logoLink={false}
    logo={
      <Link
        href="/"
        aria-label="InferLoop · 首页"
        className="il-logo"
      >
        <span aria-hidden className="il-logo-mark">❯_</span>
        <span className="il-logo-text">inferloop</span>
      </Link>
    }
    projectLink="https://fivwvysqdz.feishu.cn/wiki/space/7625711311279623122?ccm_open_type=lark_wiki_spaceLink&open_tab_from=wiki_home"
    projectIcon={<GitHubIcon height={24} aria-label="到飞书知识库联系作者" />}
  />
);

const footer = (
  <Footer>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        width: '100%',
        textAlign: 'center',
        fontSize: '0.92rem',
      }}
    >
      <div style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>
        InferLoop · Loop to the top.
      </div>
      <div className="il-footer-meta" style={{ fontSize: '0.85rem' }}>
        © {new Date().getFullYear()} 递归客 · 工程师写给工程师的 AI Infra 深度内容 · 内容采用{' '}
        <a
          href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
          target="_blank"
          rel="noopener noreferrer"
        >
          CC BY-NC-SA 4.0
        </a>{' '}
        授权
      </div>
    </div>
  </Footer>
);

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: 'zh-CN',
      author: {
        '@type': 'Person',
        name: '递归客',
        url: `${SITE_URL}/about`,
      },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'ItemList',
      '@id': `${SITE_URL}/#books`,
      name: '书架',
      description: '工程师写给工程师的 AI Infra 与 Agent 工程系列书籍',
      itemListElement: BOOKS.map((book, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Book',
          name: book.title,
          url: `${SITE_URL}${book.href}`,
          inLanguage: 'zh-CN',
          author: { '@type': 'Person', name: '递归客' },
          description: book.desc,
        },
      })),
    },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pageMap = await getPageMap();

  return (
    <html lang="zh-CN" dir="ltr" suppressHydrationWarning>
      <Head
        color={{
          hue: 148,
          saturation: { light: 70, dark: 38 },
          lightness: { light: 26, dark: 64 },
        }}
        backgroundColor={{
          light: 'rgb(252,252,253)',
          dark: 'rgb(14,17,22)',
        }}
        faviconGlyph="❯"
      >
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="color-scheme" content="light dark" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>
      <body>
        {CF_ANALYTICS_TOKEN && (
          <Script
            id="cf-web-analytics"
            strategy="afterInteractive"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_ANALYTICS_TOKEN })}
          />
        )}
        <Script
          id="ga4-loader"
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}', {
              send_page_view: false,
              anonymize_ip: true,
            });
          `}
        </Script>
        <Suspense fallback={null}>
          <GoogleAnalyticsPageView measurementId={GA_MEASUREMENT_ID} />
        </Suspense>
        <GoogleAnalyticsEvents />
        <Layout
          navbar={navbar}
          pageMap={pageMap}
          footer={footer}
          search={
            <Search
              placeholder="搜索内容…"
              emptyResult={<div style={{ padding: '0.6rem 0.75rem', opacity: 0.7 }}>没有找到匹配结果</div>}
              loading={<div style={{ padding: '0.6rem 0.75rem', opacity: 0.7 }}>加载索引中…</div>}
              errorText={<div style={{ padding: '0.6rem 0.75rem', opacity: 0.7 }}>搜索索引未生成（仅生产环境可用）</div>}
            />
          }
          themeSwitch={{ light: '浅色', dark: '深色', system: '跟随系统' }}
          sidebar={{
            defaultMenuCollapseLevel: 1,
            toggleButton: true,
            autoCollapse: true,
          }}
          toc={{
            title: '本页目录',
            backToTop: '回到顶部',
            float: true,
          }}
          editLink={null}
          feedback={{
            content: '到飞书联系作者 →',
            link: 'https://fivwvysqdz.feishu.cn/wiki/space/7625711311279623122?ccm_open_type=lark_wiki_spaceLink&open_tab_from=wiki_home',
          }}
          navigation={{ prev: true, next: true }}
          copyPageButton={false}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
