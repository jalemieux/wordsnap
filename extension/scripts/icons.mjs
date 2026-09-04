// Renders public/icons/icon.svg to the PNG sizes the manifest and the Chrome Web Store need.
// Usage: node scripts/icons.mjs   (needs the Playwright Chromium: npx playwright install chromium)
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'icons');
const svg = await readFile(path.join(dir, 'icon.svg'), 'utf8');
const sizes = [16, 32, 48, 128];

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(path.join(dir, `icon-${size}.png`), png);
  console.log(`icon-${size}.png`);
}
await browser.close();
