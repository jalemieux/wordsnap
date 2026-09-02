// Claim cache: verified verdicts keyed by normalized claim statement + prompt version. 24h TTL.
import { PROMPT_VERSION } from '../passes/prompts';
import { normalizeClaim } from '../shared/anchoring';
import type { Verdict } from '../shared/schemas';
import type { KeyValueStorage } from './storage';

export const CLAIM_CACHE_KEY = 'claimCache';
export const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Entry {
  verdict: Verdict;
  at: number;
}
type Table = Record<string, Entry>;

export class ClaimCache {
  private table: Table | null = null;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  static keyFor(statement: string): string {
    return `${PROMPT_VERSION}|${normalizeClaim(statement)}`;
  }

  private async load(): Promise<Table> {
    if (this.table) return this.table;
    this.table = (await this.storage.get<Table>(CLAIM_CACHE_KEY)) ?? {};
    return this.table;
  }

  async get(statement: string): Promise<Verdict | undefined> {
    const t = await this.load();
    const e = t[ClaimCache.keyFor(statement)];
    if (!e) return undefined;
    if (this.now() - e.at > CLAIM_TTL_MS) {
      delete t[ClaimCache.keyFor(statement)];
      return undefined;
    }
    return e.verdict;
  }

  async set(statement: string, verdict: Verdict): Promise<void> {
    const t = await this.load();
    t[ClaimCache.keyFor(statement)] = { verdict, at: this.now() };
    const keys = Object.keys(t);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => t[a]!.at - t[b]!.at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete t[k]);
    }
    await this.storage.set(CLAIM_CACHE_KEY, t);
  }

  async clear(): Promise<void> {
    this.table = {};
    await this.storage.remove(CLAIM_CACHE_KEY);
  }
}
