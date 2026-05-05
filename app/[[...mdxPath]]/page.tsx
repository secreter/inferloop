import { generateStaticParamsFor, importPage } from 'nextra/pages';

export const generateStaticParams = generateStaticParamsFor('mdxPath');

export async function generateMetadata(props: any) {
  const params = await props.params;
  const { metadata } = await importPage(params.mdxPath);
  return metadata;
}

export default async function Page(props: any) {
  const params = await props.params;
  const { default: MDXContent, toc, metadata } = await importPage(params.mdxPath);
  return <MDXContent toc={toc} metadata={metadata} />;
}
