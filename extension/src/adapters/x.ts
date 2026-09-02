// X / Twitter composer (Draft.js). Each thread post is its own composer; the frame is the dialog or the timeline card.
// Caveat to verify live: Draft.js must accept execCommand('insertText') for applyEdit; the spike in M0 checks this.
import { ContenteditableComposer, cachedHandle, ensureKey } from './base';
import type { ComposerHandle, HostAdapter } from './types';

const BODY_SELECTOR = 'div[data-testid^="tweetTextarea_"][contenteditable="true"]';

function frameOf(body: HTMLElement): HTMLElement | null {
  return (
    (body.closest('[role="dialog"]') as HTMLElement | null) ??
    (body.closest('form') as HTMLElement | null) ??
    (body.closest('[data-testid="primaryColumn"] > div > div') as HTMLElement | null) ??
    (body.closest('article') as HTMLElement | null)
  );
}

export const xAdapter: HostAdapter = {
  id: 'x',
  matches(url) {
    return url.hostname === 'x.com' || url.hostname === 'twitter.com' || url.hostname.endsWith('.x.com') || url.hostname.endsWith('.twitter.com');
  },
  findComposers(root) {
    const out: ComposerHandle[] = [];
    root.querySelectorAll<HTMLElement>(BODY_SELECTOR).forEach((body) => {
      const key = ensureKey(body, 'x');
      out.push(
        cachedHandle(body, () =>
          new ContenteditableComposer({
            key,
            root: body,
            platform: { kind: 'post', charLimit: 280 },
            anchorElement: () => frameOf(body),
          }),
        ),
      );
    });
    return out;
  },
};
