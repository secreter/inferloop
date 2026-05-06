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
  // 各书页面保留路由，但从顶部导航隐藏，由下方 menu 统一入口
  'llm-infra': {
    title: 'LLM Infra 工程实战',
    type: 'page',
    display: 'hidden',
  },
  'hermes-agent': {
    title: 'Hermes Agent 源码解读',
    type: 'page',
    display: 'hidden',
  },
  openclaw: {
    title: 'OpenClaw 源码解析',
    type: 'page',
    display: 'hidden',
  },
  'claude-skill': {
    title: 'Claude Code Skill 指南',
    type: 'page',
    display: 'hidden',
  },
  'claude-plugins': {
    title: 'Claude 插件官方指南',
    type: 'page',
    display: 'hidden',
  },
  'ling-agent': {
    title: '自己动手写 AI Agent',
    type: 'page',
    display: 'hidden',
  },
  repox: {
    title: 'AI 时代的 CLI 工具开发实战',
    type: 'page',
    display: 'hidden',
  },
  'claude-mem': {
    title: 'Agent Memory 工程实战',
    type: 'page',
    display: 'hidden',
  },
  // ── 顶部导航分组 dropdown ──────────────────────────────────────────────────
  'menu-llm': {
    type: 'menu',
    title: 'LLM Infra',
    items: {
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
