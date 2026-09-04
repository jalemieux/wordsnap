import { readFileSync } from 'node:fs';
import { safariManifest } from '../../scripts/manifest.mjs';

const chrome = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));

describe('Safari manifest', () => {
  const m = safariManifest(chrome);

  it('swaps the service worker for a non-persistent event page loaded as a classic script', () => {
    expect(m.background).toEqual({ scripts: ['background.js'], persistent: false });
  });

  it('drops what Safari does not have: chrome.identity and the Chrome version floor', () => {
    expect(m.permissions).not.toContain('identity');
    expect(m.permissions).toEqual(expect.arrayContaining(['storage', 'activeTab', 'scripting']));
    expect(m).not.toHaveProperty('minimum_chrome_version');
  });

  it('keeps the hosts, content scripts and action, and names the settings page the way Safari documents it', () => {
    expect(m.host_permissions).toEqual(chrome.host_permissions);
    expect(m.content_scripts).toEqual(chrome.content_scripts);
    expect(m.action).toEqual(chrome.action);
    expect(m.options_ui).toEqual({ page: 'options.html', open_in_tab: true });
    expect(m).not.toHaveProperty('options_page');
  });

  it('leaves the Chrome manifest untouched', () => {
    expect(chrome.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(chrome.permissions).toContain('identity');
  });
});
