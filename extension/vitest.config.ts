import { defineConfig } from 'vitest/config';

// DOM tests declare `// @vitest-environment happy-dom` at the top of each file; everything else runs in node.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
    environment: 'node',
  },
  define: { __WORDSNAP_DEV__: 'true', __WORDSNAP_BROWSER__: '"chrome"' },
});
