/**
 * 书架元数据 — 唯一来源
 *
 * 此文件不会被 sync-from-books 脚本覆盖，可以放心修改。
 * 新增/修改一本书时，只改这里：
 *   - cover: 上传到 CDN 的封面图 URL（建议竖版 2:3，不小于 800×1200）
 *   - 章节数 / 状态 / tag
 *
 * 引用方：
 *   - components/home.tsx     首页卡片
 *   - app/[[...mdxPath]]/...  章节页 og:image fallback
 */

export type BookStatus = 'in-progress' | 'updating' | 'planning';

export interface Book {
  slug: string;
  href: string;
  tag: string;
  title: string;
  /** 副标题（封面上的小字一行）。可选。 */
  subtitle?: string;
  desc: string;
  /** 封面图 URL（竖版，2:3 比例为佳）。留空时卡片回退到纯文本布局。 */
  cover?: string;
  /** OG 分享图 URL，缺省回退到 cover。建议提供 1200×630 横版。 */
  ogImage?: string;
  chapters: number | null;
  status: BookStatus;
}

export const BOOKS: Book[] = [
  {
    slug: 'llm-infra',
    href: '/llm-infra',
    tag: 'llm-infra',
    title: 'LLM Infra 工程实战',
    subtitle: '从入门到实践',
    desc: '面向应用层工程师的 LLM 基础设施学习路径。从 Transformer 到分布式训练，从推理引擎到生产部署。',
    cover: 'https://images.redream.cn/images/Xmle0j.png',
    chapters: 17,
    status: 'in-progress',
  },
  {
    slug: 'hermes-agent',
    href: '/hermes-agent',
    tag: 'hermes-agent',
    title: 'Hermes Agent 实战',
    subtitle: '构建会成长的个人 AI Agent',
    desc: '解剖 Hermes Agent 架构设计，理解 Agent 运行时、Skill 系统、消息路由的核心实现。',
    cover: 'https://images.redream.cn/images/ER4raD.png',
    chapters: 17,
    status: 'in-progress',
  },
  {
    slug: 'openclaw',
    href: '/openclaw',
    tag: 'openclaw',
    title: 'OpenClaw 源码解析',
    subtitle: '现代 Agent 系统的架构设计与工程实践',
    desc: '从 Monorepo 到 Gateway，从 LLM 调度到工具执行，逐层拆解一个真实的 AI 助手项目。',
    cover: 'https://images.redream.cn/images/9XtwZM.png',
    chapters: 35,
    status: 'updating',
  },
  {
    slug: 'claude-skill',
    href: '/claude-skill',
    tag: 'claude-skill',
    title: 'Claude Code Skill 指南',
    desc: '掌握 Claude Code Skill 开发，构建可复用的 AI 工程能力模块。',
    chapters: null,
    status: 'planning',
  },
  {
    slug: 'claude-plugins',
    href: '/claude-plugins',
    tag: 'claude-plugins',
    title: 'Claude 插件官方指南',
    desc: '从开发工具到专业领域，系统掌握 Claude 插件生态。',
    chapters: null,
    status: 'planning',
  },
];

export function getBookBySlug(slug: string): Book | undefined {
  return BOOKS.find((b) => b.slug === slug);
}
