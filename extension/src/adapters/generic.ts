// Generic adapter: any contenteditable or textarea with >= 40 words, on any page, but only after the user
// asks for it (toolbar click). It never auto-detects. Call activateGeneric() to switch it on for this page.
import { ContenteditableComposer, TextareaComposer, cachedHandle, countWords, ensureKey } from './base';
import type { ComposerHandle, HostAdapter } from './types';

let active = false;
export const GENERIC_MIN_WORDS = 40;

export function activateGeneric(): void {
  active = true;
}
export function deactivateGeneric(): void {
  active = false;
}
export function isGenericActive(): boolean {
  return active;
}

export const genericAdapter: HostAdapter = {
  id: 'generic',
  matches() {
    return active;
  },
  findComposers(root) {
    if (!active) return [];
    const out: ComposerHandle[] = [];
    root.querySelectorAll<HTMLElement>('[contenteditable="true"], [contenteditable=""]').forEach((el) => {
      if (el.hasAttribute('data-wordsnap')) return;
      // Prefer the outermost editable root.
      if (el.parentElement?.closest('[contenteditable="true"]')) return;
      if (countWords(el.textContent ?? '') < GENERIC_MIN_WORDS) return;
      const key = ensureKey(el, 'generic');
      out.push(
        cachedHandle(el, () =>
          new ContenteditableComposer({ key, root: el, platform: { kind: 'post' }, allowDirectReplace: true }),
        ),
      );
    });
    root.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((ta) => {
      if (ta.disabled || ta.readOnly || countWords(ta.value) < GENERIC_MIN_WORDS) return;
      const key = ensureKey(ta, 'generic');
      out.push(cachedHandle(ta, () => new TextareaComposer(key, ta, { kind: 'post' })));
    });
    return out;
  },
};
