// Session state holder: anchors pass results into the state, keeps ids stable across runs,
// shifts spans on edits and marks findings stale when their text changed.
import { paragraphIndexAt, shiftSpans, stableId } from '../shared/anchoring';
import { CHECK_IDS, structureMode } from '../shared/types';
import type { Located, LocatedChallenge } from '../passes/validate';
import type { Claim, ClarityFinding, Verdict } from '../shared/schemas';
import type { Anchored, AnchoredChallenge, ClaimWithVerdict, HostId, PassId, SessionState, Span, StructureResult, TextSnapshot } from '../shared/types';
import { EMPTY_PASSES, emptySession, type Checks, type ClarityKindFilter } from '../shared/types';
import type { StructureProposal } from '../passes/validate';

/** Everything needed to pick a session up after the service worker restarts. */
export interface SavedSession {
  state: SessionState;
  snapshot: TextSnapshot | null;
  analyzedSnapshot: TextSnapshot | null;
}

export class Session {
  state: SessionState;
  snapshot: TextSnapshot | null = null;
  /** Snapshot the last completed pass A analyzed. */
  analyzedSnapshot: TextSnapshot | null = null;

  constructor(sessionKey: string, host: HostId) {
    this.state = emptySession(sessionKey, host);
  }

  dump(): SavedSession {
    return structuredClone({ state: this.state, snapshot: this.snapshot, analyzedSnapshot: this.analyzedSnapshot });
  }

  load(saved: SavedSession): void {
    this.state = structuredClone(saved.state);
    this.snapshot = saved.snapshot ? structuredClone(saved.snapshot) : null;
    this.analyzedSnapshot = saved.analyzedSnapshot ? structuredClone(saved.analyzedSnapshot) : null;
    // A state saved by a worker that predates the structure pass has no S entry.
    if (!this.state.passes.S) this.state.passes.S = { ...EMPTY_PASSES.S };
    // A run that was in flight when the worker stopped never finished; do not show it as running.
    for (const p of Object.values(this.state.passes)) if (p.state === 'running') p.state = p.at ? 'done' : 'idle';
  }

  /** New text arrived: shift spans, mark changed open findings stale, drop what disappeared. */
  applySnapshot(next: TextSnapshot): void {
    const prev = this.snapshot;
    this.snapshot = next;
    // Same text under a new version (the host echoing an applied edit, an undo that lands on analyzed text): the
    // analysis still stands for it, so the panel must not report the draft as changed.
    if (prev && prev.text === next.text && this.state.analyzedVersion === prev.version) this.state.analyzedVersion = next.version;
    this.state.snapshotVersion = next.version;
    if (!prev || prev.text === next.text) return;

    const shiftOne = <T>(items: Anchored<T>[]): Anchored<T>[] => {
      const spans = items.map((f) => f.span ?? { start: 0, end: 0 });
      const shifted = shiftSpans(prev.text, next.text, spans);
      const out: Anchored<T>[] = [];
      items.forEach((f, i) => {
        if (!f.span) return;
        const s = shifted[i]!;
        if (!s.span) return; // deleted text: drop
        const status = f.status === 'open' && s.changed ? 'stale' : f.status;
        out.push({ ...f, span: s.span, quote: next.text.slice(s.span.start, s.span.end), status });
      });
      return out;
    };

    this.state.clarity = shiftOne(this.state.clarity);
    this.state.claims = shiftOne(this.state.claims);
    // A proposal is for one text; once the text moves on, the user needs a fresh one.
    if (this.state.structure?.status === 'open') this.state.structure.status = 'stale';

    const challenges: AnchoredChallenge[] = [];
    for (const ch of this.state.challenges) {
      const shifted = shiftSpans(prev.text, next.text, ch.spans);
      const spans = shifted.filter((s) => s.span).map((s) => s.span!);
      if (!spans.length) continue;
      const changed = shifted.some((s) => s.changed);
      const status = ch.status === 'open' && changed ? 'stale' : ch.status;
      challenges.push({ ...ch, spans, span: spans[0]!, quote: next.text.slice(spans[0]!.start, spans[0]!.end), status });
    }
    this.state.challenges = challenges;
  }

