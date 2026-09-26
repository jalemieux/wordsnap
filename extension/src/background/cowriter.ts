// One co-writer session per composer: holds the draft, the dials, the shaped result, the open tweak and the margin
// comments, and runs Shape, Fill, Tweak and Revise only when the user asks. Nothing here runs on a timer or on an edit.
import { buildFill, buildRequote, buildRevise, buildShape, buildTweak } from '../passes/cowriter-build';
import { REVISE_REJECTED, SHAPE_REJECTED, validateFill, validateRevise, validateShape, validateTweak, type UnsourcedSentence } from '../passes/cowriter-validate';
import type { LLMProvider, PassRequest, PassResult, PassUsage } from '../providers/types';
import { ProviderError } from '../providers/types';
import { locateQuote, shiftSpans } from '../shared/anchoring';
import { emptyCowriterState, shapedText, type CowriterPassId, type CowriterState, type Tune, type TweakScope } from '../shared/cowriter';
import { estimateCostUsd } from '../shared/cost';
import { log } from '../shared/log';
import type { PassFill, PassShape, PassTweak } from '../shared/schemas';
import { TraceLog, formatRun, type RunTrace } from '../shared/trace';
import { activeModel, type HostId, type Settings, type Span, type TextSnapshot } from '../shared/types';

/** Re-quote runs at most once per shape and only when the loss is small enough to be worth a request. */
const REQUOTE_MIN = 1;
const REQUOTE_MAX = 6;

export interface CowriterDeps {
  provider: () => LLMProvider;
  settings: () => Settings;
  emit: (state: CowriterState) => void;
  /** The dials this session starts with (the site's). */
  tune: Tune;
  /** The user changed the dials: remember them for the site. */
  onTune?: (tune: Tune) => void;
  onCost?: (usd: number) => void;
  now?: () => number;
  trace?: boolean;
}

export const SAVED_VERSION = 2;
export interface SavedCowriter {
  version: 2;
  state: CowriterState;
  snapshot: TextSnapshot | null;
  shapedFrom: string | null;
}

export interface TweakRequest {
  id: string;
  quote: string;
  span: Span;
  instruction: string;
  mode: 'new' | 'refine' | 'again';
  /** Absent on a refine or again: the open tweak's scope carries over. */
  scope?: TweakScope;
}

const ERRORS: Record<ProviderError['kind'], string> = {
  auth: 'API key rejected. Check it in WordSnap settings.',
  workspace: 'API key rejected. Check it in WordSnap settings.',
  billing: 'Billing is not set up on this key.',
  rate_limit: 'Rate limited.',
  network: 'Could not reach the API. Try again.',
  invalid: 'The model returned something WordSnap could not read. Try again.',
  unknown: 'Something went wrong. Try again.',
};

export class CowriterSession {
  private st: CowriterState;
  private snapshot: TextSnapshot | null = null;
  /** The text the open shape was made from, to tell when the draft moved on. */
  private shapedFrom: string | null = null;
  private controllers: Partial<Record<CowriterPassId, AbortController>> = {};
  private readonly traces: TraceLog | null;
  private readonly now: () => number;
  private closed = false;

  constructor(sessionKey: string, host: HostId, private readonly deps: CowriterDeps) {
    this.st = emptyCowriterState(sessionKey, host, deps.tune);
    this.now = deps.now ?? (() => Date.now());
    this.traces = deps.trace ? new TraceLog() : null;
  }

  get state(): CowriterState {
    return this.st;
  }

  dump(): SavedCowriter {
    return structuredClone({ version: SAVED_VERSION, state: this.st, snapshot: this.snapshot, shapedFrom: this.shapedFrom });
  }

