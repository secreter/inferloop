'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

function track(name: string, params: Record<string, unknown>) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
}

export function GoogleAnalyticsPageView({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
    const query = searchParams?.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    window.gtag('event', 'page_view', {
      page_path: url,
      page_location: window.location.href,
      page_title: document.title,
      send_to: measurementId,
    });
  }, [pathname, searchParams, measurementId]);

  return null;
}

export function GoogleAnalyticsEvents() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a');
      if (!anchor) return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref) return;

      // 章节点击：同页锚点（# 开头）
      if (rawHref.startsWith('#')) {
        const inToc = !!anchor.closest('.nextra-toc, nav[aria-label*="目录" i], nav[aria-label*="table of contents" i]');
        track('anchor_click', {
          anchor: rawHref.slice(1),
          link_text: (anchor.textContent || '').trim().slice(0, 80),
          location: inToc ? 'toc' : 'inline',
          page_path: window.location.pathname,
        });
        return;
      }

      // 外链点击：href 是绝对 URL 且 host 不同
      let url: URL | null = null;
      try {
        url = new URL(rawHref, window.location.href);
      } catch {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (url.hostname === window.location.hostname) return;

      track('outbound_click', {
        link_url: url.href,
        link_domain: url.hostname,
        link_text: (anchor.textContent || '').trim().slice(0, 80),
        outbound: true,
      });
    };

    // 搜索词：debounce 监听 .nextra-search 内的 input[type=search]
    let searchTimer: number | undefined;
    let lastReported = '';
    const onInput = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (el.type !== 'search') return;
      if (!el.closest('.nextra-search')) return;

      const term = el.value.trim();
      if (term.length < 2) return;
      if (term === lastReported) return;

      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        lastReported = term;
        track('search', { search_term: term });
      }, 700);
    };

    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('input', onInput, { capture: true });

    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('input', onInput, { capture: true });
      window.clearTimeout(searchTimer);
    };
  }, []);

  return null;
}
