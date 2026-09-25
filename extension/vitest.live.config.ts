import { defineConfig } from 'vitest/config';

// Real model calls. Run by hand: OPENROUTER_API_KEY=sk-or-... npm run live
export default defineConfig({
  test: { globals: true, include: ['test/live/**/*.live.test.ts'], environment: 'node', testTimeout: 240_000, hookTimeout: 240_000 },
  define: { __WORDSNAP_DEV__: 'true', __WORDSNAP_BROWSER__: '"chrome"' },
});
