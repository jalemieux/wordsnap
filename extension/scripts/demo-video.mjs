// Records the 25 second demo shown on wordsnap.ai: badge, click, findings, hover card, Apply change.
// Usage: npm run build:dev && node test/e2e/serve.mjs &   then   node scripts/demo-video.mjs
// Writes ../site/demo.webm (1280x880, VP8, no audio) and ../site/screenshot-open.png, the poster frame.
import { chromium } from '@playwright/test';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = path.join(root, '..', 'site', 'demo.webm');
const poster = path.join(root, '..', 'site', 'screenshot-open.png');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'wordsnap-video-'));

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 1280, height: 880 },
  deviceScaleFactor: 1,
  recordVideo: { dir: tmp, size: { width: 1280, height: 880 } },
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];

const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${id}/options.html`);
await opt.getByRole('button', { name: /use the mock provider/i }).click();
await opt.waitForTimeout(500);
await opt.close();

const page = await ctx.newPage();
const hold = (ms) => page.waitForTimeout(ms);
await page.goto(`http://127.0.0.1:${process.env.PORT ?? 4173}/gmail-compose.html`);
await hold(2000); // the draft, the badge, nothing else

const overlay = page.locator('wordsnap-overlay');
await overlay.locator('.ws-launcher').hover();
await hold(600);
await overlay.locator('.ws-launcher').click();
await hold(3800); // loading ring, then findings and the panel
await page.screenshot({ path: poster }); // the poster frame shown before the video plays

const highlights = overlay.locator('.ws-hl-layer [role="button"]');
await highlights.first().hover({ force: true }); // a clarity note
await hold(2600);
await page.mouse.move(640, 720); // away from the text, the card closes
await hold(900);

const contradicted = overlay.locator('.ws-hl-layer [role="button"][data-status="contradicted"]').first();
await contradicted.hover({ force: true });
await hold(1200);
await contradicted.click({ force: true }); // pin the card
await hold(2200);
const card = overlay.locator('[aria-label="Fact check"]');
await card.getByRole('button', { name: /apply change/i }).hover();
await hold(800);
await card.getByRole('button', { name: /apply change/i }).click();
await hold(2600); // the sentence changed in place, the highlight is gone

await overlay.locator('.ws-panel').hover();
await hold(2200);

const video = page.video();
await ctx.close();
await copyFile(await video.path(), out);
await rm(tmp, { recursive: true, force: true });
console.log(`wrote ${out}`);
