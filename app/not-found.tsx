'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const FEISHU_URL =
  'https://fivwvysqdz.feishu.cn/wiki/space/7625711311279623122?ccm_open_type=lark_wiki_spaceLink&open_tab_from=wiki_home';

const PICKS: Array<{ href: string; title: string; subtitle: string }> = [
  {
    href: '/transformer',
    title: 'Transformer 工程实战',
    subtitle: '注意力机制 → 生产部署',
  },
  {
    href: '/llm-infra',
    title: 'LLM Infra 工程实战',
    subtitle: '推理引擎与分布式训练',
  },
  {
    href: '/ling-agent',
    title: '自己动手写 AI Agent',
    subtitle: '从 Claude Code 架构起步',
  },
  {
    href: '/claude-mem',
    title: 'Agent Memory 工程实战',
    subtitle: 'claude-mem 源码精读',
  },
];

function focusSearch() {
  const input = document.querySelector<HTMLInputElement>(
    '.nextra-search input, input[type="search"]'
  );
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export default function NotFound() {
  const pathname = usePathname();
  const displayedPath = pathname && pathname !== '/' ? pathname : '/<unknown>';

  return (
    <section className="il-404">
      <div className="il-404-terminal" role="img" aria-label="终端 404 错误">
        <div className="il-404-term-bar">
          <span className="il-404-term-dot" data-c="r" />
          <span className="il-404-term-dot" data-c="y" />
          <span className="il-404-term-dot" data-c="g" />
          <span className="il-404-term-title">inferloop ~ 404</span>
        </div>
        <pre className="il-404-term-body">
          <span className="il-404-prompt">$</span>{' '}
          <span className="il-404-cmd">inferloop --open</span>{' '}
          <span className="il-404-arg">{displayedPath}</span>
          {'\n'}
          <span className="il-404-err">&gt; ERR_PAGE_NOT_FOUND</span>
          {'\n'}
          <span className="il-404-comment"># status: 404 · 这条路径不在书架上</span>
        </pre>
      </div>

      <h1 className="il-404-title">这一页找不到了</h1>
      <p className="il-404-lead">
        可能是链接拼错、章节被重命名，或者你看到的是旧缓存。
        别紧张，下面这几条出路总有一个能带你回到正轨。
      </p>

      <div className="il-404-actions">
        <Link className="il-btn il-btn-primary" href="/">
          回到书架首页 <span aria-hidden style={{ marginLeft: 4 }}>→</span>
        </Link>
        <button
          type="button"
          className="il-btn il-btn-ghost"
          onClick={focusSearch}
        >
          在站内搜索（⌘/Ctrl + K）
        </button>
        <a
          className="il-btn il-btn-ghost"
          href={FEISHU_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          到飞书联系作者 ↗
        </a>
      </div>

      <div className="il-404-divider" aria-hidden>
        ── 也许你在找这几本 ──
      </div>

      <ul className="il-404-picks">
        {PICKS.map((b) => (
          <li key={b.href}>
            <Link href={b.href} className="il-404-pick">
              <span className="il-404-pick-arrow" aria-hidden>
                ❯_
              </span>
              <span className="il-404-pick-body">
                <span className="il-404-pick-title">{b.title}</span>
                <span className="il-404-pick-sub">{b.subtitle}</span>
              </span>
              <span className="il-404-pick-go" aria-hidden>
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="il-404-foot">
        如果你确认链接是从我们站内点过来的，
        <a href={FEISHU_URL} target="_blank" rel="noopener noreferrer">
          告诉作者一声
        </a>
        ，我会把它修好。
      </p>
    </section>
  );
}
