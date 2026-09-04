// @vitest-environment happy-dom
import { PORT_NAME } from '../../../src/shared/messages';
import { emptySession } from '../../../src/shared/types';
import { SessionClient } from '../../../src/content/session-client';

interface FakePort {
  name: string;
  posted: unknown[];
  onMessage: { addListener(cb: (m: unknown) => void): void; fire(m: unknown): void };
  onDisconnect: { addListener(cb: () => void): void; fire(): void };
  postMessage(m: unknown): void;
  disconnect(): void;
}

function installChrome() {
  const ports: FakePort[] = [];
  const connect = vi.fn(({ name }: { name: string }) => {
    const msgCbs: ((m: unknown) => void)[] = [];
    const discCbs: (() => void)[] = [];
    const port: FakePort = {
      name,
      posted: [],
      onMessage: { addListener: (cb) => msgCbs.push(cb), fire: (m) => msgCbs.forEach((cb) => cb(m)) },
      onDisconnect: { addListener: (cb) => discCbs.push(cb), fire: () => discCbs.forEach((cb) => cb()) },
      postMessage(m) {
        this.posted.push(m);
      },
      disconnect: vi.fn(),
    };
    ports.push(port);
    return port;
  });
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'test-extension', connect } };
  return { ports, connect };
}

describe('SessionClient', () => {
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.useRealTimers();
  });

  it('opens the named port, sends open + snapshot + actions, and dispatches state for its own session only', () => {
    const { ports, connect } = installChrome();
    const client = new SessionClient({ type: 'session/open', sessionKey: 's1', host: 'gmail', platform: { kind: 'email' } });
    expect(connect).toHaveBeenCalledWith({ name: PORT_NAME });
    const port = ports[0]!;
    expect(port.posted[0]).toMatchObject({ type: 'session/open', sessionKey: 's1' });
    const snapshot = { text: 'hello', paragraphs: [{ start: 0, end: 5 }], version: 1 };
    client.sendSnapshot(snapshot, 'initial');
    client.sendAction('f1', 'kept');
    client.analyze();
    expect(port.posted[1]).toMatchObject({ type: 'session/snapshot', reason: 'initial' });
    expect(port.posted[2]).toMatchObject({ type: 'finding/action', findingId: 'f1', action: 'kept' });
    expect(port.posted[3]).toMatchObject({ type: 'session/analyze', sessionKey: 's1' });
    const states: unknown[] = [];
    client.onState((s) => states.push(s));
    port.onMessage.fire({ type: 'session/state', sessionKey: 'other', state: emptySession('other', 'gmail') });
    port.onMessage.fire({ type: 'session/state', sessionKey: 's1', state: emptySession('s1', 'gmail') });
    expect(states).toHaveLength(1);
    client.close();
    expect(port.posted.at(-1)).toMatchObject({ type: 'session/close' });
    expect(port.disconnect).toHaveBeenCalled();
  });

  it('reconnects once after the service worker drops the port and replays open + last snapshot', async () => {
    vi.useFakeTimers();
    const { ports } = installChrome();
    const client = new SessionClient({ type: 'session/open', sessionKey: 's2', host: 'x', platform: { kind: 'post', charLimit: 280 } });
    const snapshot = { text: 'hello there', paragraphs: [{ start: 0, end: 11 }], version: 3 };
    client.sendSnapshot(snapshot, 'edit');
    const errors: string[] = [];
    client.onError((m) => errors.push(m));
    ports[0]!.onDisconnect.fire();
    await vi.advanceTimersByTimeAsync(500);
    expect(ports).toHaveLength(2);
    expect(ports[1]!.posted[0]).toMatchObject({ type: 'session/open', sessionKey: 's2' });
    expect(ports[1]!.posted[1]).toMatchObject({ type: 'session/snapshot', reason: 'initial', snapshot });
    ports[1]!.onDisconnect.fire();
    await vi.advanceTimersByTimeAsync(500);
    expect(ports).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it('reports an error instead of throwing when the extension context is gone', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'test-extension',
        connect: () => {
          throw new Error('Extension context invalidated.');
        },
      },
    };
    const errors: string[] = [];
    const client = new SessionClient({ type: 'session/open', sessionKey: 's3', host: 'gmail', platform: { kind: 'email' } });
    client.onError((m) => errors.push(m));
    client.sendSnapshot({ text: '', paragraphs: [], version: 1 }, 'initial');
    expect(errors).toHaveLength(0); // listener attached after the failure; no throw either way
    client.close();
  });
});
