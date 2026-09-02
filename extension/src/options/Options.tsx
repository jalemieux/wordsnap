import { useEffect, useRef, useState } from 'preact/hooks';
import { sendToBackground, type OptionsResponse } from '../shared/messages';
import { DEFAULT_SETTINGS, type Effort, type HostId, type PassId, type SessionState, type Settings } from '../shared/types';
import { CHALLENGE_LABEL, CLARITY_LABEL, VERDICT_LABEL, sortChallenges } from '../ui/format';

const KEYS_URL = 'https://platform.claude.com/settings/keys';
const BILLING_URL = 'https://platform.claude.com/settings/billing';
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

type Validation =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; models: { id: string; displayName: string }[] }
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

  if (loadError) return <Shell><p class="msg err">{loadError}</p></Shell>;
  if (!settings) return <Shell><p class="msg muted">Loading…</p></Shell>;
  return <Shell>{settings.onboarded ? <SettingsView settings={settings} save={save} /> : <Onboarding settings={settings} save={save} />}</Shell>;
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="wrap">
      <div class="brand">
        <span class="mark">W</span>
        <h1>WordSnap</h1>
      </div>
      <p class="lede">Sharpen your own argument before you send it.</p>
      {children}
    </div>
  );
}

function useKeyValidation(save: (p: Partial<Settings>) => Promise<void>) {
  const [key, setKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [v, setV] = useState<Validation>({ kind: 'idle' });
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  const validate = (apiKey: string, ws: string) => {
    const my = ++seq.current;
    setV({ kind: 'checking' });
    sendToBackground({ type: 'settings/validateKey', apiKey, workspaceId: ws || undefined })
      .then(async (r: OptionsResponse) => {
        if (my !== seq.current) return;
        if (r.type === 'validateKey' && r.ok) {
          setV({ kind: 'ok', models: r.models });
          await save({ apiKey, workspaceId: ws, provider: 'claude' });
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

function ValidationMessage({ v, showWorkspace, workspaceId, onWorkspaceInput, retry }: { v: Validation; showWorkspace: boolean; workspaceId: string; onWorkspaceInput: (s: string) => void; retry: () => void }) {
  return (
    <>
      {v.kind === 'checking' ? (
        <p class="msg muted">
          <span class="spin" />
          Checking the key…
        </p>
      ) : null}
      {v.kind === 'ok' ? <p class="msg ok">✓ Key accepted. {v.models.length} models available.</p> : null}
      {v.kind === 'error' ? (
        <p class="msg err">
          {v.hint === 'auth' ? 'That key was not accepted. Check for a missing character and try again.' : null}
          {v.hint === 'billing' ? (
            <>
              The key works but the account has no credit. <a href={BILLING_URL} target="_blank" rel="noopener noreferrer">Add billing in the Console</a>, then retry.
            </>
          ) : null}
          {v.hint === 'workspace' ? 'This key spans several workspaces. Enter the workspace ID it should use.' : null}
          {v.hint === 'network' ? (
            <>
              Could not reach the API. <button class="btn" onClick={retry}>Retry</button>
            </>
          ) : null}
          {!v.hint ? v.error : null}
        </p>
      ) : null}
      {showWorkspace || (v.kind === 'error' && v.hint === 'workspace') ? (
        <div class="row" style={{ marginTop: '8px' }}>
          <input type="text" placeholder="wrkspc_…" aria-label="Workspace ID" value={workspaceId} onInput={(e) => onWorkspaceInput((e.target as HTMLInputElement).value)} />
        </div>
      ) : null}
    </>
  );
}

function Onboarding({ settings, save }: { settings: Settings; save: (p: Partial<Settings>) => Promise<void> }) {
  const kv = useKeyValidation(save);
  const [model, setModel] = useState(settings.model);
  const [sample, setSample] = useState<SessionState | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const keyOk = kv.v.kind === 'ok';
  const models = kv.v.kind === 'ok' ? kv.v.models : [];

  const runSample = async () => {
    setSampleBusy(true);
    try {
      const r = await sendToBackground({ type: 'sample/run' });
      if (r.type === 'sample') setSample(r.state);
    } finally {
      setSampleBusy(false);
    }
  };

  return (
    <>
      <div class="card step">
        <span class="n">1</span>
        <div>
          <h2>Get a key</h2>
          <p>WordSnap runs on your own Anthropic account. Create a personal key, scoped to a workspace, with an expiration you are comfortable with.</p>
          <a class="btn primary" href={KEYS_URL} target="_blank" rel="noopener noreferrer">
            Open the Console keys page ↗
          </a>
        </div>
      </div>
      <div class={`card step${keyOk ? ' done' : ''}`}>
        <span class="n">{keyOk ? '✓' : '2'}</span>
        <div>
          <h2>Paste it here</h2>
          <p>It is checked the moment you paste it and stored only in this browser.</p>
          <input type="password" placeholder="sk-ant-api03-…" aria-label="Anthropic API key" autocomplete="off" value={kv.key} onInput={(e) => kv.onKeyInput((e.target as HTMLInputElement).value)} />
          <ValidationMessage v={kv.v} showWorkspace={false} workspaceId={kv.workspaceId} onWorkspaceInput={kv.onWorkspaceInput} retry={kv.retry} />
          {keyOk ? (
            <div class="field" style={{ marginTop: '10px' }}>
              <label>Model</label>
              <select
                value={model}
                onChange={(e) => {
                  const m = (e.target as HTMLSelectElement).value;
                  setModel(m);
                  void save({ model: m });
                }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </div>
      <div class="card step">
        <span class="n">3</span>
        <div>
          <h2>Try it</h2>
          <p>Run the three passes on a sample email before you open Gmail.</p>
          <div class="row">
            <button class="btn primary" disabled={!keyOk || sampleBusy} onClick={runSample}>
              {sampleBusy ? <span class="spin" /> : null}
              Analyze the sample
            </button>
            <button class="btn" disabled={!keyOk} onClick={() => void save({ onboarded: true })}>
              Skip to settings
            </button>
          </div>
          {sample ? (
            <>
              <SampleFindings state={sample} />
              <div class="row" style={{ marginTop: '12px' }}>
                <button class="btn primary" onClick={() => void save({ onboarded: true })}>
                  Done, take me to Gmail-ready settings
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

function SampleFindings({ state }: { state: SessionState }) {
  return (
    <div class="findings" aria-label="Sample findings">
      {state.claims
        .filter((c) => c.data.verdict)
        .map((c) => (
          <div class="fi" key={c.id}>
            <span class={`chip ${c.data.verdict!.status}`}>{VERDICT_LABEL[c.data.verdict!.status]}</span>
            <span class="q">“{c.quote}”</span>
            <div>{c.data.verdict!.finding}</div>
          </div>
        ))}
      {state.clarity.map((c) => (
        <div class="fi" key={c.id}>
          <span class="chip clarity">{CLARITY_LABEL[c.data.kind]}</span>
          <span class="q">“{c.quote}”</span>
          <div>{c.data.note}</div>
        </div>
      ))}
      {sortChallenges(state.challenges).map((c) => (
        <div class="fi" key={c.id}>
          <span class="chip challenge">{CHALLENGE_LABEL[c.data.kind]}</span>
          <b>{c.data.title}</b>
          <div>{c.data.howToAddress}</div>
        </div>
      ))}
    </div>
  );
}

function SettingsView({ settings, save }: { settings: Settings; save: (p: Partial<Settings>) => Promise<void> }) {
  const [replacing, setReplacing] = useState(!settings.apiKey);
  const kv = useKeyValidation(save);
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [domains, setDomains] = useState(settings.blockedDomains.join('\n'));

  useEffect(() => {
    if (kv.v.kind === 'ok') {
      setModels(kv.v.models);
      setReplacing(false);
    }
  }, [kv.v]);

  const modelOptions = models.length ? models : [{ id: settings.model, displayName: settings.model }];

  return (
    <>
      <div class="card">
        <h3>Provider</h3>
        <div class="field">
          <label>Provider</label>
          <select value={settings.provider} onChange={(e) => void save({ provider: (e.target as HTMLSelectElement).value as Settings['provider'] })}>
            <option value="claude">Claude (your API key)</option>
            {__WORDSNAP_DEV__ || settings.provider === 'mock' ? <option value="mock">Mock (dev only)</option> : null}
          </select>
          <label>API key</label>
          <div>
            {replacing ? (
              <>
                <input type="password" placeholder="sk-ant-api03-…" aria-label="Anthropic API key" autocomplete="off" value={kv.key} onInput={(e) => kv.onKeyInput((e.target as HTMLInputElement).value)} />
                <ValidationMessage v={kv.v} showWorkspace={!!settings.workspaceId} workspaceId={kv.workspaceId || settings.workspaceId} onWorkspaceInput={kv.onWorkspaceInput} retry={kv.retry} />
              </>
            ) : (
              <div class="row">
                <code>{redact(settings.apiKey)}</code>
                <button class="btn" onClick={() => setReplacing(true)}>
                  Replace
                </button>
                <a href={KEYS_URL} target="_blank" rel="noopener noreferrer">
                  Console ↗
                </a>
              </div>
            )}
          </div>
          <label>Model</label>
          <select value={settings.model} onChange={(e) => void save({ model: (e.target as HTMLSelectElement).value })}>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
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
          {PASSES.map((p) => (
            <>
              <label key={`l${p.id}`}>{p.label}</label>
              <select key={`s${p.id}`} value={settings.effort[p.id]} onChange={(e) => void save({ effort: { ...settings.effort, [p.id]: (e.target as HTMLSelectElement).value as Effort } })}>
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
          Never cite these when checking facts. One per line, no scheme.
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

// Keep DEFAULT_SETTINGS referenced for parity with the background's shape.
void DEFAULT_SETTINGS;
