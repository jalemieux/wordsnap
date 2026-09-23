// The in-page chrome shim the playground runs on. It must behave like the two things the real code leans on:
// ports that deliver in order and disconnect both ways, and storage that fires onChanged.
import { describe, expect, it } from 'vitest';
import { installChromeShim } from '../../src/playground/chrome-shim';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('playground chrome shim', () => {
  it('connects a port pair, delivers messages in order and tells the peer about a disconnect', async () => {
    const shim = installChromeShim({ local: new Map() });
    const got: unknown[] = [];
    let disconnected = 0;
    let bgPort: chrome.runtime.Port | undefined;
    chrome.runtime.onConnect.addListener((port) => {
      bgPort = port;
      port.onMessage.addListener((m) => got.push(m));
      port.onDisconnect.addListener(() => {
        disconnected += 1;
      });
    });

    const port = chrome.runtime.connect({ name: 'wordsnap' });
    expect(bgPort?.name).toBe('wordsnap');
    expect(shim.openPorts()).toBe(1);

    const echo: unknown[] = [];
    port.onMessage.addListener((m) => echo.push(m));
    port.postMessage({ type: 'session/open', n: 1 });
    port.postMessage({ type: 'session/snapshot', n: 2 });
    await tick();
    expect(got).toEqual([{ type: 'session/open', n: 1 }, { type: 'session/snapshot', n: 2 }]);

    bgPort!.postMessage({ type: 'session/state', n: 3 });
    await tick();
    expect(echo).toEqual([{ type: 'session/state', n: 3 }]);

    port.disconnect();
    await tick();
    expect(disconnected).toBe(1);
    expect(shim.openPorts()).toBe(0);
    expect(() => port.postMessage({})).toThrow(/disconnected/);
  });

  it('serializes messages across the port instead of sharing the object', async () => {
    installChromeShim({ local: new Map() });
    let seen: { list: number[] } | undefined;
    chrome.runtime.onConnect.addListener((port) => port.onMessage.addListener((m) => (seen = m as { list: number[] })));
    const port = chrome.runtime.connect({ name: 'p' });
    const msg = { list: [1], gone: undefined, node: new (class Text {})() };
    port.postMessage(msg);
    msg.list.push(2);
    await tick();
    // What Chrome's JSON serialization does: undefined dropped, an object without own enumerable fields becomes {}.
    expect(seen).toEqual({ list: [1], node: {} });
  });

  it('reports traffic in both directions', async () => {
    const shim = installChromeShim({ local: new Map() });
    const seen: string[] = [];
    shim.onTraffic((t) => seen.push(t.direction));
    chrome.runtime.onConnect.addListener((port) => port.onMessage.addListener(() => port.postMessage({ type: 'ack' })));
    chrome.runtime.connect({ name: 'p' }).postMessage({ type: 'hi' });
    await tick();
    expect(seen).toEqual(['content->background', 'background->content']);
  });

  it('answers sendMessage from the listener that keeps the channel open', async () => {
    installChromeShim({ local: new Map() });
    chrome.runtime.onMessage.addListener((msg: { type: string }, _s, respond) => {
      if (msg.type !== 'ping') return false;
      setTimeout(() => respond({ type: 'pong' }), 0);
      return true;
    });
    chrome.runtime.onMessage.addListener(() => false);
    await expect(chrome.runtime.sendMessage({ type: 'ping' })).resolves.toEqual({ type: 'pong' });
    await expect(chrome.runtime.sendMessage({ type: 'other' })).resolves.toBeUndefined();
    const viaCallback = await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'ping' }, resolve));
    expect(viaCallback).toEqual({ type: 'pong' });
  });

  it('stores values and fires onChanged with old and new values', async () => {
    const local = new Map<string, unknown>();
    installChromeShim({ local });
    const changes: unknown[] = [];
    chrome.storage.onChanged.addListener((c, area) => changes.push([area, c]));

    await chrome.storage.local.set({ settings: { provider: 'mock' } });
    expect(await chrome.storage.local.get('settings')).toEqual({ settings: { provider: 'mock' } });
    expect(await chrome.storage.local.get(['settings', 'missing'])).toEqual({ settings: { provider: 'mock' } });
    expect(await chrome.storage.local.get({ missing: 1 })).toEqual({ missing: 1 });
    expect(local.get('settings')).toEqual({ provider: 'mock' });

    await chrome.storage.local.set({ settings: { provider: 'openrouter' } });
    await chrome.storage.local.remove('settings');
    await tick();
    expect(changes).toEqual([
      ['local', { settings: { oldValue: undefined, newValue: { provider: 'mock' } } }],
      ['local', { settings: { oldValue: { provider: 'mock' }, newValue: { provider: 'openrouter' } } }],
      ['local', { settings: { oldValue: { provider: 'openrouter' } } }],
    ]);
    expect(await chrome.storage.local.get(null)).toEqual({});
  });

  it('keeps storage.session apart from storage.local', async () => {
    installChromeShim({ local: new Map() });
    await chrome.storage.session.set({ 'session:a': { v: 1 } });
    expect(await chrome.storage.session.get('session:a')).toEqual({ 'session:a': { v: 1 } });
    expect(await chrome.storage.local.get('session:a')).toEqual({});
  });
});
