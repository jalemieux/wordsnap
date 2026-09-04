// End to end: dev build of the extension loaded in Chromium, mock provider, fake Gmail compose page.
import { test, expect } from './fixtures';

const FIXTURE = 'http://127.0.0.1:4173/gmail-compose.html';

test.beforeEach(async ({ context, extensionId }) => {
  // Switch to the mock provider through the options page (dev builds expose it), then mark onboarding done.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: /use the mock provider/i }).click();
  // The settings view renders once the save lands; its provider select reflects the mock choice.
  await expect(page.locator('select').first()).toHaveValue('mock', { timeout: 10_000 });
  await page.close();
});

async function openWordSnap(page: import('@playwright/test').Page) {
  const overlay = page.locator('wordsnap-overlay');
  await expect(overlay).toHaveCount(1);
  // Nothing but the badge until the user asks.
  await expect(overlay.locator('.ws-panel')).toHaveCount(0);
  await overlay.locator('.ws-launcher').click();
  return overlay;
}

test('analyzes the draft, shows highlights, panel and export bar', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = await openWordSnap(page);

  // Challenges panel appears with the strongest rebuttal first.
  const panel = overlay.locator('.ws-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('The trials you cite were opt-in and self-reported.')).toBeVisible();
  const rows = panel.locator('.ws-ch-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText(/strongest rebuttal/i);

  // Highlights over the fact spans once verdicts arrive.
  const highlights = overlay.locator('.ws-hl-layer [role="button"]');
  await expect(highlights.first()).toBeVisible({ timeout: 15_000 });
  expect(await highlights.count()).toBeGreaterThanOrEqual(3);

  // Export bar warns while the contradicted claim is open.
  const bar = overlay.locator('.ws-export');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/still/i);
});

test('hover card shows the finding and Apply change edits the draft', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = await openWordSnap(page);
  const highlights = overlay.locator('.ws-hl-layer [role="button"]');
  await expect(highlights.first()).toBeVisible({ timeout: 15_000 });

  // Find the contradicted claim's highlight and pin its card.
  const contradicted = overlay.locator('.ws-hl-layer [role="button"][data-status="contradicted"]').first();
  await expect(contradicted).toBeVisible();
  await contradicted.click();
  const card = overlay.locator('[aria-label="Fact check"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('56 continued');
  await expect(card.locator('ins')).toContainText('56 of the 61 companies kept it');

  // Two claims are open before the fix (contradicted + needs precision).
  const bar = overlay.locator('.ws-export');
  await expect(bar).toContainText(/2 claims still open/i);

  await card.getByRole('button', { name: /apply change/i }).click();

  // The host editor now contains the replacement and no longer the original phrase.
  const body = page.locator('#message-body');
  await expect(body).toContainText('56 of the 61 companies kept it');
  await expect(body).not.toContainText('not a single company went back to five days');

  // Re-analysis runs silently; only the needs-precision claim remains open, and the fixed span is no longer red.
  await expect(bar).toContainText(/1 claim still/i, { timeout: 15_000 });
  await expect(overlay.locator('.ws-hl-layer [role="button"][data-status="contradicted"]')).toHaveCount(0);
});

test('editing a flagged sentence marks its finding stale and re-runs', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = await openWordSnap(page);
  const panel = overlay.locator('.ws-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(overlay.locator('.ws-hl-layer [role="button"]').first()).toBeVisible({ timeout: 15_000 });

  // Type into the hallway-sample sentence.
  const body = page.locator('#message-body');
  await body.click();
  await page.evaluate(() => {
    const el = document.getElementById('message-body')!;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.textContent!.indexOf("everyone I've talked to on the team");
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + "everyone I've talked to on the team".length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      }
    }
  });
  await page.keyboard.type('the eleven engineers and designers I asked');

  await expect(panel).toContainText(/re-analyzing|re-checking|checked just now/i, { timeout: 15_000 });
  await expect(panel.locator('.ws-ch-row').filter({ hasText: /hallway sample/ })).toContainText(/re-checking|addressed/i, { timeout: 20_000 });
});

test('collapsing hides the panel, keeps the badge, and shows the open-issue count', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = await openWordSnap(page);
  await expect(overlay.locator('.ws-hl-layer [role="button"]').first()).toBeVisible({ timeout: 15_000 });
  await overlay.locator('.ws-close').click();
  await expect(overlay.locator('.ws-panel')).toHaveCount(0);
  await expect(overlay.locator('.ws-hl-layer')).toHaveCount(0);
  const badge = overlay.locator('.ws-launcher');
  await expect(badge).toBeVisible();
  await expect(badge.locator('.ws-launcher-count')).toHaveText('2');
  await badge.click();
  await expect(overlay.locator('.ws-panel')).toBeVisible();
});

test('the panel survives the host swapping the body element under the same compose', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = await openWordSnap(page);
  await expect(overlay.locator('.ws-panel')).toBeVisible({ timeout: 15_000 });

  // Gmail re-creates the editable body inside the same dialog. The session restarts on the new element.
  await page.evaluate(() => {
    const body = document.getElementById('message-body')!;
    body.replaceWith(body.cloneNode(true));
  });
  await page.waitForTimeout(600);
  await expect(page.locator('wordsnap-overlay')).toHaveCount(1);
  await expect(page.locator('wordsnap-overlay .ws-panel')).toBeVisible();
  // Analysis was armed by the click, so the new session runs it again without another click.
  await expect(page.locator('wordsnap-overlay .ws-panel .ws-ch-row')).toHaveCount(4, { timeout: 15_000 });
});

test('a momentary hide of the composer does not close the session', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = await openWordSnap(page);
  await expect(overlay.locator('.ws-panel')).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => {
    const body = document.getElementById('message-body')!;
    body.style.display = 'none';
    // Force a couple of mutation scans while hidden.
    document.body.appendChild(document.createElement('i'));
    setTimeout(() => {
      body.style.display = '';
      document.body.appendChild(document.createElement('i'));
    }, 350);
  });
  await page.waitForTimeout(1200);
  await expect(page.locator('wordsnap-overlay')).toHaveCount(1);
  await expect(page.locator('wordsnap-overlay .ws-panel')).toBeVisible();
});
