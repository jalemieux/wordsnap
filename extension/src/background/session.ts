// Session state holder: anchors pass results into the state, keeps ids stable across runs,
// shifts spans on edits and marks findings stale when their text changed.
import { paragraphIndexAt, shiftSpans, stableId } from '../shared/anchoring';
import type { Located, LocatedChallenge } from '../passes/validate';
import type { Claim, ClarityFinding, Verdict } from '../shared/schemas';
import type { Anchored, AnchoredChallenge, ClaimWithVerdict, HostId, SessionState, Span, TextSnapshot } from '../shared/types';
import { emptySession } from '../shared/types';

export class Session {
  state: SessionState;
  snapshot: TextSnapshot | null = null;
  /** Snapshot the last completed pass A analyzed. */
  analyzedSnapshot: TextSnapshot | null = null;

  constructor(sessionKey: string, host: HostId) {
    this.state = emptySession(sessionKey, host);
  }

  /** New text arrived: shift spans, mark changed open findings stale, drop what disappeared. */
  applySnapshot(next: TextSnapshot): void {
    const prev = this.snapshot;
    this.snapshot = next;
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

  applyAction(findingId: string, action: 'applied' | 'kept'): boolean {
    const all: Anchored<unknown>[] = [...this.state.clarity, ...this.state.claims, ...this.state.challenges];
    const f = all.find((x) => x.id === findingId);
    if (!f) return false;
    f.status = action;
    return true;
  }

  setPass(pass: 'A' | 'B' | 'C', patch: Partial<SessionState['passes']['A']>): void {
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
