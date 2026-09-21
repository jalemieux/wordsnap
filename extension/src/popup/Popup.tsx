// The toolbar popup: bring WordSnap to the page in the active tab. On Gmail, X and LinkedIn it is already there.
// Elsewhere: once for this tab (activeTab, no prompt) or always for this origin (a host permission the browser asks
// for inside the click). The background does the injecting and the bookkeeping; this page only asks.
import { useEffect, useState } from 'preact/hooks';
import { sendToBackground, type SiteInfo } from '../shared/messages';

type View = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'site'; tabId: number | null; site: SiteInfo };
type Note = { kind: 'ok' | 'err' | 'busy'; text: string } | null;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  if (__WORDSNAP_DEV__) {
    // Opened as a page (tests, screenshots) the popup is its own active tab: ?tab=<id> names the one to look at.
    const id = new URLSearchParams(location.search).get('tab');
    if (id) return chrome.tabs.get(Number(id));
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function load(): Promise<View> {
  try {
    const tab = await activeTab();
    const r = await sendToBackground({ type: 'site/status', url: tab?.url ?? '' });
    if (r.type !== 'site') return { kind: 'error', message: r.type === 'error' ? r.message : 'Could not reach WordSnap.' };
    return { kind: 'site', tabId: tab?.id ?? null, site: r.site };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

function hostOf(origin: string | null): string {
  if (!origin) return '';
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function composersNote(n: number | undefined): Note {
  if (n === undefined) return null;
  return n > 0 ? { kind: 'ok', text: 'On. Look for the W badge by the text box.' } : { kind: 'ok', text: 'On. Nothing to check yet: the badge shows on a text box of 40 words or more.' };
}

export function Popup() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {
    void load().then(setView);
  }, []);

  const openSettings = () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  };

  if (view.kind === 'loading') return <Shell host=""><p class="line">Loading…</p></Shell>;
  if (view.kind === 'error') return <Shell host=""><p class="line err">{view.message}</p><SettingsEntry onClick={openSettings} /></Shell>;

  const { site, tabId } = view;
  const host = hostOf(site.origin);
  const busy = note?.kind === 'busy';

  const useHere = async () => {
    if (tabId === null) return;
    setNote({ kind: 'busy', text: 'Starting…' });
    const r = await sendToBackground({ type: 'site/use', tabId }).catch((e: Error) => ({ type: 'error' as const, message: e.message }));
    if (r.type === 'site') setNote(composersNote(r.site.composers));
    else setNote({ kind: 'err', text: r.type === 'error' ? r.message : 'Could not start on this page.' });
  };

  const alwaysOn = async () => {
    if (!site.origin) return;
    setNote({ kind: 'busy', text: 'Asking the browser…' });
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [`${site.origin}/*`] });
    } catch (err) {
      setNote({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!granted) {
      setNote({ kind: 'err', text: `Not allowed on ${host}. Nothing changed.` });
      return;
    }
    const r = await sendToBackground({ type: 'site/register', origin: site.origin, ...(tabId === null ? {} : { tabId }) }).catch((e: Error) => ({ type: 'error' as const, message: e.message }));
    if (r.type === 'site') {
      setView({ kind: 'site', tabId, site: r.site });
      setNote(composersNote(r.site.composers) ?? { kind: 'ok', text: `Always on for ${host}.` });
    } else setNote({ kind: 'err', text: r.type === 'error' ? r.message : 'Could not turn it on.' });
  };

  const turnOff = async () => {
    if (!site.origin) return;
    setNote({ kind: 'busy', text: 'Turning off…' });
    const r = await sendToBackground({ type: 'site/unregister', origin: site.origin }).catch((e: Error) => ({ type: 'error' as const, message: e.message }));
    if (r.type === 'site') {
      setView({ kind: 'site', tabId, site: r.site });
      setNote({ kind: 'ok', text: `Off for ${host}. Open pages keep running until you reload them.` });
    } else setNote({ kind: 'err', text: r.type === 'error' ? r.message : 'Could not turn it off.' });
  };

  return (
    <Shell host={site.status === 'unsupported' ? '' : host}>
      {site.status === 'builtin' ? (
        <p class="line on">
          WordSnap is already on here. <b>Look for the W badge</b> on the compose window.
        </p>
      ) : site.status === 'unsupported' ? (
        <p class="line">WordSnap cannot run on this page. Open a site where you write, then click here.</p>
      ) : (
        <div class="menu">
          {!site.generic ? <p class="line">Other sites are off in Settings. Turn them on to use WordSnap here.</p> : null}
          {site.status === 'registered' ? (
            <>
              <p class="line on">
                <b>Always on</b> for {host}.
              </p>
              <Entry title={`Turn off for ${host}`} detail="Stops WordSnap on this site and gives back its access." onClick={turnOff} disabled={busy} />
            </>
          ) : (
            <>
              <Entry title="Use WordSnap here" detail="This tab only. No access to keep." onClick={useHere} disabled={!site.generic || busy || tabId === null} />
              <Entry
                title={`Always on ${host}`}
                detail={site.canRegister ? 'The browser will ask to allow WordSnap on this site.' : 'Only https sites can be set to always on.'}
                onClick={alwaysOn}
                disabled={!site.generic || !site.canRegister || busy}
              />
            </>
          )}
          {note ? (
            <p class={`line ${note.kind === 'busy' ? '' : note.kind}`} role="status">
              {note.kind === 'busy' ? <span class="spin" /> : null}
              {note.text}
            </p>
          ) : null}
        </div>
      )}
      <div class="sep" />
      <SettingsEntry onClick={openSettings} />
      {__WORDSNAP_DEV__ ? <p class="dev">dev build</p> : null}
    </Shell>
  );
}

function Shell({ host, children }: { host: string; children: preact.ComponentChildren }) {
  return (
    <>
      <div class="brand">
        <span class="mark">W</span>
        <b>WordSnap</b>
        {host ? <span class="host" title={host}>{host}</span> : null}
      </div>
      {children}
    </>
  );
}

function Entry({ title, detail, onClick, disabled }: { title: string; detail: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button class="entry" onClick={onClick} disabled={disabled}>
      <span class="t">{title}</span>
      <span class="d">{detail}</span>
    </button>
  );
}

function SettingsEntry({ onClick }: { onClick: () => void }) {
  return (
    <div class="menu">
      <Entry title="Settings" detail="Provider, sites, when to analyze." onClick={onClick} />
    </div>
  );
}
