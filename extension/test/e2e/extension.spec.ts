// End to end: dev build of the extension loaded in Chromium, mock provider, fake Gmail compose page.
import { test, expect } from './fixtures';

const FIXTURE = 'http://127.0.0.1:4173/gmail-compose.html';

test.beforeEach(async ({ context, extensionId }) => {
  // Switch to the mock provider through the options page (dev builds expose it). Setup then tests the connection
  // on its own and ends on the "setup complete" screen with the badge to look for; Settings leaves it.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: /use the mock provider/i }).click();
  await expect(page.getByRole('heading', { name: 'Setup complete' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.compose-badge')).toHaveText('W');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('select').first()).toHaveValue('mock', { timeout: 10_000 });
  await page.close();
  // Challenge is off by default; these tests assert on the challenge rows, so turn every check on.
  const [worker] = context.serviceWorkers();
  await worker!.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as { settings: Record<string, unknown> };
    await chrome.storage.local.set({ settings: { ...settings, checks: { structure: true, elaborate: false, polish: true, facts: true, challenge: true } } });
  });
});

async function openWordSnap(page: import('@playwright/test').Page) {
  const overlay = page.locator('wordsnap-overlay');
  await expect(overlay).toHaveCount(1);
  // Nothing but the badge until the user asks.
  await expect(overlay.locator('.ws-panel')).toHaveCount(0);
  await overlay.locator('.ws-launcher').click();
  return overlay;
}

test('analyzes the draft, shows highlights and the panel', async ({ context }) => {
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

  // The summary row counts the contradicted claim while it is open.
  await expect(panel.locator('.ws-summary')).toContainText(/1 contradicted/);
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
  const summary = overlay.locator('.ws-panel .ws-summary');
  await expect(summary).toContainText(/1 contradicted/);
  await expect(summary).toContainText(/1 needs precision/);

  await card.getByRole('button', { name: /apply change/i }).click();

  // The host editor now contains the replacement and no longer the original phrase.
  const body = page.locator('#message-body');
  await expect(body).toContainText('56 of the 61 companies kept it');
  await expect(body).not.toContainText('not a single company went back to five days');

  // The paragraph is re-checked at once: only the needs-precision claim remains open, the fixed span is no longer red,
  // and the host's echo of the edit does not leave the draft marked as changed.
  await expect(summary).toContainText(/0 contradicted/, { timeout: 15_000 });
  await expect(summary).toContainText(/1 needs precision/);
  await expect(overlay.locator('.ws-hl-layer [role="button"][data-status="contradicted"]')).toHaveCount(0);
  await expect(overlay.locator('.ws-panel .ws-status')).toContainText(/checked/i, { timeout: 15_000 });
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

  // On demand: the edit marks the draft changed and nothing runs until Re-analyze.
  await expect(panel.locator('.ws-status')).toHaveText(/draft changed/i, { timeout: 5_000 });
  const reanalyze = panel.locator('.ws-reanalyze');
  await expect(reanalyze).toBeEnabled();
  await reanalyze.click();
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

test('the check chips gate what runs: Challenge off drops the rows, on again needs Re-analyze', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = await openWordSnap(page);
  const panel = overlay.locator('.ws-panel');
  await expect(panel.locator('.ws-ch-row')).toHaveCount(4, { timeout: 15_000 });
  await expect(panel.locator('.ws-pick[data-check="challenge"]')).toHaveAttribute('aria-pressed', 'true');

  // Off: the challenges go away at once, nothing runs, and there is nothing to re-analyze.
  await panel.locator('.ws-pick[data-check="challenge"]').click();
  await expect(panel.locator('.ws-pick[data-check="challenge"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.locator('.ws-ch-row')).toHaveCount(0);
  await expect(panel.locator('.ws-off')).toContainText(/turn on challenge/i);
  await expect(panel.locator('.ws-status')).toContainText(/checked/i);
  await expect(panel.locator('.ws-reanalyze')).toBeDisabled();

  // On again: the pill says why, Re-analyze lights up, and the rows come back only after it is pressed.
  await panel.locator('.ws-off .link').click();
  await expect(panel.locator('.ws-pick[data-check="challenge"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.ws-ch-row')).toHaveCount(0);
  await expect(panel.locator('.ws-status')).toContainText(/checks changed/i);
  await expect(panel.locator('.ws-reanalyze')).toBeEnabled();
  await panel.locator('.ws-reanalyze').click();
  await expect(panel.locator('.ws-ch-row')).toHaveCount(4, { timeout: 15_000 });
  await expect(panel.locator('.ws-status')).toContainText(/checked/i);
});

/** Replace the fixture body with the dictated version of the same email (Gmail markup: one div per line, <div><br></div> between). */
async function setDictatedDraft(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const paras = [
      'Hi all,',
      "ok so I've been going back and forth on this, um, everyone I've talked to on the team wants this, so I don't think we have a retention risk to worry about, if anything this becomes our best recruiting story, closer to home I mean.",
      "When Microsoft Japan tried it in 2019, productivity jumped 40%. Iceland ran trials covering more than 1% of its entire workforce, and the results were good enough that most unions negotiated shorter hours afterward. In the UK's 2022 pilot, not a single company went back to five days. So yeah the evidence is stronger than people assume.",
      "Anyway what I want is to put a four-day work week pilot on the table for Q4. I'd suggest a three-month pilot for engineering and design, with a checkpoint at six weeks, and support and sales can follow once we've worked out coverage I guess. Can we get 20 minutes on Thursday's agenda?",
      '— Jordan',
    ];
    const body = document.getElementById('message-body')!;
    body.innerHTML = paras.map((p) => `<div>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('<div><br></div>');
  });
}

test('a dictated draft gets a structure proposal; Apply structure reorders the editor and the passes run on the result', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  await setDictatedDraft(page);
  const overlay = await openWordSnap(page);
  const panel = overlay.locator('.ws-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // The proposal shows first, beside or over the draft, and the other passes wait.
  const section = panel.locator('.ws-structure');
  await expect(section).toHaveAttribute('data-status', 'open', { timeout: 15_000 });
  const compare = overlay.locator('.ws-compare');
  await expect(compare).toBeVisible();
  // The fixture's compose is 600px wide: no room for two columns, so the pane sits over the draft.
  await expect(compare).toHaveAttribute('data-mode', 'over');
  const paras = compare.locator('.ws-cmp-sec');
  await expect(paras).toHaveCount(7);
  await expect(paras.first().locator('.ws-cmp-text')).toHaveText('Hi all,');
  await expect(paras.first().locator('h4')).toContainText(/greeting/i);
  await expect(paras.nth(1).locator('.ws-cmp-text')).toContainText('I want to put a four-day work week pilot');
  // A reorder now carries the job of each paragraph and what it lacks.
  await expect(paras.nth(1).locator('.ws-cmp-job')).toHaveText(/what you want/i);
  await expect(paras.nth(2).locator('.ws-cmp-gap')).toContainText(/Iceland/);
  await expect(paras.nth(1).locator('h4')).toContainText(/ask/i);
  await expect(paras.nth(1).locator('h4')).toContainText(/1 moved/);
  await expect(compare.locator('.ws-cmp-cuts')).toContainText(/Drops/);
  await expect(panel.locator('.ws-status')).toContainText(/structure proposed/i);
  await expect(panel.locator('.ws-reanalyze')).toBeDisabled();
  await expect(panel.locator('.ws-ch-row')).toHaveCount(0);
  // The panel shrinks to a line while the pane is up: the buttons are in the pane.
  await expect(section).toContainText(/beside your draft/i);
  await expect(section.locator('[data-act="apply-structure"]')).toHaveCount(0);

  await compare.locator('[data-act="apply-structure"]').click();
  await expect(compare).toHaveCount(0);

  // The host editor now reads in the proposed order, paragraph breaks intact, and the old filler is gone.
  const body = page.locator('#message-body');
  await expect(body).not.toContainText("ok so I've been going back and forth");
  const text = await body.evaluate((el) => (el as HTMLElement).innerText.replace(/\n{2,}/g, '\n\n').trim());
  expect(text.startsWith('Hi all,\n\nI want to put a four-day work week pilot on the table for Q4.\n\nThe evidence is stronger')).toBe(true);
  expect(text.endsWith('— Jordan')).toBe(true);
  // The host's own undo stack has the edit.
  await body.click();
  await expect(section).toHaveAttribute('data-status', 'applied');

  // Then the passes run on the reordered text: findings anchor, challenges list.
  await expect(panel.locator('.ws-ch-row')).toHaveCount(4, { timeout: 20_000 });
  await expect(overlay.locator('.ws-hl-layer [role="button"][data-status="contradicted"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(panel.locator('.ws-summary')).toContainText(/1 contradicted/);
});

test('Keep mine dismisses the proposal and analyzes the draft as written', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  await setDictatedDraft(page);
  const overlay = await openWordSnap(page);
  const panel = overlay.locator('.ws-panel');
  const section = panel.locator('.ws-structure');
  await expect(section).toHaveAttribute('data-status', 'open', { timeout: 15_000 });
  await overlay.locator('.ws-compare [data-act="keep-structure"]').click();
  await expect(overlay.locator('.ws-compare')).toHaveCount(0);
  await expect(section).toHaveAttribute('data-status', 'kept');
  await expect(section).toContainText(/kept your order/i);
  await expect(page.locator('#message-body')).toContainText("ok so I've been going back and forth");
  // Three of the four canned challenges anchor in the dictated wording (the coverage sentence reads differently there).
  await expect(panel.locator('.ws-ch-row')).toHaveCount(3, { timeout: 20_000 });
});

test('in a wide compose the proposal sits beside the draft: the editor makes room, tags mark where each paragraph starts, hover links the two', async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(FIXTURE);
  await page.evaluate(() => {
    (document.querySelector('.compose') as HTMLElement).style.width = '1200px';
  });
  await setDictatedDraft(page);
  const overlay = await openWordSnap(page);
  const compare = overlay.locator('.ws-compare');
  await expect(compare).toBeVisible({ timeout: 15_000 });
  await expect(compare).toHaveAttribute('data-mode', 'beside');

  // The host editor gave up its right half through a padding, nothing else changed on it.
  const body = page.locator('#message-body');
  const padding = await body.evaluate((el) => parseInt(getComputedStyle(el).paddingRight, 10));
  expect(padding).toBeGreaterThan(300);
  const editorBox = (await body.boundingBox())!;
  const paneBox = (await compare.boundingBox())!;
  expect(paneBox.x + paneBox.width).toBeLessThanOrEqual(editorBox.x + editorBox.width + 1);
  expect(paneBox.x).toBeGreaterThan(editorBox.x + editorBox.width - padding - 1);

  // One tag per paragraph start in the draft, plus one on the sentence that moves.
  const pills = overlay.locator('.ws-cmp-pill');
  await expect(pills.first()).toBeVisible();
  const labels = await pills.allTextContents();
  expect(labels).toContain('¶1');
  expect(labels).toContain('¶2.1');
  // The cut filler is marked in the draft.
  await expect(overlay.locator('.ws-cmp-cut').first()).toBeVisible();

  // Hovering the second proposed paragraph lights its source sentence in the draft.
  await compare.locator('.ws-cmp-sec').nth(1).hover();
  await expect(overlay.locator('.ws-cmp-hot').first()).toBeVisible();
  await expect(compare.locator('.ws-cmp-sec').nth(1)).toHaveClass(/is-hot/);

  // Keep restores the editor's own style.
  await compare.locator('[data-act="keep-structure"]').click();
  await expect(compare).toHaveCount(0);
  expect(await body.evaluate((el) => el.style.paddingRight)).toBe('');
});

test('Elaborate: notes get a skeleton; Apply seeds the draft with the fragments, the guide tracks what is written, Done hands the draft to Structure', async ({ context, extensionId: _id }) => {
  // The Elaborate chip is the request; the text is not inspected for it.
  const [worker] = context.serviceWorkers();
  await worker!.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as { settings: Record<string, unknown> };
    await chrome.storage.local.set({ settings: { ...settings, checks: { structure: false, elaborate: true, polish: true, facts: true, challenge: true } } });
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto(FIXTURE);
  await page.evaluate(() => {
    (document.querySelector('.compose') as HTMLElement).style.width = '1200px';
    // Notes, one line each: who it is for, then the points, in no particular order.
    const lines = [
      'Email to leadership about a four-day week pilot.',
      "Ask: 20 minutes on Thursday's agenda.",
      'The evidence: Microsoft Japan 2019, 40% productivity; Iceland trials; the UK 2022 pilot, nobody went back to five days.',
      'Everyone on the team wants it, recruiting story.',
      'Plan: three months, engineering and design first, checkpoint at six weeks.',
    ];
    document.getElementById('message-body')!.innerHTML = lines.map((p) => `<div>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('');
  });
  const overlay = await openWordSnap(page);
  const panel = overlay.locator('.ws-panel');
  const compare = overlay.locator('.ws-compare');
  await expect(compare).toHaveAttribute('data-kind', 'outline', { timeout: 15_000 });
  await expect(compare).toHaveAttribute('data-status', 'open');
  await expect(panel.locator('.ws-status')).toContainText(/skeleton proposed/i);
  await expect(panel.locator('.ws-pick[data-check="elaborate"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.ws-pick[data-check="structure"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.locator('.ws-stage.now')).toHaveText(/elaborate/i);

  // Five slots: role, job, the fragment placed there, and what is missing.
  const slots = compare.locator('.ws-cmp-slot');
  await expect(slots).toHaveCount(5);
  await expect(slots.nth(0).locator('h4')).toContainText(/ask/i);
  await expect(slots.nth(0)).toContainText("20 minutes on Thursday's agenda");
  await expect(slots.nth(1).locator('.ws-cmp-gap')).toContainText(/Missing: Which teams/);
  await expect(compare.locator('.ws-cmp-cuts')).toContainText(/Not in the message: “Email to leadership/);
  // The fragments are tagged in the notes with the slot they feed.
  await expect(overlay.locator('.ws-cmp-pill').first()).toBeVisible();

  await compare.locator('[data-act="apply-outline"]').click();

  // The editor holds the four placed fragments in the outline's order and nothing else; the pane stays as a guide.
  const body = page.locator('#message-body');
  await expect(body).not.toContainText('Email to leadership');
  const text = await body.evaluate((el) => (el as HTMLElement).innerText.replace(/\n{2,}/g, '\n\n').trim());
  expect(text).toBe(
    [
      "Ask: 20 minutes on Thursday's agenda.",
      'The evidence: Microsoft Japan 2019, 40% productivity; Iceland trials; the UK 2022 pilot, nobody went back to five days.',
      'Everyone on the team wants it, recruiting story.',
      'Plan: three months, engineering and design first, checkpoint at six weeks.',
    ].join('\n\n'),
  );
  await expect(compare).toHaveAttribute('data-status', 'guiding');
  await expect(slots.nth(0).locator('.ws-cmp-fill')).toHaveText(/fragment is in place/i);
  await expect(slots.nth(1).locator('.ws-cmp-fill')).toHaveText(/nothing here yet/i);
  await expect(panel.locator('.ws-status')).toContainText(/writing into the skeleton/i);
  await expect(panel.locator('.ws-structure')).toHaveAttribute('data-status', 'guiding');
  await expect(panel.locator('.ws-stage.now')).toHaveText(/write/i);
  await expect(panel.locator('.ws-picks')).toHaveClass(/dim/);

  // Writing into the first paragraph marks it written, with no run and without closing the guide.
  await body.locator('div').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' We need a decision before the offsite and twenty minutes is enough.');
  await expect(slots.nth(0).locator('.ws-cmp-fill')).toHaveText(/written/i, { timeout: 5_000 });
  await expect(compare).toHaveAttribute('data-status', 'guiding');
  await expect(compare.locator('.ws-cmp-sub')).toContainText(/1 of 5 written/);

  // Done closes the guide and runs the checks on what was written; the structure pass reads the result as a draft.
  await compare.locator('[data-act="outline-done"]').click();
  await expect(compare).toHaveCount(0);
  // Done hands the draft to the ordinary structure pass: the pair flips to Structure, the stage line reads Check.
  await expect(panel.locator('.ws-pick[data-check="structure"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.ws-pick[data-check="elaborate"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.locator('.ws-stage.now')).toHaveText(/check/i);
  await expect(panel.locator('.ws-structure')).toContainText(/order holds/i, { timeout: 15_000 });
  await expect(panel.locator('.ws-status')).toContainText(/checked/i, { timeout: 20_000 });
  expect(await body.evaluate((el) => el.style.paddingRight)).toBe('');
  const saved = await worker!.evaluate(async () => ((await chrome.storage.local.get('settings')) as { settings: { checks: Record<string, boolean> } }).settings.checks);
  expect(saved.structure).toBe(true);
  expect(saved.elaborate).toBe(false);
});

test('Rewrite lets the user type their own wording; Apply edits the draft and the span is re-checked', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const overlay = await openWordSnap(page);
  const contradicted = overlay.locator('.ws-hl-layer [role="button"][data-status="contradicted"]').first();
  await expect(contradicted).toBeVisible({ timeout: 15_000 });
  await contradicted.click();
  const card = overlay.locator('[aria-label="Fact check"]');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Rewrite' }).click();

  const box = card.locator('.ws-rewrite-t');
  await expect(box).toBeVisible();
  await expect(box).toHaveValue('56 of the 61 companies kept it'); // prefilled with the suggestion
  await box.fill('most of the companies stayed on four days');
  // Typing in the box must not reach the host page (its shortcuts see the shadow host as the target).
  await expect(page.locator('#message-body')).not.toContainText('most of the companies');
  await card.locator('[data-act="apply-rewrite"]').click();

  const body = page.locator('#message-body');
  await expect(body).toContainText('most of the companies stayed on four days');
  await expect(body).not.toContainText('not a single company went back to five days');
  await expect(overlay.locator('.ws-toast')).toContainText(/applied your wording/i);

  // The re-check ran on that paragraph: the contradicted highlight is gone and the summary reflects it.
  const summary = overlay.locator('.ws-panel .ws-summary');
  await expect(summary).toContainText(/0 contradicted/, { timeout: 15_000 });
  await expect(overlay.locator('.ws-hl-layer [role="button"][data-status="contradicted"]')).toHaveCount(0);
  await expect(overlay.locator('.ws-panel .ws-status')).toContainText(/checked/i, { timeout: 15_000 });
});
