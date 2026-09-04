// Manifest transforms per browser target. Chrome's manifest.json is the source; Safari gets a derived copy.
// Kept out of build.mjs so the Safari transform can be unit-tested.

/**
 * Safari Web Extensions read Manifest V3 with a few differences:
 *  - the background is an event page (`background.scripts`, `persistent: false`), not a service worker. Safari has
 *    a known bug where `host_permissions` are ignored for service-worker backgrounds, and cross-origin fetch from
 *    a Safari service worker has been reported flaky; the event page sidesteps both.
 *  - `chrome.identity` does not exist. The OAuth sign-in runs in a tab instead (src/background/auth-tab.ts), so the
 *    `identity` permission is dropped rather than declared as unknown.
 *  - `minimum_chrome_version` is meaningless; `options_ui` is the settings-page key Safari documents.
 */
export function safariManifest(chrome) {
  const m = structuredClone(chrome);
  delete m.minimum_chrome_version;
  m.permissions = m.permissions.filter((p) => p !== 'identity');
  m.background = { scripts: ['background.js'], persistent: false };
  if (m.options_page) {
    m.options_ui = { page: m.options_page, open_in_tab: true };
    delete m.options_page;
  }
  return m;
}
