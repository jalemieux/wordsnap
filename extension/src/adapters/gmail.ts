// Gmail compose. Select on ARIA and Gmail's own g_editable flag, never on class names.
// Caveat: aria-label="Message Body" is localized; g_editable and role=textbox inside a dialog cover other locales.
// One composer per compose window: Gmail's Gemini bar ("Describe your change") is also a contenteditable textbox
// inside the same dialog, so candidates are grouped by frame and the message body wins over any other textbox.
import { ContenteditableComposer, cachedHandle, ensureKey } from './base';
import type { ComposerHandle, HostAdapter } from './types';

const BODY_SELECTOR = [
  'div[aria-label="Message Body"][contenteditable="true"]',
  'div[g_editable="true"][contenteditable="true"]',
  '[role="dialog"] div[role="textbox"][contenteditable="true"]',
  'form div[role="textbox"][contenteditable="true"][aria-multiline="true"]',
].join(', ');

function frameOf(body: HTMLElement): HTMLElement | null {
  return (body.closest('[role="dialog"]') as HTMLElement | null) ?? (body.closest('form') as HTMLElement | null);
}

function readContext(body: HTMLElement) {
  const frame = frameOf(body) ?? body.ownerDocument.body;
  const subject = (frame.querySelector('input[name="subjectbox"]') as HTMLInputElement | null)?.value?.trim() || undefined;
  const recipients = Array.from(frame.querySelectorAll('[email], [data-hovercard-id]'))
    .map((el) => el.getAttribute('email') ?? el.getAttribute('data-hovercard-id') ?? '')
    .filter((s) => s.includes('@'));
  return { subject, recipients: Array.from(new Set(recipients)) };
}

export const gmailAdapter: HostAdapter = {
  id: 'gmail',
  matches(url) {
    return url.hostname === 'mail.google.com';
  },
  findComposers(root) {
    const out: ComposerHandle[] = [];
    for (const body of pickBodies(root)) {
      const frame = frameOf(body);
      const key = ensureKey(frame ?? body, 'gmail');
      out.push(
        cachedHandle(body, () =>
          new ContenteditableComposer({
            key,
            root: body,
            platform: { kind: 'email' },
            anchorElement: () => frameOf(body),
            getContext: () => readContext(body),
          }),
        ),
      );
    }
    return out;
  },
};

/** Gmail marks the real message body with g_editable; the localized aria-label is the next best signal. */
function isMessageBody(el: HTMLElement): boolean {
  return el.getAttribute('g_editable') === 'true' || el.getAttribute('aria-label') === 'Message Body';
}

/** At most one body per frame: the marked message body if there is one, else the largest multiline textbox. */
export function pickBodies(root: ParentNode): HTMLElement[] {
  const byFrame = new Map<HTMLElement | null, HTMLElement[]>();
  root.querySelectorAll<HTMLElement>(BODY_SELECTOR).forEach((el) => {
    const frame = frameOf(el);
    const list = byFrame.get(frame) ?? [];
    list.push(el);
    byFrame.set(frame, list);
  });
  const out: HTMLElement[] = [];
  for (const [frame, list] of byFrame) {
    if (!frame) {
      out.push(...list);
      continue;
    }
    const marked = list.find(isMessageBody);
    if (marked) {
      out.push(marked);
      continue;
    }
    const multiline = list.filter((el) => el.getAttribute('aria-multiline') === 'true');
    const pool = multiline.length ? multiline : list;
    out.push(pool.reduce((best, el) => (area(el) > area(best) ? el : best)));
  }
  return out;
}

function area(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}
