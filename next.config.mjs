import nextra from 'nextra';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  turbopack: {
    root: __dirname,
  },
});
