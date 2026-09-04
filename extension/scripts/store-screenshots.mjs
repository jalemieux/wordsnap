// Captures the Chrome Web Store listing images into ../store/: five 1280x800 screenshots,
// the 440x280 promo tile, and the 1200x630 Open Graph image for the site.
// Usage: npm run build:dev && node test/e2e/serve.mjs &   then   node scripts/store-screenshots.mjs
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, '..', 'store');
const shots = path.join(out, 'screenshots');
await mkdir(shots, { recursive: true });
const icon = await readFile(path.join(root, 'public', 'icons', 'icon.svg'), 'utf8');

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];

const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${id}/options.html`);
await opt.waitForTimeout(400);
const hideDev = await opt.addStyleTag({ content: '.dev{display:none}' }); // the dev-build row is not in a production build
await opt.screenshot({ path: path.join(shots, '05-settings.png') });
await hideDev.evaluate((el) => el.remove());
await opt.getByRole('button', { name: /use the mock provider/i }).click();
await opt.waitForTimeout(500);
await opt.close();

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173/gmail-compose.html');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(shots, '01-badge.png') });
await page.locator('wordsnap-overlay .ws-launcher').click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shots, '02-analyzing.png') });
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(shots, '03-panel.png') });
const hl = page.locator('wordsnap-overlay .ws-hl').first();
await hl.hover();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(shots, '04-hover.png') });

// Promo tile and OG image: the mark, the name, the one-line thesis.
const card = (w, h, scale) => `
<style>
  html,body{margin:0;width:${w}px;height:${h}px;background:#F6F8F7;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#16211F}
  .wrap{display:flex;flex-direction:column;justify-content:center;gap:${18 * scale}px;height:100%;padding:0 ${64 * scale}px;box-sizing:border-box}
  .row{display:flex;align-items:center;gap:${18 * scale}px}
  svg{width:${56 * scale}px;height:${56 * scale}px;display:block}
  .name{font-size:${40 * scale}px;font-weight:700;letter-spacing:-0.02em}
  .thesis{font-size:${24 * scale}px;line-height:1.3;max-width:${22 * 24 * scale}px}
  .sub{font-size:${15 * scale}px;color:#5F6F6C}
</style>
<div class="wrap">
  <div class="row">${icon}<div class="name">WordSnap</div></div>
  <div class="thesis">Make your point. Keep your voice.</div>
  <div class="sub">Structure your narrative, polish your wording, fact-check your claims, hear the counterargument.</div>
</div>`;
const tile = await ctx.newPage();
await tile.setViewportSize({ width: 440, height: 280 });
await tile.setContent(card(440, 280, 0.72));
await tile.screenshot({ path: path.join(out, 'promo-440x280.png') });
await tile.close();
const og = await ctx.newPage();
await og.setViewportSize({ width: 1200, height: 630 });
await og.setContent(card(1200, 630, 1.6));
await og.screenshot({ path: path.join(out, 'og-1200x630.png') });
await og.close();

await ctx.close();
console.log(`wrote store images to ${out}`);
