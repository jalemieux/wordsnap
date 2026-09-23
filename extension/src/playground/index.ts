// Playground bundle for a fixture page: the background and the content script in one page, over the chrome shim.
// `npm run playground` serves test/fixtures with this script appended and reloads the page on every rebuild.
// Import order matters: boot installs the shim before the background registers its listeners.
import { shim } from './boot';
import '../background/index';
import { activateHere, main } from '../content/index';
import { log } from '../shared/log';
import { FIXTURES, mountToolbar } from './toolbar';

function fixtureSlug(): string | null {
  const slug = location.pathname.replace(/^\/+|\/+$/g, '');
  return FIXTURES.some((f) => f.slug === slug) ? slug : null;
}

function firstEditor(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"], [contenteditable="true"], textarea');
}

function liveReload(): void {
  try {
    const es = new EventSource('/__reload');
    es.addEventListener('reload', () => location.reload());
  } catch {
    /* no SSE: refresh by hand */
  }
}

function start(): void {
  const fixture = fixtureSlug();
  mountToolbar({ shim, fixture, editor: firstEditor });
  const host = document.documentElement.dataset.wordsnapHost;
  if (host) {
    // A Gmail, X or LinkedIn fixture: the dev host override in adapterFor picks the real site adapter.
    main();
  } else {
    // Any other page: what the toolbar popup's "Use WordSnap here" does.
    activateHere('playground');
  }
  log.info(`playground on /${fixture ?? ''} (${host ?? 'generic'} adapter). Background and content script share this page.`);
  liveReload();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
