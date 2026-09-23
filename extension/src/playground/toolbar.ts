// The playground's floating strip: switch fixture, pick a provider, load a sample draft, inspect the session state
// the background is sending. Plain DOM in its own shadow root so fixture CSS and the overlay never touch it.
import { SAMPLE_DICTATED_TEXT, SAMPLE_IDEA_TEXT, SAMPLE_TEXT } from '../shared/sample';
import type { Settings } from '../shared/types';
import type { ChromeShim, Traffic } from './chrome-shim';

export const FIXTURES: { slug: string; label: string; file: string }[] = [
  { slug: 'gmail', label: 'Gmail', file: 'gmail-compose.html' },
  { slug: 'x', label: 'X', file: 'x-composer.html' },
  { slug: 'linkedin', label: 'LinkedIn', file: 'linkedin-share.html' },
  { slug: 'any-site', label: 'Any site', file: 'any-site.html' },
];

const DRAFTS: { label: string; text: string }[] = [
  { label: 'Sample: four-day week (prose)', text: SAMPLE_TEXT },
  { label: 'Sample: dictated notes', text: SAMPLE_DICTATED_TEXT },
  { label: 'Sample: idea fragments', text: SAMPLE_IDEA_TEXT },
  { label: 'Empty', text: '' },
];

const CSS = `
:host { all: initial; }
.bar { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; font: 12px/1.4 system-ui, sans-serif; color: #1f2a2e;
  background: #fff; border: 1px solid #cfd8dc; border-radius: 10px; box-shadow: 0 4px 18px rgba(0,0,0,.14); max-width: min(560px, calc(100vw - 24px)); }
.row { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; padding: 8px 10px; }
.row + .row { border-top: 1px solid #eceff1; }
.brand { font-weight: 600; color: #0b7285; margin-right: 4px; }
a, .link { color: #0b7285; text-decoration: none; cursor: pointer; }
a.on { font-weight: 600; text-decoration: underline; }
label { display: inline-flex; align-items: center; gap: 4px; }
select, input { font: inherit; padding: 2px 4px; border: 1px solid #cfd8dc; border-radius: 4px; background: #fff; color: inherit; }
input[type=password] { width: 200px; }
button { font: inherit; padding: 2px 8px; border: 1px solid #0b7285; border-radius: 4px; background: #0b7285; color: #fff; cursor: pointer; }
button.quiet { background: #fff; color: #0b7285; }
.muted { color: #607d8b; }
.inspect { display: none; max-height: 40vh; overflow: auto; border-top: 1px solid #eceff1; }
.inspect.open { display: block; }
pre { margin: 0; padding: 8px 10px; font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
.traffic { padding: 6px 10px; border-bottom: 1px solid #eceff1; color: #455a64; font: 11px/1.4 ui-monospace, monospace; }
.traffic div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

interface ToolbarDeps {
  shim: ChromeShim;
  /** The fixture slug this page is on, if any. */
  fixture: string | null;
  /** The editor a sample draft is written into. */
  editor(): HTMLElement | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

async function readSettings(): Promise<Partial<Settings>> {
  const res = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> };
  return res.settings ?? {};
}

async function writeSettings(patch: Partial<Settings>): Promise<void> {
  const current = await readSettings();
  await chrome.storage.local.set({ settings: { ...current, ...patch, openrouter: { ...(current.openrouter ?? {}), ...(patch.openrouter ?? {}) } } });
}

/** Replace the editor's content the way Apply does: select all, insertText. Fires input events, keeps host undo. */
function writeDraft(editor: HTMLElement, text: string): void {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  if (editor instanceof HTMLTextAreaElement) {
    editor.value = text;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return;
  }
  if (!document.execCommand('insertText', false, text)) {
    editor.textContent = text;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

export function mountToolbar(deps: ToolbarDeps): void {
  const host = el('div', { id: 'wordsnap-playground' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', {}, [CSS]));
  const bar = el('div', { class: 'bar' });
  root.append(bar);
  document.body.append(host);

  // Row 1: where we are, where to go.
  const nav = el('div', { class: 'row' }, [el('span', { class: 'brand' }, ['WordSnap playground'])]);
  for (const f of FIXTURES) nav.append(el('a', { href: `/${f.slug}`, class: f.slug === deps.fixture ? 'on' : '' }, [f.label]));
  nav.append(el('a', { href: '/options', target: '_blank' }, ['Settings page']));
  const hide = el('span', { class: 'link muted', title: 'Hide this strip (reload to bring it back)' }, ['hide']);
  hide.style.marginLeft = 'auto';
  hide.addEventListener('click', () => host.remove());
  nav.append(hide);
  bar.append(nav);

  // Row 2: provider, auto mode, draft, reset, inspector.
  const controls = el('div', { class: 'row' });
  const provider = el('select', { title: 'Which provider the background uses' });
  provider.append(el('option', { value: 'mock' }, ['Mock provider']), el('option', { value: 'openrouter' }, ['OpenRouter']));
  const key = el('input', { type: 'password', placeholder: 'sk-or-v1-… (stays in this browser)', autocomplete: 'off' });
  const save = el('button', {}, ['Save & reload']);
  const auto = el('input', { type: 'checkbox' });
  const draft = el('select', { title: 'Write a sample into the composer' });
  draft.append(el('option', { value: '' }, ['Load a draft…']));
  DRAFTS.forEach((d, i) => draft.append(el('option', { value: String(i) }, [d.label])));
  const reset = el('button', { class: 'quiet', title: 'Clear the playground storage (settings, key, claim cache) and reload' }, ['Reset']);
  const inspect = el('button', { class: 'quiet' }, ['Inspect']);
  controls.append(
    el('label', {}, ['Provider ', provider]),
    key,
    save,
    el('label', { title: 'settings.autoAnalyze: start at 40 words and re-run silently on edits' }, [auto, ' auto-analyze']),
    draft,
    reset,
    inspect,
  );
  bar.append(controls);

  // Inspector: latest SessionState and the last port messages.
  const pane = el('div', { class: 'inspect' });
  const traffic = el('div', { class: 'traffic' });
  const state = el('pre', {}, ['No session state yet.']);
  pane.append(traffic, state);
  bar.append(pane);
  inspect.addEventListener('click', () => pane.classList.toggle('open'));

  const recent: Traffic[] = [];
  deps.shim.onTraffic((t) => {
    recent.push(t);
    if (recent.length > 12) recent.shift();
    const m = t.message as { type?: string; state?: unknown };
    traffic.replaceChildren(
      ...recent.map((r) => {
        const rm = r.message as { type?: string; reason?: string; action?: string; findingId?: string; state?: { snapshotVersion?: number; passes?: Record<string, { state?: string }> } };
        const arrow = r.direction === 'content->background' ? '→ bg ' : '← bg ';
        const passes = rm.state?.passes ? `v${rm.state.snapshotVersion ?? 0} ` + Object.entries(rm.state.passes).map(([id, p]) => `${id}=${p.state ?? '?'}`).join(' ') : '';
        const extra = rm.reason ?? rm.action ?? rm.findingId ?? passes;
        return el('div', {}, [`${new Date(r.at).toLocaleTimeString()} ${arrow}${rm.type ?? '?'} ${extra}`]);
      }),
    );
    if (m.type === 'session/state' && m.state) state.textContent = JSON.stringify(m.state, null, 2);
  });

  // Fill from storage.
  void readSettings().then((s) => {
    provider.value = s.provider === 'mock' ? 'mock' : 'openrouter';
    key.value = s.openrouter?.apiKey ?? '';
    auto.checked = Boolean(s.autoAnalyze);
    key.style.display = provider.value === 'mock' ? 'none' : '';
  });
  provider.addEventListener('change', () => {
    key.style.display = provider.value === 'mock' ? 'none' : '';
  });
  save.addEventListener('click', () => {
    const p = provider.value === 'mock' ? 'mock' : 'openrouter';
    void writeSettings({ provider: p, onboarded: true, autoAnalyze: auto.checked, openrouter: { apiKey: key.value.trim() } as Settings['openrouter'] }).then(() => location.reload());
  });
  auto.addEventListener('change', () => {
    void writeSettings({ autoAnalyze: auto.checked }).then(() => location.reload());
  });
  draft.addEventListener('change', () => {
    const d = DRAFTS[Number(draft.value)];
    draft.value = '';
    const editor = deps.editor();
    if (!d || !editor) return;
    writeDraft(editor, d.text);
  });
  reset.addEventListener('click', () => {
    void chrome.storage.local.clear().then(() => location.reload());
  });
}
