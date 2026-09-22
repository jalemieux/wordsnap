// End to end: a page that matches none of the site adapters. Nothing runs until the toolbar popup asks; then the
// generic adapter finds the long contenteditable and the passes run with the mock provider. Always on registers the
// origin so the next load starts on its own. The popup itself is opened as a page and photographed once.
import { test, expect } from './fixtures';
import type { OptionsRequest, OptionsResponse } from '../../src/shared/messages';

const FIXTURE = 'http://127.0.0.1:4173/any-site.html';
const ORIGIN = 'http://127.0.0.1:4173';

test.beforeEach(async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: /use the mock provider/i }).click();
  await expect(page.getByRole('heading', { name: 'Setup complete' })).toBeVisible({ timeout: 10_000 });
  await page.close();
});

/** The request the popup would send, run on the service worker through the dev hook. */
async function request(context: import('@playwright/test').BrowserContext, req: OptionsRequest): Promise<OptionsResponse> {
  const [worker] = context.serviceWorkers();
  return worker!.evaluate((r) => (globalThis as unknown as { __wordsnapDev: { request(r: OptionsRequest): Promise<OptionsResponse> } }).__wordsnapDev.request(r), req);
}

async function tabIdFor(context: import('@playwright/test').BrowserContext, url: string): Promise<number> {
  const [worker] = context.serviceWorkers();
  return worker!.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: `${u}*` });
    return tab!.id!;
  }, url);
}

test('Use WordSnap here: nothing runs until asked, then the badge appears on the long editable and analysis runs', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  // The content script is on the page (dev builds inject it on the fixture host) but the generic adapter is off.
  await page.waitForTimeout(500);
  await expect(page.locator('wordsnap-overlay')).toHaveCount(0);

  const status = await request(context, { type: 'site/status', url: FIXTURE });
  expect(status.type === 'site' && status.site).toMatchObject({ status: 'available', origin: ORIGIN, canRegister: true, generic: true, sites: [] });

  const used = await request(context, { type: 'site/use', tabId: await tabIdFor(context, FIXTURE) });
  expect(used.type === 'site' && used.site.composers).toBe(1);

  const overlay = page.locator('wordsnap-overlay');
  await expect(overlay).toHaveCount(1);
  // One composer: the page body. The short edit-summary textarea is left alone.
  await expect(overlay.locator('.ws-launcher')).toHaveCount(1);
  await expect(overlay.locator('.ws-panel')).toHaveCount(0);
  await overlay.locator('.ws-launcher').click();
  const panel = overlay.locator('.ws-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.locator('[data-act="start"]').click();
  const highlights = overlay.locator('.ws-hl-layer [role="button"]');
  await expect(highlights.first()).toBeVisible({ timeout: 15_000 });
  expect(await highlights.count()).toBeGreaterThanOrEqual(3);
  await expect(panel.locator('.ws-summary')).toContainText(/1 contradicted/);
});

test('Always on: registering the origin starts WordSnap on the next load; Remove stops it', async ({ context }) => {
  const registered = await request(context, { type: 'site/register', origin: ORIGIN });
  expect(registered.type === 'site' && registered.site).toMatchObject({ status: 'registered', sites: [ORIGIN] });
  const [worker] = context.serviceWorkers();
  expect(await worker!.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toMatchObject([{ id: `site:${ORIGIN}`, matches: [`${ORIGIN}/*`], js: ['content.js'], persistAcrossSessions: true }]);

  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = page.locator('wordsnap-overlay');
  await expect(overlay).toHaveCount(1, { timeout: 10_000 });
  await expect(overlay.locator('.ws-launcher')).toBeVisible();

  const removed = await request(context, { type: 'site/unregister', origin: ORIGIN });
  expect(removed.type === 'site' && removed.site).toMatchObject({ status: 'available', sites: [] });
  expect(await worker!.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.locator('wordsnap-overlay')).toHaveCount(0);
});

test('the popup offers the two entries on an ordinary page and says so on a built-in site', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 260 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${await tabIdFor(context, FIXTURE)}`);
  await expect(popup.getByRole('button', { name: /use wordsnap here/i })).toBeEnabled();
  await expect(popup.getByRole('button', { name: /always on 127\.0\.0\.1:4173/i })).toBeEnabled();
  await expect(popup.getByRole('button', { name: /settings/i })).toBeVisible();
  await popup.screenshot({ path: 'test-results/popup.png' });

  const gmail = await context.newPage();
  await gmail.goto('http://127.0.0.1:4173/gmail-compose.html');
  // The fixture stands in for Gmail through the dev override; the popup asks by URL, so tell it the real one.
  const builtin = await request(context, { type: 'site/status', url: 'https://mail.google.com/mail/u/0/#inbox?compose=new' });
  expect(builtin.type === 'site' && builtin.site.status).toBe('builtin');
  const nowhere = await request(context, { type: 'site/status', url: 'chrome://extensions' });
  expect(nowhere.type === 'site' && nowhere.site.status).toBe('unsupported');
});

test('Other sites off in Settings disables the popup entries and refuses the request', async ({ context, extensionId }) => {
  const [worker] = context.serviceWorkers();
  await worker!.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as { settings: { enabledHosts: Record<string, boolean> } };
    await chrome.storage.local.set({ settings: { ...settings, enabledHosts: { ...settings.enabledHosts, generic: false } } });
  });
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${await tabIdFor(context, FIXTURE)}`);
  await expect(popup.getByText(/other sites are off in settings/i)).toBeVisible();
  await expect(popup.getByRole('button', { name: /use wordsnap here/i })).toBeDisabled();
  const refused = await request(context, { type: 'site/use', tabId: await tabIdFor(context, FIXTURE) });
  expect(refused.type).toBe('error');
  await expect(page.locator('wordsnap-overlay')).toHaveCount(0);
});
