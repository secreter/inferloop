import Link from 'next/link';
import type { ReactNode, AnchorHTMLAttributes, ImgHTMLAttributes } from 'react';
import { useMDXComponents as getDocsMDXComponents } from 'nextra-theme-docs';

const docsComponents = getDocsMDXComponents();

const SITE_HOST = 'inferloop.dev';

function isExternal(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('#')) return false;
  if (href.startsWith('/') && !href.startsWith('//')) return false;
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  try {
    const u = new URL(href, 'https://example.com');
    return u.hostname !== '' && u.hostname !== 'example.com' && !u.hostname.endsWith(SITE_HOST);
  } catch {
    return false;
  }
}

function ExternalIcon() {
  return (
    <svg
      aria-hidden
      width="0.85em"
      height="0.85em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        display: 'inline-block',
        marginLeft: '0.18em',
        marginRight: '0.05em',
        verticalAlign: '-0.08em',
        opacity: 0.65,
      }}
    >
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function SmartLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
  const { href, children, target, rel, ...rest } = props;

  if (!href) {
    return <a {...rest}>{children}</a>;
  }

  // Anchor link in same page
  if (href.startsWith('#')) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }

  // External
  if (isExternal(href)) {
    const containsImage = Array.isArray(children)
      ? children.some((c) => typeof c === 'object' && c && 'type' in c && (c as any).type === 'img')
      : false;
    return (
      <a
        href={href}
        target={target ?? '_blank'}
        rel={rel ?? 'noopener noreferrer'}
        {...rest}
      >
        {children}
        {!containsImage && <ExternalIcon />}
      </a>
    );
  }

  // Internal: use Next Link for client-side navigation + prefetch
  return (
    <Link href={href} {...(rest as any)}>
      {children}
    </Link>
  );
}

// nextra 的 remark-static-image 会把本地图片转成静态导入对象
// （形如 { src, width, height, blurDataURL }），原生 <img> 接到对象后会
// 把它 stringify 成 "[object Object]"。这里把对象规整为字符串 src。
function normalizeSrc(src: unknown): string | undefined {
  if (!src) return undefined;
  if (typeof src === 'string') return src;
  if (typeof src === 'object') {
    const o = src as { src?: string; default?: { src?: string } };
    if (typeof o.src === 'string') return o.src;
    if (o.default && typeof o.default.src === 'string') return o.default.src;
  }
  return undefined;
}

type ResponsiveImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'placeholder'> & {
  src?: unknown;
  // nextra remark-static-image 会塞进来一个 placeholder="blur"，原生 img 不识别，丢弃
  placeholder?: string;
};

function ResponsiveImage(props: ResponsiveImageProps) {
  const { alt = '', loading, decoding, src, placeholder: _placeholder, ...rest } = props;
  const normalizedSrc = normalizeSrc(src);
  if (!normalizedSrc) return null;
  return (
    <img
      alt={alt}
      loading={loading ?? 'lazy'}
      decoding={decoding ?? 'async'}
      src={normalizedSrc}
      style={{
        maxWidth: '100%',
        height: 'auto',
        borderRadius: '12px',
        ...(rest.style ?? {}),
      }}
      {...rest}
    />
  );
}

export function useMDXComponents(components?: Record<string, any>) {
  return {
    ...docsComponents,
    a: SmartLink,
    img: ResponsiveImage,
    ...components,
  };
}