  /** Paragraph indexes (in the current snapshot) that contain any open challenge anchor or, when no challenges, all. */
  challengeParagraphs(): Set<number> {
    const out = new Set<number>();
    if (!this.snapshot) return out;
    for (const ch of this.state.challenges) {
      if (ch.status === 'kept') continue;
      for (const s of ch.spans) out.add(paragraphIndexAt(this.snapshot, s.start));
    }
    return out;
  }

  /**
   * Merge a validated pass A result. `scopeParagraphs` limits replacement to findings inside those paragraphs
   * (incremental run); omit for a full run. Returns the claims that are new or changed and need verification.
   */
  mergePassA(located: { clarity: Located<ClarityFinding>[]; claims: Located<Claim>[] }, scopeParagraphs?: number[]): ClaimWithVerdict[] {
    const snap = this.snapshot;
    if (!snap) return [];
    const inScope = (span: Span | null): boolean => {
      if (!scopeParagraphs) return true;
      if (!span) return true;
      return scopeParagraphs.includes(paragraphIndexAt(snap, span.start));
    };

    // clarity
    const incomingClarity: Anchored<ClarityFinding>[] = located.clarity.map((l) => {
      const id = stableId('cl', `${l.data.kind}|${l.data.quote}`);
      return { id, span: l.span, quote: l.data.quote, status: 'open', data: { ...l.data, id } };
    });
    this.state.clarity = mergeList(this.state.clarity, incomingClarity, inScope);

    // claims
    const incomingClaims: Anchored<ClaimWithVerdict>[] = located.claims.map((l) => {
      const id = stableId('cm', l.data.quote);
      return { id, span: l.span, quote: l.data.quote, status: 'open', data: { ...l.data, id } };
    });
    const before = new Map(this.state.claims.map((c) => [c.id, c]));
    this.state.claims = mergeList(this.state.claims, incomingClaims, inScope, (existing, incoming) => {
      // keep a verdict when the quote is unchanged
      if (existing.quote === incoming.quote && existing.data.verdict) incoming.data.verdict = existing.data.verdict;
      return incoming;
    });
    this.analyzedSnapshot = snap;

    return this.state.claims.filter((c) => {
      if (!c.data.checkable || c.status === 'kept') return false;
      if (c.data.verdict) return false;
      const prev = before.get(c.id);
      return !prev || !prev.data.verdict || prev.quote !== c.quote;
    }).map((c) => c.data);
  }

  attachVerdicts(verdicts: Verdict[]): void {
    for (const v of verdicts) {
      const claim = this.state.claims.find((c) => c.id === v.claimId);
      if (!claim) continue;
      claim.data.verdict = v;
      if (claim.status === 'stale') claim.status = 'open';
    }
  }

  /**
   * The chips changed. A check turned off is pruned here and needs no run; one turned on shows as stale until the
   * next run: `analyzedChecks` tracks what the findings on screen still reflect, so it loses the pruned checks too.
   */
  applyChecks(checks: Checks, keep: ClarityKindFilter): void {
    const before = this.state.checks;
    this.state.checks = { ...checks };
    if (this.state.analyzedChecks) {
      const a = this.state.analyzedChecks;
      this.state.analyzedChecks = Object.fromEntries(CHECK_IDS.map((k) => [k, !!a[k] && checks[k]])) as Checks;
    }
    this.state.clarity = this.state.clarity.filter((f) => keep(f.data.kind));
    if (!checks.facts) this.state.claims = [];
    if (!checks.challenge) this.state.challenges = [];
    const mode = structureMode(checks);
    if (!checks.challenge && !mode) this.state.argument = undefined;
    // A structure result belongs to the job that produced it: none, or the other job, and it goes.
    if (!mode || (before && structureMode(before) !== mode)) this.state.structure = undefined;
    if (before && structureMode(before) !== mode) this.state.elaborated = undefined;
  }

