import { useEffect, useRef, useState } from 'preact/hooks';
import { sendToBackground, type OptionsResponse } from '../shared/messages';
import { type Effort, type HostId, type PassId, type ProviderId, type Settings } from '../shared/types';

const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits';
const CLAUDE_KEYS_URL = 'https://platform.claude.com/settings/keys';
const CLAUDE_BILLING_URL = 'https://platform.claude.com/settings/billing';
const GMAIL_COMPOSE_URL = 'https://mail.google.com/mail/?view=cm';
const HOSTS: { id: HostId; label: string }[] = [
  { id: 'gmail', label: 'Gmail' },
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'generic', label: 'Other sites (on click)' },
];
const PASSES: { id: PassId; label: string }[] = [
  { id: 'A', label: 'Clarity and claims' },
  { id: 'B', label: 'Fact check' },
  { id: 'C', label: 'Counterargument' },
];

type KeyProvider = 'openrouter' | 'claude';
type Model = { id: string; displayName: string };
type Validation =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; models: Model[] }
  | { kind: 'error'; error: string; hint?: 'workspace' | 'billing' | 'auth' | 'network' };

function redact(key: string): string {
  if (!key) return '';
  return key.length <= 12 ? '••••' : `${key.slice(0, 10)}…${key.slice(-4)}`;
}

