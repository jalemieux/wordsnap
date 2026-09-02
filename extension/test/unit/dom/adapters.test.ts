// @vitest-environment happy-dom
import { adapterFor, adapters, activateGeneric, deactivateGeneric } from '../../../src/adapters';
import { ContenteditableComposer, TextareaComposer } from '../../../src/adapters/base';
import { gmailAdapter } from '../../../src/adapters/gmail';
import { SAMPLE_TEXT } from '../../../src/shared/sample';
import { loadFixture } from './helpers';

describe('adapterFor', () => {
  afterEach(() => document.documentElement.removeAttribute('data-wordsnap-host'));

  it('matches hosts by URL', () => {
    expect(adapterFor(new URL('https://mail.google.com/mail/u/0/#inbox'))?.id).toBe('gmail');
    expect(adapterFor(new URL('https://x.com/compose/post'))?.id).toBe('x');
    expect(adapterFor(new URL('https://twitter.com/home'))?.id).toBe('x');
    expect(adapterFor(new URL('https://www.linkedin.com/feed/'))?.id).toBe('linkedin');
    expect(adapterFor(new URL('https://example.com/'))).toBeNull();
  });

  it('never returns the generic adapter from a URL match, even when active', () => {
    activateGeneric();
    expect(adapterFor(new URL('https://example.com/'))).toBeNull();
    deactivateGeneric();
  });

  it('honours the dev override from the query string and from <html data-wordsnap-host>', () => {
    expect(adapterFor(new URL('http://127.0.0.1:4173/gmail.html?wordsnap-host=x'))?.id).toBe('x');
    document.documentElement.setAttribute('data-wordsnap-host', 'linkedin');
    expect(adapterFor(new URL('http://localhost/anything'))?.id).toBe('linkedin');
  });

  it('registers all four adapters', () => {
    expect(adapters.map((a) => a.id)).toEqual(['gmail', 'x', 'linkedin', 'generic']);
  });
});

describe('gmail adapter', () => {
  beforeEach(() => loadFixture('gmail-compose.html'));

  it('finds exactly one composer with email platform and a stable handle', () => {
    const first = gmailAdapter.findComposers(document);
    expect(first).toHaveLength(1);
    expect(first[0]!.platform).toEqual({ kind: 'email' });
    expect(first[0]!.getSnapshot().text).toBe(SAMPLE_TEXT);
    const second = gmailAdapter.findComposers(document);
    expect(second[0]).toBe(first[0]);
    expect(second[0]!.key).toBe(first[0]!.key);
  });

  it('reads subject and recipients as context and anchors to the dialog', () => {
    const h = gmailAdapter.findComposers(document)[0]!;
    expect(h.getContext?.()).toEqual({ subject: 'Proposal: a four-day week pilot for Q4', recipients: ['leadership@brightline.co'] });
    expect(h.isAlive()).toBe(true);
    expect(typeof h.anchorRect().width).toBe('number');
    expect(h.scrollParent()).toBeTruthy();
  });

  it('is not alive once the composer is removed', () => {
    const h = gmailAdapter.findComposers(document)[0]!;
    document.querySelector('[role="dialog"]')!.remove();
    expect(h.isAlive()).toBe(false);
  });
});

describe('x and linkedin adapters', () => {
  it('x: one composer per tweetTextarea with a 280 limit', () => {
    loadFixture('x-composer.html');
    const a = adapterFor(new URL('https://x.com/home'))!;
    const found = a.findComposers(document);
    expect(found).toHaveLength(1);
    expect(found[0]!.platform).toEqual({ kind: 'post', charLimit: 280 });
    expect(found[0]!.getSnapshot().text.startsWith('Hi all,\n\nI want')).toBe(true);
  });

  it('linkedin: one composer with a 3000 limit', () => {
    loadFixture('linkedin-share.html');
    const a = adapterFor(new URL('https://www.linkedin.com/feed/'))!;
    const found = a.findComposers(document);
    expect(found).toHaveLength(1);
    expect(found[0]!.platform).toEqual({ kind: 'post', charLimit: 3000 });
  });
});

describe('generic adapter', () => {
  afterEach(() => deactivateGeneric());

  it('returns nothing until activated, then finds long editables and textareas only', () => {
    const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
    document.body.innerHTML = `<div contenteditable="true" id="long">${long}</div><div contenteditable="true">short</div><textarea id="ta">${long}</textarea><textarea>short</textarea>`;
    const generic = adapters.find((a) => a.id === 'generic')!;
    expect(generic.findComposers(document)).toHaveLength(0);
    activateGeneric();
    const found = generic.findComposers(document);
    expect(found).toHaveLength(2);
    expect(found[0]).toBeInstanceOf(ContenteditableComposer);
    expect(found[1]).toBeInstanceOf(TextareaComposer);
  });
});

describe('applyEdit', () => {
  beforeEach(() => loadFixture('gmail-compose.html'));

  it('selects the range and uses execCommand insertText when the editor supports it', () => {
    const h = gmailAdapter.findComposers(document)[0]!;
    const snap = h.getSnapshot();
    const quote = 'not a single company went back to five days';
    const start = snap.text.indexOf(quote);
    const replacement = '56 of the 61 companies kept it';
    const exec = vi.fn((cmd: string, _ui: boolean, value: string) => {
      // Emulate the browser: replace the current selection with the value.
      const sel = window.getSelection()!;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(value));
      return cmd === 'insertText';
    });
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    const ok = h.applyEdit({ start, end: start + quote.length }, replacement);
    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith('insertText', false, replacement);
    expect(h.getSnapshot().text).toContain(`In the UK's 2022 pilot, ${replacement}.`);
    expect(h.getSnapshot().text).not.toContain(quote);
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it('refuses to write directly when execCommand is unavailable on a site adapter', () => {
    const h = gmailAdapter.findComposers(document)[0]!;
    const snap = h.getSnapshot();
    const start = snap.text.indexOf('productivity jumped 40%');
    expect(h.applyEdit({ start, end: start + 'productivity jumped 40%'.length }, 'x')).toBe(false);
    expect(h.getSnapshot().text).toBe(SAMPLE_TEXT);
  });

  it('generic adapter falls back to a direct text replacement and fires input', () => {
    const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
    document.body.innerHTML = `<div contenteditable="true" id="g">${long}</div>`;
    activateGeneric();
    const h = adapters.find((a) => a.id === 'generic')!.findComposers(document)[0]!;
    const inputs = vi.fn();
    h.element.addEventListener('input', inputs);
    const start = h.getSnapshot().text.indexOf('word10');
    expect(h.applyEdit({ start, end: start + 'word10'.length }, 'REPLACED')).toBe(true);
    expect(h.getSnapshot().text).toContain('word9 REPLACED word11');
    expect(inputs).toHaveBeenCalled();
    deactivateGeneric();
  });

  it('returns false when the span no longer matches the DOM', () => {
    const h = gmailAdapter.findComposers(document)[0]!;
    h.getSnapshot();
    expect(h.applyEdit({ start: 10, end: 5 }, 'x')).toBe(false);
  });
});

describe('onChange', () => {
  it('coalesces input events and delivers a fresh snapshot', async () => {
    vi.useFakeTimers();
    loadFixture('gmail-compose.html');
    const h = gmailAdapter.findComposers(document)[0]!;
    const cb = vi.fn();
    const off = h.onChange(cb);
    const body = document.getElementById('message-body')!;
    body.firstElementChild!.textContent = 'Hello team,';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    body.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(60);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0].text.startsWith('Hello team,')).toBe(true);
    off();
    body.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(60);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
