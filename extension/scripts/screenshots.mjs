// Dev utility: loads the dev build with the mock provider and captures closed / loading / open states of the overlay.
// Usage: node test/e2e/serve.mjs &  then  node scripts/screenshots.mjs out/prefix

import { chromium } from '@playwright/test';
import path from 'node:path';
const dist = path.resolve('dist');
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 1400, height: 900 } });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const opt = await ctx.newPage(); await opt.goto(`chrome-extension://${id}/options.html`);
await opt.getByRole('button', { name: /use the mock provider/i }).click(); await opt.waitForTimeout(500); await opt.close();
const page = await ctx.newPage(); await page.goto('http://127.0.0.1:4173/gmail-compose.html'); await page.waitForTimeout(800);
await page.screenshot({ path: process.argv[2] + '-closed.png' });
await page.locator('wordsnap-overlay .ws-launcher').click(); await page.waitForTimeout(400);
await page.screenshot({ path: process.argv[2] + '-loading.png' });
await page.waitForTimeout(3000);
await page.screenshot({ path: process.argv[2] + '-open.png' });
await ctx.close();
