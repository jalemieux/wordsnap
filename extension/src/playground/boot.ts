// First import of every playground bundle: install the chrome shim and stop the content script from starting on
// import, so the page decides when (after the toolbar knows which fixture it is on).
import { installChromeShim } from './chrome-shim';

(globalThis as { __WORDSNAP_NO_AUTOSTART__?: boolean }).__WORDSNAP_NO_AUTOSTART__ = true;

export const shim = installChromeShim();
