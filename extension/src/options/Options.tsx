import { useEffect, useRef, useState } from 'preact/hooks';
import { sendToBackground, type OptionsResponse } from '../shared/messages';
import { DEFAULT_OPENROUTER, type Effort, type HostId, type PassId, type ProviderId, type SessionState, type Settings } from '../shared/types';
import { CHALLENGE_LABEL, CLARITY_LABEL, VERDICT_LABEL, sortChallenges } from '../ui/format';

const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits';
const CLAUDE_KEYS_URL = 'https://platform.claude.com/settings/keys';
const CLAUDE_BILLING_URL = 'https://platform.claude.com/settings/billing';
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
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    sendToBackground({ type: 'settings/get' })
      .then((r) => (r.type === 'settings' ? setSettings(r.settings) : setLoadError('message' in r ? r.message : 'Could not load settings')))
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
  return <Shell>{settings.onboarded ? <SettingsView settings={settings} save={save} reload={reload} /> : <Onboarding settings={settings} save={save} reload={reload} />}</Shell>;
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

/* ---------------- onboarding ---------------- */

function Onboarding({ settings, save, reload }: { settings: Settings; save: (p: Partial<Settings>) => Promise<void>; reload: () => Promise<void> }) {
  const [connected, setConnected] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [manual, setManual] = useState<KeyProvider | null>(null);
  const [sample, setSample] = useState<SessionState | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const { c, connect } = useConnect(async () => {
    setConnected(true);
    await reload();
  });
  useEffect(() => {
    if (c.kind === 'ok') setModels(c.models);
  }, [c]);

  const kvOpenRouter = useKeyValidation('openrouter', async (apiKey, _ws, ms) => {
    setModels(ms);
    setConnected(true);
    await save({ provider: 'openrouter', openrouter: { ...settings.openrouter, apiKey }, onboarded: false });
  });
  const kvClaude = useKeyValidation('claude', async (apiKey, workspaceId, ms) => {
    setModels(ms);
    setConnected(true);
    await save({ provider: 'claude', apiKey, workspaceId, onboarded: false });
  });

  const runSample = async () => {
    setSampleBusy(true);
    try {
      const r = await sendToBackground({ type: 'sample/run' });
      if (r.type === 'sample') setSample(r.state);
    } finally {
      setSampleBusy(false);
    }
  };

  const current = settings.provider;
  const currentModel = current === 'openrouter' ? settings.openrouter.model : settings.model;
  const setModel = (m: string) => (current === 'openrouter' ? save({ openrouter: { ...settings.openrouter, model: m } }) : save({ model: m }));

  return (
    <>
      <div class={`card step${connected ? ' done' : ''}`}>
        <span class="n">{connected ? '✓' : '1'}</span>
        <div>
          <h2>Connect a model provider</h2>
          <p>WordSnap runs on an account you control. The fastest way is OpenRouter: one sign-in, no keys to copy, pay only for what you use.</p>
          {!connected ? <ConnectButton c={c} connect={connect} label="Connect OpenRouter" /> : <p class="msg ok">✓ {current === 'openrouter' ? 'OpenRouter connected.' : 'Anthropic key accepted.'}</p>}
          {!connected ? (
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
          ) : null}
        </div>
      </div>

      <div class={`card step${connected ? '' : ' pending'}`}>
        <span class="n">2</span>
        <div>
          <h2>Pick a model</h2>
          <p>{current === 'openrouter' ? 'GLM 5.2 served by Z.AI is the default: strong at long documents and a fraction of the price of frontier models.' : 'Claude Opus 5 is the default.'}</p>
          <ModelSelect value={currentModel} models={models} disabled={!connected} onChange={(m) => void setModel(m)} />
        </div>
      </div>

      <div class={`card step${connected ? '' : ' pending'}`}>
        <span class="n">3</span>
        <div>
          <h2>Try it</h2>
          <p>Run the three passes on a sample email before you open Gmail.</p>
          <div class="row">
            <button class="btn primary" disabled={!connected || sampleBusy} onClick={runSample}>
              {sampleBusy ? <span class="spin" /> : null}
              Analyze the sample
            </button>
            <button class="btn" disabled={!connected} onClick={() => void save({ onboarded: true })}>
              Skip to settings
            </button>
          </div>
          {sample ? (
            <>
              <SampleFindings state={sample} />
              <div class="row" style={{ marginTop: '12px' }}>
                <button class="btn primary" onClick={() => void save({ onboarded: true })}>
                  Done, take me to settings
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {__WORDSNAP_DEV__ ? (
        <p class="dev">
          dev build:{' '}
          <button class="btn" onClick={() => void save({ provider: 'mock', onboarded: true })}>
            use the mock provider
          </button>
        </p>
      ) : null}
    </>
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

function SampleFindings({ state }: { state: SessionState }) {
  const claims = state.claims.filter((c) => c.data.verdict);
  const challenges = sortChallenges(state.challenges);
  return (
    <div class="sample">
      {state.argument ? (
        <p class="thesis">
          <b>Your argument, as WordSnap reads it.</b> {state.argument.thesis}
        </p>
      ) : null}
      {claims.length ? (
        <ul>
          {claims.map((c) => (
            <li key={c.id}>
              <span class={`chip ${c.data.verdict!.status}`}>{VERDICT_LABEL[c.data.verdict!.status]}</span> <q>{c.quote}</q> {c.data.verdict!.finding}
            </li>
          ))}
        </ul>
      ) : null}
      {state.clarity.length ? (
        <ul>
          {state.clarity.map((c) => (
            <li key={c.id}>
              <span class="chip clarity">{CLARITY_LABEL[c.data.kind]}</span> <q>{c.quote}</q> {c.data.note}
            </li>
          ))}
        </ul>
      ) : null}
      {challenges.length ? (
        <ol>
          {challenges.map((ch) => (
            <li key={ch.id}>
              <span class="chip challenge">{CHALLENGE_LABEL[ch.data.kind]}</span> <b>{ch.data.title}</b> {ch.data.howToAddress}
            </li>
          ))}
        </ol>
      ) : null}
      {Object.values(state.passes).some((p) => p.state === 'error') ? <p class="msg err">{Object.values(state.passes).find((p) => p.error)?.error}</p> : null}
    </div>
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
                  <div class="row">
                    <code>{redact(key)}</code>
                    <button class="btn" onClick={() => setReplacing(true)}>
                      {p === 'openrouter' ? 'Reconnect' : 'Replace'}
                    </button>
                    <a href={p === 'openrouter' ? OPENROUTER_CREDITS_URL : CLAUDE_KEYS_URL} target="_blank" rel="noopener noreferrer">
                      {p === 'openrouter' ? 'Credits ↗' : 'Console ↗'}
                    </a>
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

void DEFAULT_OPENROUTER;