  restore(saved: unknown): boolean {
    const s = saved as Partial<SavedCowriter> | null;
    if (!s || s.version !== SAVED_VERSION || !s.state) return false;
    this.st = structuredClone(s.state);
    this.snapshot = s.snapshot ? structuredClone(s.snapshot) : null;
    this.shapedFrom = s.shapedFrom ?? null;
    // A request in flight when the worker stopped never finished.
    if (this.st.shape?.status === 'running') this.st.shape = { ...this.st.shape, status: 'error', error: 'Interrupted. Try again.' };
    if (this.st.shape) delete this.st.shape.filling;
    if (this.st.tweak?.status === 'running') this.st.tweak = { ...this.st.tweak, status: 'error', error: 'Interrupted. Try again.' };
    this.st.comments ??= [];
    if (this.st.revise?.status === 'running') this.st.revise = { ...this.st.revise, status: 'error', error: 'Interrupted. Try again.' };
    return true;
  }

  handleSnapshot(snapshot: TextSnapshot): void {
    if (this.closed) return;
    const prev = this.snapshot;
    this.snapshot = snapshot;
    this.st.snapshotVersion = snapshot.version;
    const sh = this.st.shape;
    if (sh && sh.status === 'open' && this.shapedFrom !== null && snapshot.text !== this.shapedFrom) sh.stale = true;
    const tw = this.st.tweak;
    if (tw && (tw.status === 'open' || tw.status === 'running') && locateQuote(snapshot.text, tw.quote, tw.span.start) === null) tw.status = 'stale';
    if (prev && prev.text !== snapshot.text) this.shiftComments(prev.text, snapshot.text);
    const rv = this.st.revise;
    if (rv && rv.status !== 'error' && rv.text !== snapshot.text) rv.stale = true;
    this.emit();
  }

  /** Comments ride along with edits: a passage that moved keeps its comment; one whose text changed is marked stale. */
  private shiftComments(oldText: string, newText: string): void {
    const anchored = this.st.comments.filter((c) => c.span && c.quote);
    if (!anchored.length) return;
    const shifted = shiftSpans(oldText, newText, anchored.map((c) => c.span!));
    anchored.forEach((c, i) => {
      const s = shifted[i]!;
      if (s.span && !s.changed && newText.slice(s.span.start, s.span.end) === c.quote) {
        c.span = s.span;
        c.stale = false;
        return;
      }
      // The diff lost it, but the same words may still be there (a paste, an undo): find them by quote near where they were.
      const found = locateQuote(newText, c.quote!, s.span?.start ?? c.span!.start);
      if (found) {
        c.span = found;
        c.stale = false;
      } else c.stale = true;
    });
  }

  addComment(c: { id: string; text: string; quote?: string; span?: Span }): void {
    const text = c.text.trim();
    if (!text || this.st.comments.some((x) => x.id === c.id)) return;
    const quote = c.quote?.trim();
    const anchored = !!quote && !!c.span;
    this.st.comments = [...this.st.comments, anchored ? { id: c.id, text, quote, span: c.span!, stale: false } : { id: c.id, text }];
    this.emit();
  }

  editComment(id: string, text: string): void {
    const t = text.trim();
    if (!t) return this.removeComment(id);
    this.st.comments = this.st.comments.map((c) => (c.id === id ? { ...c, text: t } : c));
    this.emit();
  }

  removeComment(id: string): void {
    if (!this.st.comments.some((c) => c.id === id)) return;
    this.st.comments = this.st.comments.filter((c) => c.id !== id);
    this.emit();
  }

  /** Revise: one request over every live comment. The result is a set of non-overlapping changes the user applies as one edit. */
  async revise(): Promise<void> {
    const snap = this.snapshot;
    if (!snap || this.closed) return;
    const comments = this.st.comments.filter((c) => !c.stale).map((c) => ({ ...c }));
    if (!comments.length) return;
    this.st.revise = { status: 'running', forVersion: snap.version, text: snap.text, comments, changes: [], skipped: [], stale: false };
    this.emit();
    const req = buildRevise({ draft: snap.text, comments: comments.map((c) => (c.quote ? { text: c.text, quote: c.quote } : { text: c.text })), tune: this.st.tune });
    const run = this.traces?.beginRun('revise', this.now());
    const res = await this.execute('revise', req, run);
    this.finishRun(run);
    const rv = this.st.revise;
    if (!rv || rv.status !== 'running' || rv.forVersion !== snap.version) return;
    if (!res.ok) {
      if (res.aborted) return;
      this.st.revise = { ...rv, status: 'error', error: res.error };
      return this.emit();
    }
    const v = validateRevise(res.result.data, { draft: snap.text, comments });
    if (v.notes.length) log.info(`${this.st.sessionKey}: revise dropped ${v.notes.length}: ${v.notes.slice(0, 6).join(' | ')}`);
    if (!v.ok) {
      log.warn(`${this.st.sessionKey}: revise rejected (${v.reason})`);
      this.st.revise = { ...rv, status: 'error', error: REVISE_REJECTED };
      return this.emit();
    }
    this.st.revise = { ...rv, status: 'open', changes: v.changes, skipped: v.skipped, ...(v.note ? { note: v.note } : {}), stale: this.snapshot?.text !== snap.text };
    this.emit();
  }

