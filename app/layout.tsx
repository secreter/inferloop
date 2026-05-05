import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import 'nextra-theme-docs/style.css';

export const metadata = {
  title: {
    default: 'InferLoop',
    template: '%s – InferLoop',
  },
  description: 'InferLoop - 工程师写给工程师的 AI Infra 深度内容。Loop to the top.',
  openGraph: {
    title: 'InferLoop',
    description: 'Loop to the top.',
    siteName: 'InferLoop',
  },
};

const navbar = (
  <Navbar
    logo={<span style={{ fontWeight: 700, fontSize: '1.2em' }}>InferLoop</span>}
    projectLink="https://github.com/inferloop"
  />
);

const footer = (
  <Footer>
    {new Date().getFullYear()} © 递归客 · Loop to the top.
  </Footer>
);

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pageMap = await getPageMap();

  return (
    <html lang="zh-CN" dir="ltr" suppressHydrationWarning>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <body>
        <Layout
          navbar={navbar}
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/inferloop/inferloop-site/tree/main/content"
          footer={footer}
          sidebar={{ defaultMenuCollapseLevel: 1, toggleButton: true }}
          toc={{ title: '本页目录' }}
          editLink="在 GitHub 上编辑此页"
          feedback={{ content: '有问题？提交反馈' }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
