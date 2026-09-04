// Per-session pass orchestration. No chrome.* here: provider, settings, cache, clock and timers are injected.
import { log } from '../shared/log';
import { buildPassA, buildPassB, buildPassC, type DraftContext } from '../passes/build';
import { validatePassA, validatePassB, validatePassC } from '../passes/validate';
import type { LLMProvider, PassRequest, PassResult } from '../providers/types';
import { ProviderError } from '../providers/types';
import { changedParagraphs } from '../shared/anchoring';
import { estimateCostUsd } from '../shared/cost';
import type { Claim, PassA, PassB, PassC, Verdict } from '../shared/schemas';
import { activeModel, clarityKindFilter, sameChecks, type Checks, type HostId, type PassId, type SessionState, type Settings, type TextSnapshot } from '../shared/types';
import type { ClaimCache } from './cache';
import { Session, type SavedSession } from './session';

export const DEBOUNCE_MS = 800;
export const C_THROTTLE_MS = 20_000;
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OrchestratorDeps {
  provider: () => LLMProvider;
  settings: () => Settings;
  cache: ClaimCache;
  emit: (state: SessionState) => void;
  onCost?: (usd: number) => void;
  now?: () => number;
  timers?: Timers;
  context?: DraftContext;
}

export class SessionOrchestrator {
  readonly session: Session;
  private readonly now: () => number;
  private readonly timers: Timers;
  private debounceHandle: unknown = null;
  private controllers: Partial<Record<PassId, AbortController>> = {};
  private lastCRun = -Infinity;
  private cDeferred: unknown = null;
  private backoffMs = BACKOFF_MIN_MS;
  private retryHandle: unknown = null;
  private closed = false;
  private pendingSnapshot: TextSnapshot | null = null;

  constructor(
    sessionKey: string,
    host: HostId,
    private readonly deps: OrchestratorDeps,
  ) {
    this.session = new Session(sessionKey, host);
    this.session.state.checks = { ...deps.settings().checks };
    this.now = deps.now ?? (() => Date.now());
    this.timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  }

  get state(): SessionState {
    return this.session.state;
  }

  /** Pick up a session saved before the service worker restarted. Call before the first snapshot. */
  restore(saved: SavedSession): void {
    this.session.load(saved);
    if (!this.session.state.checks) this.session.state.checks = { ...this.deps.settings().checks };
    this.lastCRun = this.session.state.passes.C.at ?? -Infinity;
  }

  dump(): SavedSession {
    return this.session.dump();
  }