  /** applied: the comment ids whose changes were written; those comments are done. Kept drops the result and keeps the comments. */
  reviseAction(action: 'applied' | 'kept', applied: string[] = []): void {
    const rv = this.st.revise;
    if (!rv) return;
    this.abort('revise');
    if (action === 'applied' && applied.length) {
      const done = new Set(applied);
      const byId = new Map(rv.comments.map((c) => [c.id, c]));
      // One row per comment, not per change: a rename across the draft is one thing the writer asked for.
      const records = rv.comments.filter((c) => done.has(c.id) && rv.changes.some((ch) => ch.comment === c.id)).map((c) => ({ instruction: c.text, quote: c.quote ?? '', ...(c.quote ? {} : { scope: 'draft' as const }) }));
      this.st.applied = [...records, ...this.st.applied].slice(0, 20);
      this.st.comments = this.st.comments.filter((c) => !done.has(c.id));
    }
    this.st.revise = undefined;
    this.emit();
  }

  setTune(tune: Tune): void {
    this.st.tune = { ...tune };
    this.deps.onTune?.({ ...tune });
    this.emit();
  }

  async shape(): Promise<void> {
    const snap = this.snapshot;
    if (!snap || this.closed) return;
    this.abort('fill');
    const tune = { ...this.st.tune };
    this.st.shape = { status: 'running', tune, forVersion: snap.version, stale: false, flips: [], fills: {} };
    this.emit();
    const run = this.traces?.beginRun('shape', this.now());
    const res = await this.execute('shape', buildShape(snap, tune), run);
    const sh = this.st.shape;
    if (!sh || sh.status !== 'running') {
      this.finishRun(run);
      return; // replaced meanwhile
    }
    if (!res.ok) {
      this.finishRun(run);
      if (res.aborted) return;
      this.st.shape = { ...sh, status: 'error', error: res.error };
      return this.emit();
    }
    let raw: PassShape = res.result.data;
    let v = validateShape(raw, snap.text);
    if (v.unsourced.length >= REQUOTE_MIN && v.unsourced.length <= REQUOTE_MAX) {
      const patched = await this.requote(snap.text, raw, v.unsourced, run);
      if (patched) {
        raw = patched;
        v = validateShape(raw, snap.text);
      }
    }
    this.finishRun(run);
    if (!v.ok) {
      log.warn(`${this.st.sessionKey}: shape rejected (${v.reason})`, v.notes);
      this.st.shape = { ...sh, status: 'error', error: SHAPE_REJECTED };
      return this.emit();
    }
    if (v.notes.length) log.info(`${this.st.sessionKey}: shape kept with ${v.notes.length} drop(s): ${v.notes.slice(0, 6).join('; ')}`);
    this.shapedFrom = snap.text;
    this.st.shape = { ...sh, status: 'open', view: v.view, stale: this.snapshot?.text !== snap.text };
    this.emit();
  }

  flip(choice: number): void {
    const sh = this.st.shape;
    if (!sh?.view?.choices[choice]) return;
    sh.flips = sh.flips.includes(choice) ? sh.flips.filter((i) => i !== choice) : [...sh.flips, choice].sort((a, b) => a - b);
    this.emit();
  }