export function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  // Decided once at load: the setup flow stays on screen until the user leaves it, even though the background
  // records `onboarded` the moment the connection test passes.
  const [view, setView] = useState<'setup' | 'settings'>('setup');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    sendToBackground({ type: 'settings/get' })
      .then((r) => {
        if (r.type !== 'settings') return setLoadError('message' in r ? r.message : 'Could not load settings');
        setSettings(r.settings);
        setView(r.settings.onboarded ? 'settings' : 'setup');
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const save = async (patch: Partial<Settings>) => {
    const r = await sendToBackground({ type: 'settings/set', patch });
    if (r.type === 'settings') setSettings(r.settings);
  };
  const reload = async () => {
    const r = await sendToBackground({ type: 'settings/get' });
    if (r.type === 'settings') setSettings(r.settings);
  };

  if (loadError) return <Shell><p class="msg err">{loadError}</p></Shell>;
  if (!settings) return <Shell><p class="msg muted">Loading…</p></Shell>;
  return <Shell>{view === 'settings' ? <SettingsView settings={settings} save={save} reload={reload} /> : <Onboarding settings={settings} save={save} reload={reload} finish={() => setView('settings')} />}</Shell>;
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  return (
    <main class="wrap">
      <header class="head">
        <span class="mark">W</span>
        <h1>WordSnap</h1>
        <span class="sub">settings</span>
      </header>
      {children}
    </main>
  );
}

/* ---------------- key validation (paste path) ---------------- */

function useKeyValidation(provider: KeyProvider, onValid: (apiKey: string, workspaceId: string, models: Model[]) => Promise<void>) {
  const [key, setKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [v, setV] = useState<Validation>({ kind: 'idle' });
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  const validate = (apiKey: string, ws: string) => {
    const my = ++seq.current;
    setV({ kind: 'checking' });
    sendToBackground({ type: 'settings/validateKey', provider, apiKey, workspaceId: ws || undefined })
      .then(async (r: OptionsResponse) => {
        if (my !== seq.current) return;
        if (r.type === 'validateKey' && r.ok) {
          setV({ kind: 'ok', models: r.models });
          await onValid(apiKey, ws, r.models);
        } else if (r.type === 'validateKey') setV({ kind: 'error', error: r.error, hint: r.hint });
        else setV({ kind: 'error', error: 'message' in r ? r.message : 'Unexpected response' });
      })
      .catch((e: Error) => my === seq.current && setV({ kind: 'error', error: e.message, hint: 'network' }));
  };

  const onKeyInput = (value: string) => {
    setKey(value);
    window.clearTimeout(timer.current);
    if (!value.trim()) return setV({ kind: 'idle' });
    timer.current = window.setTimeout(() => validate(value.trim(), workspaceId.trim()), 500);
  };
  const onWorkspaceInput = (value: string) => {
    setWorkspaceId(value);
    window.clearTimeout(timer.current);
    if (key.trim()) timer.current = window.setTimeout(() => validate(key.trim(), value.trim()), 500);
  };
  return { key, workspaceId, v, onKeyInput, onWorkspaceInput, retry: () => validate(key.trim(), workspaceId.trim()) };
}

function ValidationMessage({ v, provider, workspaceId, onWorkspaceInput, retry }: { v: Validation; provider: KeyProvider; workspaceId: string; onWorkspaceInput: (s: string) => void; retry: () => void }) {
  if (v.kind === 'idle') return null;
  if (v.kind === 'checking') return <p class="msg muted"><span class="spin" /> Checking the key…</p>;
  if (v.kind === 'ok') return <p class="msg ok">✓ Key accepted. {v.models.length} models available.</p>;
  const billingUrl = provider === 'openrouter' ? OPENROUTER_CREDITS_URL : CLAUDE_BILLING_URL;
  return (
    <div>
      <p class="msg err">
        {v.hint === 'auth' ? 'That key was not accepted. Check for missing characters.' : v.hint === 'network' ? 'Could not reach the provider.' : v.error}
        {v.hint === 'network' ? <> <button class="link" onClick={retry}>Retry</button></> : null}
        {v.hint === 'billing' ? <> <a href={billingUrl} target="_blank" rel="noopener noreferrer">{provider === 'openrouter' ? 'Add credits ↗' : 'Set up billing ↗'}</a></> : null}
      </p>
      {v.hint === 'workspace' ? (
        <div class="field">
          <label>Workspace ID</label>
          <input type="text" placeholder="wrkspc_…" aria-label="Workspace ID" value={workspaceId} onInput={(e) => onWorkspaceInput((e.target as HTMLInputElement).value)} />
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- OpenRouter one-click connect ---------------- */

type Connect = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; models: Model[] } | { kind: 'error'; error: string };

function useConnect(onDone: () => Promise<void>) {
  const [c, setC] = useState<Connect>({ kind: 'idle' });
  const connect = async () => {
    setC({ kind: 'busy' });
    try {
      const r = await sendToBackground({ type: 'openrouter/connect' });
      if (r.type === 'connect' && r.ok) {
        setC({ kind: 'ok', models: r.models });
        await onDone();
      } else if (r.type === 'connect') setC({ kind: 'error', error: r.error });
      else setC({ kind: 'error', error: 'message' in r ? r.message : 'Unexpected response' });
    } catch (e) {
      setC({ kind: 'error', error: (e as Error).message });
    }
  };
  return { c, connect };
}

function ConnectButton({ c, connect, label }: { c: Connect; connect: () => void; label: string }) {
  return (
    <div class="row">
      <button class="btn primary" disabled={c.kind === 'busy'} onClick={connect}>
        {c.kind === 'busy' ? <span class="spin" /> : null}
        {label}
      </button>
      {c.kind === 'error' ? <span class="msg err" style={{ margin: 0 }}>{c.error}</span> : null}
      {c.kind === 'ok' ? <span class="msg ok" style={{ margin: 0 }}>✓ Connected</span> : null}
    </div>
  );
}

/* ---------------- connection test ---------------- */

type TestState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; model: string; ms: number } | { kind: 'error'; error: string; hint?: 'workspace' | 'billing' | 'auth' | 'network' };

/** Runs the background's connection test: one short completion through the configured provider and model. */
function useProviderTest() {
  const [t, setT] = useState<TestState>({ kind: 'idle' });
  const seq = useRef(0);
  const run = async (): Promise<TestState> => {
    const my = ++seq.current;
    setT({ kind: 'busy' });
    let next: TestState;
    try {
      const r = await sendToBackground({ type: 'provider/test' });
      if (r.type === 'test' && r.ok) next = { kind: 'ok', model: r.model, ms: r.ms };
      else if (r.type === 'test') next = { kind: 'error', error: r.error, hint: r.hint };
      else next = { kind: 'error', error: 'message' in r ? r.message : 'Unexpected response' };
    } catch (e) {
      next = { kind: 'error', error: (e as Error).message, hint: 'network' };
    }
    if (my === seq.current) setT(next);
    return next;
  };
  return { t, run, reset: () => setT({ kind: 'idle' }) };
}

function seconds(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms / 100)) / 10} s` : `${(ms / 1000).toFixed(1)} s`;
}

function hasKey(s: Settings): boolean {
  return s.provider === 'mock' || (s.provider === 'openrouter' ? s.openrouter.apiKey : s.apiKey).trim().length > 0;
}

function modelOf(s: Settings): string {
  return s.provider === 'openrouter' ? s.openrouter.model : s.provider === 'claude' ? s.model : 'mock';
}

function providerName(s: Settings): string {
  return s.provider === 'openrouter' ? 'OpenRouter' : s.provider === 'claude' ? 'Anthropic' : 'the mock provider';
}

function TestError({ t, provider, onRetry }: { t: Extract<TestState, { kind: 'error' }>; provider: ProviderId; onRetry: () => void }) {
  const billingUrl = provider === 'openrouter' ? OPENROUTER_CREDITS_URL : CLAUDE_BILLING_URL;
  return (
    <p class="msg err">
      {t.hint === 'auth' ? 'The key was not accepted.' : t.hint === 'network' ? `Could not reach the provider. ${t.error}` : t.error}
      {t.hint === 'billing' ? <> <a href={billingUrl} target="_blank" rel="noopener noreferrer">{provider === 'openrouter' ? 'Add credits ↗' : 'Set up billing ↗'}</a></> : null}
      {t.hint === 'network' || t.hint === 'billing' ? <> <button class="link" onClick={onRetry}>Try again</button></> : null}
    </p>
  );
}

/* ---------------- onboarding ---------------- */

/**
 * Setup: connect, then a connection test runs on its own, then a screen that says setup is complete and shows the
 * badge to look for. Reopening the page with a key already stored goes straight to the test.
 */
function Onboarding({ settings, save, reload, finish }: { settings: Settings; save: (p: Partial<Settings>) => Promise<void>; reload: () => Promise<void>; finish: () => void }) {
  const [manual, setManual] = useState<KeyProvider | null>(null);
  const [changing, setChanging] = useState(false);
  const { t, run, reset } = useProviderTest();

  const testAfter = async (settle: () => Promise<void>) => {
    setChanging(false);
    await settle();
    await run();
    await reload();
  };
  const { c, connect } = useConnect(() => testAfter(reload));
  const kvOpenRouter = useKeyValidation('openrouter', (apiKey) => testAfter(() => save({ provider: 'openrouter', openrouter: { ...settings.openrouter, apiKey } })));
  const kvClaude = useKeyValidation('claude', (apiKey, workspaceId) => testAfter(() => save({ provider: 'claude', apiKey, workspaceId })));

  useEffect(() => {
    if (hasKey(settings)) void testAfter(async () => undefined);
  }, []);

  const connected = hasKey(settings) && !changing;
  const model = modelOf(settings);

  if (t.kind === 'ok') {
    return (
      <div class="card step done">
        <span class="n">✓</span>
        <div>
          <h2>Setup complete</h2>
          <p class="msg ok" style={{ marginTop: 0 }}>
            <code>{t.model}</code> answered in {seconds(t.ms)}.
          </p>
          <BadgePreview />
          <p>Open Gmail and start a message. This badge sits at the top right of the compose window. Click it when you want the draft checked. Nothing runs, and nothing leaves your browser, until you do.</p>
          <div class="row">
            <a class="btn primary" href={GMAIL_COMPOSE_URL} target="_blank" rel="noopener noreferrer">
              Open Gmail ↗
            </a>
            <button class="btn" onClick={finish}>
              Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div class={`card step${connected ? ' done' : ''}`}>
        <span class="n">{connected ? '✓' : '1'}</span>
        <div>
          <h2>Connect a model provider</h2>
          {connected ? (
            <p class="msg ok" style={{ marginTop: 0 }}>
              {providerName(settings)} account on file.{' '}
              <button
                class="link"
                onClick={() => {
                  reset();
                  setChanging(true);
                }}
              >
                Use a different account
              </button>
            </p>
          ) : (
            <>
              <p>WordSnap runs on an account you control. The fastest way is OpenRouter: one sign-in, no keys to copy, pay only for what you use.</p>
              <ConnectButton c={c} connect={connect} label="Connect OpenRouter" />
              <details class="alt" open={manual !== null}>
                <summary>Or paste a key instead</summary>
                <div class="row" style={{ margin: '8px 0' }}>
                  <button class={`btn${manual === 'openrouter' ? ' on' : ''}`} onClick={() => setManual('openrouter')}>OpenRouter key</button>
                  <button class={`btn${manual === 'claude' ? ' on' : ''}`} onClick={() => setManual('claude')}>Anthropic key</button>
                </div>
                {manual === 'openrouter' ? (
                  <>
                    <p class="msg muted">Create one at <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noopener noreferrer">openrouter.ai/settings/keys ↗</a></p>
                    <input type="password" placeholder="sk-or-v1-…" aria-label="OpenRouter API key" autocomplete="off" value={kvOpenRouter.key} onInput={(e) => kvOpenRouter.onKeyInput((e.target as HTMLInputElement).value)} />
                    <ValidationMessage v={kvOpenRouter.v} provider="openrouter" workspaceId="" onWorkspaceInput={() => {}} retry={kvOpenRouter.retry} />
                  </>
                ) : null}
                {manual === 'claude' ? (
                  <>
                    <p class="msg muted">Create a personal key at <a href={CLAUDE_KEYS_URL} target="_blank" rel="noopener noreferrer">platform.claude.com ↗</a>. Claude Code and claude.ai logins do not work here.</p>
                    <input type="password" placeholder="sk-ant-api03-…" aria-label="Anthropic API key" autocomplete="off" value={kvClaude.key} onInput={(e) => kvClaude.onKeyInput((e.target as HTMLInputElement).value)} />
                    <ValidationMessage v={kvClaude.v} provider="claude" workspaceId={kvClaude.workspaceId} onWorkspaceInput={kvClaude.onWorkspaceInput} retry={kvClaude.retry} />
                  </>
                ) : null}
              </details>
            </>
          )}
        </div>
      </div>

      <div class={`card step${connected ? '' : ' pending'}`}>
        <span class="n">2</span>
        <div>
          <h2>Check the connection</h2>
          {t.kind === 'busy' ? (
            <p class="msg muted" style={{ marginTop: 0 }}>
              <span class="spin" /> Sending a short test to <code>{model}</code>…
            </p>
          ) : t.kind === 'error' ? (
            <>
              <TestError t={t} provider={settings.provider} onRetry={() => void testAfter(async () => undefined)} />
              <div class="row">
                <button class="btn primary" onClick={() => void testAfter(async () => undefined)}>
                  Try again
                </button>
                <button
                  class="btn"
                  onClick={() => {
                    reset();
                    setChanging(true);
                  }}
                >
                  Use a different account
                </button>
                <button
                  class="link"
                  onClick={() => {
                    void save({ onboarded: true });
                    finish();
                  }}
                >
                  Skip to settings
                </button>
              </div>
            </>
          ) : (
            <p style={{ marginBottom: 0 }}>Runs on its own once you connect: one short request to the model, so you know it answers before you open Gmail.</p>
          )}
        </div>
      </div>
      {__WORDSNAP_DEV__ ? (
        <p class="dev">
          dev build:{' '}
          <button class="btn" onClick={() => void testAfter(() => save({ provider: 'mock' }))}>
            use the mock provider
          </button>
        </p>
      ) : null}
    </>
  );
}

/** The launcher badge as it appears on a Gmail compose window, drawn with the overlay's own dimensions. */
function BadgePreview() {
  return (
    <div class="compose-demo" aria-label="A compose window with the WordSnap badge at its top right">
      <div class="compose-bar">New Message</div>
      <div class="compose-body">
        <span class="compose-badge" aria-hidden="true">
          W
        </span>
        <i style={{ width: '46%' }} />
        <i style={{ width: '62%' }} />
        <i style={{ width: '38%' }} />
      </div>
      <div class="compose-note">
        <span class="compose-arrow">↑</span> the WordSnap badge
      </div>
    </div>
  );
}

function ModelSelect({ value, models, disabled, onChange }: { value: string; models: Model[]; disabled?: boolean; onChange: (m: string) => void }) {
  const options = models.length ? models : [{ id: value, displayName: value }];
  const known = options.some((m) => m.id === value);
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {known ? null : <option value={value}>{value}</option>}
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}

/* ---------------- settings ---------------- */

function SettingsView({ settings, save, reload }: { settings: Settings; save: (p: Partial<Settings>) => Promise<void>; reload: () => Promise<void> }) {
  const [replacing, setReplacing] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [domains, setDomains] = useState(settings.blockedDomains.join('\n'));
  const { c, connect } = useConnect(async () => {
    setReplacing(false);
    await reload();
  });
  useEffect(() => {
    if (c.kind === 'ok') setModels(c.models);
  }, [c]);

  const kvOpenRouter = useKeyValidation('openrouter', async (apiKey, _ws, ms) => {
    setModels(ms);
    setReplacing(false);
    await save({ openrouter: { ...settings.openrouter, apiKey } });
  });
  const kvClaude = useKeyValidation('claude', async (apiKey, workspaceId, ms) => {
    setModels(ms);
    setReplacing(false);
    await save({ apiKey, workspaceId });
  });

  const { t, run: runTest } = useProviderTest();
  const p = settings.provider;
  const key = p === 'openrouter' ? settings.openrouter.apiKey : p === 'claude' ? settings.apiKey : 'mock';
  const showReplace = replacing || (!key && p !== 'mock');
  const pinned = settings.openrouter.providerOrder.includes('z-ai');

  return (
    <>
      <div class="card">
        <h3>Provider</h3>
        <div class="field">
          <label>Provider</label>
          <select value={p} onChange={(e) => void save({ provider: (e.target as HTMLSelectElement).value as ProviderId })}>
            <option value="openrouter">OpenRouter (recommended)</option>
            <option value="claude">Claude (Anthropic API key)</option>
            {__WORDSNAP_DEV__ || p === 'mock' ? <option value="mock">Mock (dev only)</option> : null}
          </select>

          {p !== 'mock' ? (
            <>
              <label>{p === 'openrouter' ? 'Account' : 'API key'}</label>
              <div>
                {showReplace ? (
                  p === 'openrouter' ? (
                    <>
                      <ConnectButton c={c} connect={connect} label="Connect OpenRouter" />
                      <details class="alt">
                        <summary>Or paste a key</summary>
                        <input type="password" placeholder="sk-or-v1-…" aria-label="OpenRouter API key" autocomplete="off" value={kvOpenRouter.key} onInput={(e) => kvOpenRouter.onKeyInput((e.target as HTMLInputElement).value)} />
                        <ValidationMessage v={kvOpenRouter.v} provider="openrouter" workspaceId="" onWorkspaceInput={() => {}} retry={kvOpenRouter.retry} />
                      </details>
                    </>
                  ) : (
                    <>
                      <input type="password" placeholder="sk-ant-api03-…" aria-label="Anthropic API key" autocomplete="off" value={kvClaude.key} onInput={(e) => kvClaude.onKeyInput((e.target as HTMLInputElement).value)} />
                      <ValidationMessage v={kvClaude.v} provider="claude" workspaceId={kvClaude.workspaceId || settings.workspaceId} onWorkspaceInput={kvClaude.onWorkspaceInput} retry={kvClaude.retry} />
                    </>
                  )
                ) : (
                  <div>
                    <div class="row">
                      <code>{redact(key)}</code>
                      <button class="btn" onClick={() => setReplacing(true)}>
                        {p === 'openrouter' ? 'Reconnect' : 'Replace'}
                      </button>
                      <button class="btn" disabled={t.kind === 'busy'} onClick={() => void runTest()}>
                        {t.kind === 'busy' ? <span class="spin" /> : null}
                        Test
                      </button>
                      <a href={p === 'openrouter' ? OPENROUTER_CREDITS_URL : CLAUDE_KEYS_URL} target="_blank" rel="noopener noreferrer">
                        {p === 'openrouter' ? 'Credits ↗' : 'Console ↗'}
                      </a>
                    </div>
                    {t.kind === 'ok' ? (
                      <p class="msg ok">
                        ✓ <code>{t.model}</code> answered in {seconds(t.ms)}.
                      </p>
                    ) : t.kind === 'error' ? (
                      <TestError t={t} provider={p} onRetry={() => void runTest()} />
                    ) : null}
                  </div>
                )}
              </div>

              <label>Model</label>
              <ModelSelect
                value={p === 'openrouter' ? settings.openrouter.model : settings.model}
                models={models}
                onChange={(m) => void (p === 'openrouter' ? save({ openrouter: { ...settings.openrouter, model: m } }) : save({ model: m }))}
              />
            </>
          ) : null}

          {p === 'openrouter' ? (
            <>
              <label>Routing</label>
              <div class="checks">
                <label>
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => {
                      const on = (e.target as HTMLInputElement).checked;
                      void save({ openrouter: { ...settings.openrouter, providerOrder: on ? ['z-ai'] : [], allowFallbacks: !on } });
                    }}
                  />
                  Serve Z.AI models from Z.AI only (no fallbacks)
                </label>
              </div>
              <label>Web results</label>
              <select value={String(settings.openrouter.webResults)} onChange={(e) => void save({ openrouter: { ...settings.openrouter, webResults: Number((e.target as HTMLSelectElement).value) } })}>
                {[3, 5, 8].map((n) => (
                  <option key={n} value={String(n)}>
                    {n} per fact check ({(n * 0.004).toFixed(3)} USD)
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      </div>

      <div class="card">
        <h3>When to analyze</h3>
        <div class="checks">
          <label>
            <input type="checkbox" checked={settings.autoAnalyze} onChange={(e) => void save({ autoAnalyze: (e.target as HTMLInputElement).checked })} />
            Analyze on its own: start once a draft passes 40 words, and re-check as you edit
          </label>
        </div>
        <p class="msg muted" style={{ marginTop: '6px' }}>Off by default: WordSnap waits for you. Click the badge on a compose window to analyze, and press Re-analyze in the panel after you edit. Highlights follow your edits either way.</p>
      </div>

      <div class="card">
        <h3>Sites</h3>
        <div class="checks">
          {HOSTS.map((h) => (
            <label key={h.id}>
              <input type="checkbox" checked={settings.enabledHosts[h.id]} onChange={(e) => void save({ enabledHosts: { ...settings.enabledHosts, [h.id]: (e.target as HTMLInputElement).checked } })} />
              {h.label}
            </label>
          ))}
        </div>
      </div>

      <div class="card">
        <h3>Effort per pass</h3>
        <div class="field">
          {PASSES.map((ps) => (
            <>
              <label key={`l${ps.id}`}>{ps.label}</label>
              <select key={`s${ps.id}`} value={settings.effort[ps.id]} onChange={(e) => void save({ effort: { ...settings.effort, [ps.id]: (e.target as HTMLSelectElement).value as Effort } })}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </>
          ))}
        </div>
      </div>

      <div class="card">
        <h3>Blocked domains</h3>
        <p class="msg muted" style={{ marginTop: 0 }}>
          Never cite these when checking facts. One per line, no scheme.{p === 'openrouter' ? ' Applied to citations after the search.' : ''}
        </p>
        <textarea value={domains} onInput={(e) => setDomains((e.target as HTMLTextAreaElement).value)} onBlur={() => void save({ blockedDomains: domains.split(/\n+/).map((s) => s.trim()).filter(Boolean) })} />
      </div>

      <div class="card">
        <h3>Running cost</h3>
        <p class="cost">${settings.lifetimeCostUsd.toFixed(2)} estimated across all drafts, billed to your account.</p>
      </div>

      <p class="privacy">Your text goes only to the provider you configured, from your own account. There is no WordSnap server, no analytics, and nothing is stored outside this browser.</p>
      {__WORDSNAP_DEV__ ? <p class="dev">dev build</p> : null}
    </>
  );
}

