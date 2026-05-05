import nextra from 'nextra';

const withNextra = nextra({
  defaultShowCopyCode: true,
  search: { codeblocks: false },
});

export default withNextra({
  output: 'export',
  images: { unoptimized: true },
  env: {
    NEXTRA_LOCALES: '[""]',
  },
});