  async fill(gap: number): Promise<void> {
    const sh = this.st.shape;
    const m = sh?.view?.missing[gap];
    if (!sh || !sh.view || !m || sh.filling !== undefined || !this.shapedFrom) return;
    sh.filling = gap;
    delete sh.error;
    this.emit();
    const req = buildFill({ dump: this.shapedFrom, shaped: shapedText(sh.view, sh.flips, sh.fills), gap: m, tune: sh.tune });
    const run = this.traces?.beginRun('fill', this.now());
    const res = await this.execute('fill', req, run);
    this.finishRun(run);
    const now = this.st.shape;
    if (!now || now !== sh) return;
    delete now.filling;
    if (res.ok) {
      const sentences = validateFill(res.result.data, this.shapedFrom);
      if (sentences.length) now.fills = { ...now.fills, [gap]: sentences };
      else now.error = 'Nothing WordSnap could write there stayed with your text. Write that part yourself.';
    } else if (!res.aborted) now.error = res.error;
    this.emit();
  }

  shapeAction(action: 'applied' | 'kept'): void {
    const sh = this.st.shape;
    if (!sh || (sh.status !== 'open' && sh.status !== 'error')) return;
    this.abort('fill');
    sh.status = action;
    delete sh.filling;
    this.emit();
  }

  async tweak(req: TweakRequest): Promise<void> {
    const snap = this.snapshot;
    if (!snap || this.closed) return;
    const prev = this.st.tweak;
    const current = req.mode !== 'new' && prev?.id === req.id ? prev.steps[prev.steps.length - 1]?.text : undefined;
    if (req.mode !== 'new' && current === undefined) return;
    const steps = req.mode === 'new' ? [] : prev!.steps;
    const scope = req.mode === 'new' ? req.scope : prev?.scope;
    this.st.tweak = { id: req.id, quote: req.quote, span: req.span, forVersion: snap.version, steps, status: 'running', ...(scope ? { scope } : {}) };
    this.emit();
    const passage = current ?? req.quote;
    const request = buildTweak({ draft: snap.text, passage: req.quote, instruction: req.instruction, tune: this.st.tune, current, again: req.mode === 'again', scope });
    const run = this.traces?.beginRun('tweak', this.now());
    const res = await this.execute('tweak', request, run);
    this.finishRun(run);
    const tw = this.st.tweak;
    if (!tw || tw.id !== req.id) return;
    if (tw.status === 'stale') return this.emit();
    if (!res.ok) {
      if (res.aborted) return;
      this.st.tweak = { ...tw, status: 'error', error: res.error };
      return this.emit();
    }
    const v = validateTweak(res.result.data, { passage, draft: snap.text, instruction: req.instruction, scope });
    if (!v.ok) {
      log.warn(`${this.st.sessionKey}: tweak rejected (${v.reason})`);
      this.st.tweak = { ...tw, status: 'error', error: v.message };
      return this.emit();
    }
    const step = v.note ? { instruction: req.instruction, text: v.text, note: v.note } : { instruction: req.instruction, text: v.text };
    // Again replaces the last version; refine adds on top of it.
    const next = req.mode === 'again' ? [...tw.steps.slice(0, -1), { ...step, instruction: tw.steps[tw.steps.length - 1]!.instruction }] : [...tw.steps, step];
    this.st.tweak = { ...tw, steps: next, status: 'open' };
    this.emit();
  }

  tweakAction(id: string, action: 'applied' | 'kept'): void {
    const tw = this.st.tweak;
    if (!tw || tw.id !== id) return;
    this.abort('tweak');
    if (action === 'applied' && tw.steps.length) this.st.applied = [{ instruction: tw.steps.map((s) => s.instruction).join(' → '), quote: tw.quote, ...(tw.scope ? { scope: tw.scope } : {}) }, ...this.st.applied].slice(0, 20);
    this.st.tweak = undefined;
    this.emit();
  }

  close(): void {
    this.closed = true;
    for (const p of ['shape', 'fill', 'tweak', 'revise'] as CowriterPassId[]) this.abort(p);
  }

  /* ---------------- internals ---------------- */

  private abort(pass: CowriterPassId): void {
    this.controllers[pass]?.abort();
    delete this.controllers[pass];
  }