  mergePassC(result: { thesis: string; premises: string[]; challenges: LocatedChallenge[] }): void {
    this.state.argument = { thesis: result.thesis, premises: result.premises };
    const kept = new Map(this.state.challenges.filter((c) => c.status === 'kept' || c.status === 'applied').map((c) => [c.id, c]));
    const out: AnchoredChallenge[] = [];
    for (const l of result.challenges) {
      const id = stableId('ch', l.data.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
      const existing = kept.get(id);
      if (existing) {
        out.push({ ...existing, spans: l.spans, span: l.spans[0]!, quote: l.data.anchors[0] ?? existing.quote });
        continue;
      }
      out.push({ id, span: l.spans[0]!, spans: l.spans, quote: l.data.anchors[0] ?? '', status: 'open', data: { ...l.data, id } });
    }
    this.state.challenges = out;
  }

  /** Record what the structure pass said about the current snapshot. A reorder waits on the user; a keeps needs nothing. */
  setStructure(proposal: StructureProposal, forVersion: number): void {
    const status: StructureResult['status'] = proposal.verdict === 'keeps' ? 'kept' : 'open';
    this.state.structure = { ...proposal, status, forVersion };
  }

  /**
   * The user acted on the proposal. Applying a reorder finishes it; applying an outline moves it to `guiding`, where
   * it stays beside the draft until `done`. False when there was nothing to act on.
   */
  applyStructureAction(action: 'applied' | 'kept' | 'done'): boolean {
    const st = this.state.structure;
    if (!st || st.verdict === 'keeps') return false;
    const next: StructureResult['status'] = action === 'applied' && st.verdict === 'outline' ? 'guiding' : action === 'done' ? 'applied' : action;
    if (action === 'done' && st.status !== 'guiding') return false;
    if (st.status === next) return false;
    st.status = next;
    if (action === 'done') this.state.elaborated = true;
    return true;
  }

  /** Drop a finding entirely (after the user changed its text and asked for a re-check). */
  removeFinding(findingId: string): boolean {
    const n = this.state.clarity.length + this.state.claims.length + this.state.challenges.length;
    this.state.clarity = this.state.clarity.filter((f) => f.id !== findingId);
    this.state.claims = this.state.claims.filter((f) => f.id !== findingId);
    this.state.challenges = this.state.challenges.filter((f) => f.id !== findingId);
    return this.state.clarity.length + this.state.claims.length + this.state.challenges.length < n;
  }

  applyAction(findingId: string, action: 'applied' | 'kept'): boolean {
    const all: Anchored<unknown>[] = [...this.state.clarity, ...this.state.claims, ...this.state.challenges];
    const f = all.find((x) => x.id === findingId);
    if (!f) return false;
    f.status = action;
    return true;
  }

  setPass(pass: PassId, patch: Partial<SessionState['passes']['A']>): void {
    this.state.passes[pass] = { ...this.state.passes[pass], ...patch };
  }
}

function mergeList<T>(
  existing: Anchored<T>[],
  incoming: Anchored<T>[],
  inScope: (span: Span | null) => boolean,
  onReplace?: (existing: Anchored<T>, incoming: Anchored<T>) => Anchored<T>,
): Anchored<T>[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const out: Anchored<T>[] = [];
  const consumed = new Set<string>();

  for (const inc of incoming) {
    const prev = byId.get(inc.id);
    if (prev) {
      consumed.add(inc.id);
      if (prev.status === 'kept' || prev.status === 'applied') {
        out.push({ ...prev, span: inc.span, quote: inc.quote });
        continue;
      }
      out.push(onReplace ? onReplace(prev, inc) : inc);
      continue;
    }
    // new finding; avoid duplicating an existing one that overlaps the same text
    const overlap = existing.find((e) => e.span && inc.span && e.span.start < inc.span.end && inc.span.start < e.span.end && !consumed.has(e.id));
    if (overlap && (overlap.status === 'kept' || overlap.status === 'applied')) {
      consumed.add(overlap.id);
      out.push(overlap);
      continue;
    }
    if (overlap) consumed.add(overlap.id);
    out.push(inc);
  }

  for (const e of existing) {
    if (consumed.has(e.id)) continue;
    if (!inScope(e.span)) {
      out.push(e); // outside the re-analyzed paragraphs: untouched
      continue;
    }
    if (e.status === 'kept' || e.status === 'applied') {
      if (e.span) out.push(e);
      continue;
    }
    // open or stale inside scope and not re-reported: gone
  }
  out.sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));
  return out;
}