  /**
   * New text from the content script. Anchors shift and touched findings go stale right away. What runs depends on
   * the mode: `immediate` (the user just asked) runs now; otherwise the autoAnalyze setting decides between a
   * debounced run (auto) and waiting for `analyzeNow` (on demand, the default).
   */
  handleSnapshot(snapshot: TextSnapshot, immediate = false): void {
    if (this.closed) return;
    this.session.applySnapshot(snapshot);
    this.pendingSnapshot = snapshot;
    if (!immediate && !this.deps.settings().autoAnalyze) {
      this.emit();
      return;
    }
    this.abort('A');
    this.emit();
    this.clearScheduled();
    if (immediate) {
      void this.run();
      return;
    }
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = null;
      void this.run();
    }, DEBOUNCE_MS);
  }

  /** Which checks are in effect for this session. */
  checks(): Checks {
    return this.session.state.checks ?? this.deps.settings().checks;
  }

  /** The user flipped a chip: prune what a check turned off produced. A check turned on waits for Re-analyze. */
  setChecks(checks: Checks): void {
    if (this.closed) return;
    this.session.applyChecks(checks, clarityKindFilter(checks));
    this.emit();
  }

  /** The user pressed Re-analyze: run on the latest text now, and refresh the counterargument regardless of the throttle. */
  analyzeNow(): void {
    if (this.closed) return;
    this.clearScheduled();
    this.abort('A');
    void this.run({ force: true });
  }

  private clearScheduled(): void {
    if (this.debounceHandle) this.timers.clearTimeout(this.debounceHandle);
    this.debounceHandle = null;
    if (this.retryHandle) this.timers.clearTimeout(this.retryHandle);
    this.retryHandle = null;
  }

  handleAction(findingId: string, action: 'applied' | 'kept'): void {
    if (this.session.applyAction(findingId, action)) this.emit();
  }

  close(): void {
    this.closed = true;
    if (this.debounceHandle) this.timers.clearTimeout(this.debounceHandle);
    if (this.cDeferred) this.timers.clearTimeout(this.cDeferred);
    if (this.retryHandle) this.timers.clearTimeout(this.retryHandle);
    for (const p of ['A', 'B', 'C'] as PassId[]) this.abort(p);
  }

  /**
   * Run the passes for the current snapshot. Public for tests and the sample runner.
   * `force` is an explicit request: unchanged text gets a full run instead of nothing, and C runs past its throttle.
   */
  async run(opts: { force?: boolean } = {}): Promise<void> {
    const snapshot = this.pendingSnapshot ?? this.session.snapshot;
    if (!snapshot || this.closed) return;
    this.pendingSnapshot = null;
    this.session.state.analyzedVersion = snapshot.version;
    const checks = this.checks();
    // A flipped chip makes the next run a full one: the set of passes and what A is asked for both change.
    const checksChanged = this.session.state.analyzedChecks !== undefined && !sameChecks(this.session.state.analyzedChecks, checks);
    this.session.state.analyzedChecks = { ...checks };
    const changed = changedParagraphs(this.session.analyzedSnapshot, snapshot);
    const unchanged = !!this.session.analyzedSnapshot && changed.length === 0;
    const isFull = !this.session.analyzedSnapshot || changed.length === snapshot.paragraphs.length || checksChanged || (unchanged && !!opts.force);
    if (unchanged && !opts.force && !checksChanged) {
      // text is byte-identical to what was analyzed (e.g. undo): nothing to do
      this.emit();
      return;
    }

    const wantC = checks.challenge || checks.structure;
    const wantA = checks.polish || checks.structure || checks.facts;
    const runC = wantC && (opts.force || checksChanged ? this.forceC() : this.shouldRunC(changed, isFull));
    const cWork = runC ? this.runC(snapshot) : Promise.resolve();
    const aWork = wantA ? this.runA(snapshot, isFull ? undefined : changed) : Promise.resolve();
    if (!wantA && !runC) this.emit();
    await Promise.all([aWork, cWork]);
  }

  /* ---------------- pass A ---------------- */

  private async runA(snapshot: TextSnapshot, scope: number[] | undefined): Promise<void> {
    const settings = this.deps.settings();
    const previous = scope
      ? {
          clarity: this.session.state.clarity.filter((f) => f.span && scope.includes(paraOf(snapshot, f.span.start))).map((f) => f.data),
          claims: this.session.state.claims.filter((f) => f.span && scope.includes(paraOf(snapshot, f.span.start))).map(({ data }) => stripVerdict(data)),
        }
      : undefined;
    const checks = this.checks();
    const req = buildPassA(snapshot, {
      effort: settings.effort.A,
      context: this.deps.context,
      changedParagraphs: scope,
      previous,
      clarity: checks.polish || checks.structure,
      claims: checks.facts,
    });
    const res = await this.execute('A', req);
    if (!res) return;
    if (this.session.snapshot !== snapshot && this.session.snapshot?.text !== snapshot.text) {
      // a newer snapshot arrived while A was in flight and its run was not aborted; results anchor against current text
    }
    const text = this.session.snapshot?.text ?? snapshot.text;
    const keep = clarityKindFilter(checks);
    const located = validatePassA(res.data, text);
    located.clarity = located.clarity.filter((f) => keep(f.data.kind));
    if (!checks.facts) located.claims = [];
    const toVerify = this.session.mergePassA(located, scope);
    this.emit();
    if (checks.facts) await this.runB(toVerify, this.session.snapshot ?? snapshot);
  }

  /* ---------------- pass B ---------------- */

  private async runB(claims: Claim[], snapshot: TextSnapshot): Promise<void> {
    if (!claims.length) return;
    const settings = this.deps.settings();
    // cache first
    const misses: Claim[] = [];
    for (const c of claims) {
      const cached = await this.deps.cache.get(c.statement);
      if (cached) this.session.attachVerdicts([{ ...cached, claimId: c.id }]);
      else misses.push(c);
    }
    if (misses.length < claims.length) this.emit();
    if (!misses.length) return;
    if (!this.deps.provider().capabilities.webSearch) {
      this.session.setPass('B', { state: 'done', at: this.now(), detail: 'This provider cannot search; claims are listed, not verified.' });
      this.emit();
      return;
    }
    const opts = { effort: settings.effort.B, blockedDomains: settings.blockedDomains, context: this.deps.context };
    const text0 = () => this.session.snapshot?.text ?? snapshot.text;
    let verdicts: Verdict[];
    if (this.deps.provider().capabilities.researchMode === 'grounded') {
      // One search is run per request on grounded providers, so verify one claim per request.
      // Sequential on purpose: `execute` keeps one controller per pass so an edit cancels the whole batch.
      verdicts = [];
      for (const claim of misses) {
        const res = await this.execute('B', buildPassB([claim], snapshot, opts), { keepRunning: true });
        if (!res) return;
        verdicts.push(...validatePassB(res.data, [claim], text0(), res.sourcesSeen));
        this.session.attachVerdicts(verdicts);
        this.emit();
      }
      this.session.setPass('B', { state: 'done', at: this.now(), detail: undefined });
    } else {
      const res = await this.execute('B', buildPassB(misses, snapshot, opts));
      if (!res) return;
      verdicts = validatePassB(res.data, misses, text0(), res.sourcesSeen);
    }
    this.session.attachVerdicts(verdicts);
    for (const v of verdicts) {
      const claim = misses.find((c) => c.id === v.claimId);
      if (claim && v.status !== 'unverifiable') await this.deps.cache.set(claim.statement, v);
    }
    this.emit();
  }

  /* ---------------- pass C ---------------- */

  private shouldRunC(changed: number[], isFull: boolean): boolean {
    if (isFull || !this.session.state.argument) return this.throttleC();
    const anchors = this.session.challengeParagraphs();
    const touches = changed.some((i) => anchors.has(i));
    if (!touches) return false;
    return this.throttleC();
  }

  /** An explicit request: drop any deferred run and go now. */
  private forceC(): boolean {
    if (this.cDeferred) {
      this.timers.clearTimeout(this.cDeferred);
      this.cDeferred = null;
    }
    return true;
  }

  /** True when C may run now; otherwise schedules a deferred run at the end of the window. */
  private throttleC(): boolean {
    const since = this.now() - this.lastCRun;
    if (since >= C_THROTTLE_MS) return true;
    if (!this.cDeferred) {
      this.cDeferred = this.timers.setTimeout(() => {
        this.cDeferred = null;
        const snap = this.session.snapshot;
        if (snap && !this.closed) void this.runC(snap);
      }, C_THROTTLE_MS - since);
    }
    return false;
  }

  private async runC(snapshot: TextSnapshot): Promise<void> {
    const thesisOnly = !this.checks().challenge;
    if (!thesisOnly && !this.deps.provider().capabilities.webSearch && this.session.state.argument) return;
    this.lastCRun = this.now();
    const settings = this.deps.settings();
    const req = buildPassC(snapshot, { effort: settings.effort.C, blockedDomains: settings.blockedDomains, context: this.deps.context, thesisOnly });
    const res = await this.execute('C', req);
    if (!res) return;
    const text = this.session.snapshot?.text ?? snapshot.text;
    const result = validatePassC(res.data, text, res.sourcesSeen);
    if (thesisOnly) result.challenges = [];
    this.session.mergePassC(result);
    this.emit();
  }

  /* ---------------- execution plumbing ---------------- */

  private abort(pass: PassId): void {
    const c = this.controllers[pass];
    if (c) {
      c.abort();
      delete this.controllers[pass];
    }
  }

  private async execute<T extends PassA | PassB | PassC>(pass: PassId, req: PassRequest<T>, opts: { keepRunning?: boolean } = {}): Promise<PassResult<T> | null> {
    this.abort(pass);
    const controller = new AbortController();
    this.controllers[pass] = controller;
    this.session.setPass(pass, { state: 'running', error: undefined, detail: undefined });
    this.emit();
    log.info(`${this.session.state.sessionKey}: pass ${pass} start (${req.user.length} chars, effort ${req.effort}${req.research ? ', research' : ''})`);
    try {
      const res = await this.deps.provider().runPass(req, controller.signal, (e) => {
        if (controller.signal.aborted) return;
        if (e.type === 'search') this.session.setPass(pass, { detail: `Searching: ${e.query}` });
        else if (e.type === 'status') this.session.setPass(pass, { detail: e.text });
        else return;
        this.emit();
      });
      if (controller.signal.aborted) return null;
      log.info(`${this.session.state.sessionKey}: pass ${pass} done (${res.usage.inputTokens} in, ${res.usage.outputTokens} out, ${res.usage.searches} search results${res.refused ? ', refused' : ''})`);
      this.accountUsage(res);
      this.backoffMs = BACKOFF_MIN_MS;
      if (res.refused) {
        this.session.setPass(pass, { state: 'done', at: this.now(), detail: undefined });
        this.emit();
        return null;
      }
      if (!opts.keepRunning) this.session.setPass(pass, { state: 'done', at: this.now(), detail: undefined });
      return res;
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return null;
      this.handleError(pass, err);
      return null;
    } finally {
      if (this.controllers[pass] === controller) delete this.controllers[pass];
    }
  }

  private handleError(pass: PassId, err: unknown): void {
    const pe = err instanceof ProviderError ? err : new ProviderError(err instanceof Error ? err.message : String(err), 'unknown');
    log.error(`${this.session.state.sessionKey}: pass ${pass} failed (${pe.kind}): ${pe.message}`, err);
    if (pe.kind === 'rate_limit') {
      const wait = Math.min(pe.retryAfterMs ?? this.backoffMs, BACKOFF_MAX_MS);
      this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
      this.session.setPass(pass, { state: 'error', error: `Rate limited, retrying in ${Math.round(wait / 1000)}s` });
      this.emit();
      if (!this.retryHandle) {
        this.retryHandle = this.timers.setTimeout(() => {
          this.retryHandle = null;
          this.session.analyzedSnapshot = null; // force a full re-run
          this.pendingSnapshot = this.session.snapshot;
          void this.run();
        }, wait);
      }
      return;
    }
    const messages: Record<ProviderError['kind'], string> = {
      auth: 'API key rejected. Check it in WordSnap settings.',
      workspace: 'This key needs a workspace ID. Add it in WordSnap settings.',
      billing: 'Billing is not set up on this key.',
      rate_limit: 'Rate limited.',
      network: 'Could not reach the API. Will retry on your next edit.',
      invalid: 'The model returned something WordSnap could not read. Will retry on your next edit.',
      unknown: pe.message || 'Something went wrong. Will retry on your next edit.',
    };
    this.session.setPass(pass, { state: 'error', error: messages[pe.kind] });
    this.emit();
  }

  private accountUsage(res: PassResult<unknown>): void {
    const settings = this.deps.settings();
    const usd = estimateCostUsd(res.usage, activeModel(settings));
    const u = this.session.state.usage;
    u.inputTokens += res.usage.inputTokens;
    u.outputTokens += res.usage.outputTokens;
    u.searches += res.usage.searches;
    u.estCostUsd = Math.round((u.estCostUsd + usd) * 1e6) / 1e6;
    this.deps.onCost?.(usd);
  }

  private emit(): void {
    if (this.closed) return;
    this.deps.emit(structuredClone(this.session.state));
  }
}

function paraOf(snapshot: TextSnapshot, pos: number): number {
  for (let i = 0; i < snapshot.paragraphs.length; i++) {
    const p = snapshot.paragraphs[i]!;
    if (pos >= p.start && pos <= p.end) return i;
  }
  return -1;
}

function stripVerdict(c: Claim & { verdict?: unknown }): Claim {
  const { verdict: _v, ...rest } = c;
  return rest;
}