  /**
   * One extra request after a validated shape dropped sentences only because their `from` quotes did not locate
   * (the model cited corrected wording instead of the dump's own): ask it to re-quote just those sentences, patch
   * the raw PassShape's `from` with what locates, and let the caller revalidate. Runs at most once per shape call,
   * shares that shape's trace run, and returns null (fall back to the first validation, not an error) on any failure.
   */
  private async requote(dump: string, raw: PassShape, unsourced: UnsourcedSentence[], run: RunTrace | undefined): Promise<PassShape | null> {
    const req = buildRequote({ dump, sentences: unsourced.map((u) => ({ text: u.text, from: u.from })) });
    const res = await this.execute('shape', req, run);
    if (!res.ok) return null;
    const quotes = res.result.data.quotes;
    const patched: PassShape = structuredClone(raw);
    let recovered = 0;
    unsourced.forEach((u, i) => {
      const q = quotes[i];
      if (!q?.length) return;
      const s = patched.paragraphs[u.paragraph]?.sentences[u.sentence];
      if (!s) return;
      const located = q.filter((x) => locateQuote(dump, x) !== null);
      if (located.length) {
        s.from = located;
        recovered += 1;
      }
    });
    log.info(`${this.st.sessionKey}: shape: re-quoted ${unsourced.length} sentence(s), ${recovered} recovered`);
    return patched;
  }

  private async execute<T>(pass: CowriterPassId, req: PassRequest<T>, run: RunTrace | undefined): Promise<{ ok: true; result: PassResult<T> } | { ok: false; aborted: boolean; error: string }> {
    this.abort(pass);
    const controller = new AbortController();
    this.controllers[pass] = controller;
    const span = run ? this.traces?.beginPass(pass, this.now()) : undefined;
    log.info(`${this.st.sessionKey}: ${pass} start (${req.user.length} chars, effort ${req.effort})`);
    let usage: PassUsage | undefined;
    let outcome: 'ok' | 'aborted' | 'error' = 'error';
    try {
      const result = await this.deps.provider().runPass(req, controller.signal, (e) => {
        if (e.type === 'mark' && span) this.traces!.mark(span, e.mark, this.now());
      });
      if (controller.signal.aborted) {
        outcome = 'aborted';
        return { ok: false, aborted: true, error: '' };
      }
      usage = result.usage;
      outcome = 'ok';
      this.account(result.usage);
      log.info(`${this.st.sessionKey}: ${pass} done (${result.usage.inputTokens} in, ${result.usage.outputTokens} out)`);
      return { ok: true, result };
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        outcome = 'aborted';
        return { ok: false, aborted: true, error: '' };
      }
      const pe = err instanceof ProviderError ? err : new ProviderError(err instanceof Error ? err.message : String(err), 'unknown');
      log.error(`${this.st.sessionKey}: ${pass} failed (${pe.kind}): ${pe.message}`);
      const error = pe.kind === 'rate_limit' && pe.retryAfterMs ? `Rate limited. Try again in ${Math.ceil(pe.retryAfterMs / 1000)}s.` : ERRORS[pe.kind];
      return { ok: false, aborted: false, error };
    } finally {
      if (this.controllers[pass] === controller) delete this.controllers[pass];
      if (span && run) this.traces!.endPass(span, outcome, this.now(), usage);
    }
  }

  /** Ends and logs a trace run this action opened. A no-op when tracing is off. */
  private finishRun(run: RunTrace | undefined): void {
    if (!run || !this.traces) return;
    this.traces.endRun(run, this.now());
    log.info(`${this.st.sessionKey}: ${formatRun(run)}`);
  }

  private account(u: PassUsage): void {
    const usd = estimateCostUsd(u, activeModel(this.deps.settings()));
    const t = this.st.usage;
    t.inputTokens += u.inputTokens;
    t.outputTokens += u.outputTokens;
    t.estCostUsd = Math.round((t.estCostUsd + usd) * 1e6) / 1e6;
    this.deps.onCost?.(usd);
  }

  private emit(): void {
    if (this.closed) return;
    const state = structuredClone(this.st);
    if (this.traces) state.trace = this.traces.snapshot();
    this.deps.emit(state);
  }
}

// Types re-used by the port and tests.
export type { PassFill, PassShape, PassTweak };
