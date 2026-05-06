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

function ResponsiveImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const { alt = '', loading, decoding, ...rest } = props;
  return (
    <img
      alt={alt}
      loading={loading ?? 'lazy'}
      decoding={decoding ?? 'async'}
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
