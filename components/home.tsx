import Link from 'next/link';

export function HomeHero() {
  return (
    <section className="il-hero">
      <span className="il-eyebrow">inferloop --bookshelf</span>
      <h1 className="il-title">Loop to the top.</h1>
      <p className="il-tagline">工程师写给工程师的 AI Infra &amp; Agent 工程深度内容。</p>
      <p className="il-lead">
        书是我能想到最诚实的形式——逼着自己把每个环节都想透，再写清楚。
      </p>
      <div className="il-cta">
        <Link className="il-btn il-btn-primary" href="/llm-infra">
          开始阅读 · LLM Infra
          <span aria-hidden style={{ marginLeft: 4 }}>→</span>
        </Link>
        <Link className="il-btn il-btn-ghost" href="/about">
          关于 InferLoop
        </Link>
      </div>
    </section>
  );
}

export function AuthorCard() {
  return (
    <aside className="il-author">
      <h3>关于作者 · 递归客</h3>
      <p>
        全栈工程师出身，主技术栈 Node.js + TypeScript，现在全力深入 AI Agent 工程与 LLM Infra
        方向。这些书是系统化学习的沉淀：每学透一个领域，就写成一本让同行能直接上手的实战指南。
      </p>
      <div className="il-author-contact">
        <p className="il-author-contact-label">公众号 · AI Reading Hub</p>
        <img
          src="https://meikan-public-images.oss-cn-beijing.aliyuncs.com/imeikan/assets/2025-06-13005433-qrcode_for_gh_27101e9a2f9d_258.jpg"
          alt="AI Reading Hub 公众号二维码"
          className="il-author-qrcode"
          width={120}
          height={120}
        />
      </div>
    </aside>
  );
}
