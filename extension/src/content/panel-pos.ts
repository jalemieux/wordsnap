// Where the user left the panel, per site. Reads and writes only its own storage key; the content script never
// reads settings (the key lives there) and this keeps it that way.
import { log } from '../shared/log';

const KEY = 'panelPos';
type Pos = { left: number; top: number };

export async function loadPanelPos(origin: string): Promise<Pos | null> {
  try {
    const got = (await chrome.storage.local.get(KEY)) as { [KEY]?: Record<string, Pos> };
    return got[KEY]?.[origin] ?? null;
  } catch {
    return null;
  }
}

export async function savePanelPos(origin: string, pos: Pos | null): Promise<void> {
  try {
    const got = (await chrome.storage.local.get(KEY)) as { [KEY]?: Record<string, Pos> };
    const all = { ...(got[KEY] ?? {}) };
    if (pos) all[origin] = pos;
    else delete all[origin];
    await chrome.storage.local.set({ [KEY]: all });
  } catch (e) {
    log.warn('could not save the panel position', e);
  }
}
