// LinkedIn share box and comment boxes (Quill).
import { ContenteditableComposer, cachedHandle, ensureKey } from './base';
import type { ComposerHandle, HostAdapter } from './types';

const BODY_SELECTOR = 'div.ql-editor[contenteditable="true"]';

function frameOf(body: HTMLElement): HTMLElement | null {
  return (
    (body.closest('[role="dialog"]') as HTMLElement | null) ??
    (body.closest('.share-box, .share-creation-state, form') as HTMLElement | null)
  );
}

export const linkedinAdapter: HostAdapter = {
  id: 'linkedin',
  matches(url) {
    return url.hostname === 'www.linkedin.com' || url.hostname === 'linkedin.com';
  },
  findComposers(root) {
    const out: ComposerHandle[] = [];
    root.querySelectorAll<HTMLElement>(BODY_SELECTOR).forEach((body) => {
      const key = ensureKey(frameOf(body) ?? body, 'linkedin');
      out.push(
        cachedHandle(body, () =>
          new ContenteditableComposer({
            key,
            root: body,
            platform: { kind: 'post', charLimit: 3000 },
            anchorElement: () => frameOf(body),
          }),
        ),
      );
    });
    return out;
  },
};
