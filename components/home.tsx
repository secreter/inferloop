import Link from 'next/link';

export function HomeHero() {
  return (
    <section className="il-hero">
      <span className="il-eyebrow">inferloop --bookshelf</span>
      <h1 className="il-title">Loop to the top.</h1>
      <p className="il-tagline">工程师写给工程师的 AI Infra &amp; Agent 工程深度内容。</p>
      <p className="il-lead">
        每一本书都从工程师视角拆解技术细节，让你读完后能独立动手干活——
        而不是「感觉学了很多但什么都做不了」。
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
        八年大厂前端工程师，主技术栈 Node.js + TypeScript，正在全力转型 AI Agent 工程与 LLM Infra
        方向。这些书是转型过程中的系统化输出：每学透一个领域，就写成一本让同行能直接上手的实战指南。
      </p>
    </aside>
  );
}
