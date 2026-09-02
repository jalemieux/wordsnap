// Gmail compose. Select on ARIA and Gmail's own g_editable flag, never on class names.
// Caveat: aria-label="Message Body" is localized; g_editable and role=textbox inside a dialog cover other locales.
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
    root.querySelectorAll<HTMLElement>(BODY_SELECTOR).forEach((body) => {
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
    });
    return out;
  },
};
