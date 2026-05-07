export default {
  index: {
    type: 'page',
    title: '首页',
    display: 'hidden',
    theme: {
      layout: 'full',
      sidebar: false,
      toc: false,
      timestamp: false,
      breadcrumb: false,
      pagination: false,
      typesetting: 'default',
      copyPage: false,
    },
  },
  // 每本书作为 doc 文件夹保留（保证 sidebar 正常渲染章节）
  // 视觉上"书名"这一层由 CSS 隐藏（见 globals.css 中 .nextra-sidebar 区块）
  transformer: {
    title: 'Transformer 工程实战',
  },
  'llm-infra': {
    title: 'LLM Infra 工程实战',
  },
  'hermes-agent': {
    title: 'Hermes Agent 源码解读',
  },
  openclaw: {
    title: 'OpenClaw 源码解析',
  },
  'claude-skill': {
    title: 'Claude Code Skill 指南',
  },
  'claude-plugins': {
    title: 'Claude 插件官方指南',
  },
  'ling-agent': {
    title: '自己动手写 AI Agent',
  },
  repox: {
    title: 'AI 时代的 CLI 工具开发实战',
  },
  'claude-mem': {
    title: 'Agent Memory 工程实战',
  },
  // ── 顶部导航分组 dropdown ──────────────────────────────────────────────────
  'menu-llm': {
    type: 'menu',
    title: 'LLM Infra',
    items: {
      transformer: { title: 'Transformer 工程实战', href: '/transformer' },
      'llm-infra': { title: 'LLM Infra 工程实战', href: '/llm-infra' },
    },
  },
  'menu-agent': {
    type: 'menu',
    title: 'Agent 工程',
    items: {
      'hermes-agent': { title: 'Hermes Agent 实战', href: '/hermes-agent' },
      openclaw: { title: 'OpenClaw 源码解析', href: '/openclaw' },
      'ling-agent': { title: '自己动手写 AI Agent', href: '/ling-agent' },
    },
  },
  'menu-claude': {
    type: 'menu',
    title: 'Claude 生态',
    items: {
      'claude-skill': { title: 'Claude Code Skill 指南', href: '/claude-skill' },
      'claude-plugins': { title: 'Claude 插件官方指南', href: '/claude-plugins' },
    },
  },
  'menu-infra': {
    type: 'menu',
    title: 'Harness 基建',
    items: {
      repox: { title: 'AI 时代的 CLI 工具开发实战', href: '/repox' },
      'claude-mem': { title: 'Agent Memory 工程实战', href: '/claude-mem' },
    },
  },
  about: {
    title: '关于',
    type: 'page',
    theme: {
      sidebar: false,
      toc: false,
      timestamp: false,
      breadcrumb: false,
      pagination: false,
      copyPage: false,
    },
  },
};
