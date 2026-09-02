// Code-enforced rules from the spec (section 7). The prompt asks nicely; this is what actually holds.
//  - every quote/anchor must locate in the current text, or the finding is dropped
//  - cited URLs must have appeared in this request's search results; a verdict with no surviving sources is unverifiable
//  - suggestions longer than 1.3x the quote are dropped (the finding stays as advice)
//  - overlapping spans are deduplicated, higher severity wins
import { locateQuote } from '../shared/anchoring';
import type { Challenge, Claim, ClarityFinding, PassA, PassB, PassC, Source, Verdict } from '../shared/schemas';
import type { Span } from '../shared/types';

export const MAX_SUGGESTION_RATIO = 1.3;

export interface Located<T> {
  span: Span;
  data: T;
}

const SEVERITY_RANK: Record<ClarityFinding['severity'], number> = { low: 0, medium: 1, high: 2 };

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function suggestionOk(quote: string, suggestion: string | undefined): boolean {
  if (!suggestion) return false;
  const s = suggestion.trim();
  if (!s) return false;
  if (s.length > Math.ceil(quote.length * MAX_SUGGESTION_RATIO) + 2) return false;
  if (s === quote) return false;
  return true;
}

export function validatePassA(result: PassA, text: string): { clarity: Located<ClarityFinding>[]; claims: Located<Claim>[] } {
  const clarity: Located<ClarityFinding>[] = [];
  for (const f of result.clarity) {
    const span = locateQuote(text, f.quote);
    if (!span) continue;
    const data: ClarityFinding = { ...f, quote: text.slice(span.start, span.end) };
    if (!suggestionOk(data.quote, data.suggestion)) delete data.suggestion;
    clarity.push({ span, data });
  }
  clarity.sort((a, b) => a.span.start - b.span.start);
  const deduped: Located<ClarityFinding>[] = [];
  for (const f of clarity) {
    const clash = deduped.findIndex((d) => overlaps(d.span, f.span));
    if (clash === -1) {
      deduped.push(f);
    } else if (SEVERITY_RANK[f.data.severity] > SEVERITY_RANK[deduped[clash]!.data.severity]) {
      deduped[clash] = f;
    }
  }

  const claims: Located<Claim>[] = [];
  const seenClaimSpans: Span[] = [];
  for (const c of result.claims) {
    const span = locateQuote(text, c.quote);
    if (!span) continue;
    if (seenClaimSpans.some((s) => overlaps(s, span))) continue;
    seenClaimSpans.push(span);
    claims.push({ span, data: { ...c, quote: text.slice(span.start, span.end) } });
  }
  claims.sort((a, b) => a.span.start - b.span.start);
  return { clarity: deduped, claims };
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

export function filterSources(sources: Source[], sourcesSeen: string[]): Source[] {
  const seen = new Set(sourcesSeen.map(normalizeUrl));
  const out: Source[] = [];
  const used = new Set<string>();
  for (const s of sources) {
    const key = normalizeUrl(s.url);
    if (!seen.has(key) || used.has(key)) continue;
    used.add(key);
    out.push(s);
  }
  return out;
}

/** `claims` are the claims that were sent, keyed by the ids the model must echo. */
export function validatePassB(result: PassB, claims: Claim[], text: string, sourcesSeen: string[]): Verdict[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const out: Verdict[] = [];
  const done = new Set<string>();
  for (const v of result.verdicts) {
    const claim = byId.get(v.claimId);
    if (!claim || done.has(v.claimId)) continue;
    done.add(v.claimId);
    const sources = filterSources(v.sources, sourcesSeen);
    let status = v.status;
    if (sources.length === 0 && status !== 'unverifiable') status = 'unverifiable';
    const verdict: Verdict = { ...v, status, sources };
    const quote = locateQuote(text, claim.quote) ? claim.quote : null;
    if (!quote || !suggestionOk(claim.quote, verdict.suggestion)) delete verdict.suggestion;
    out.push(verdict);
  }
  return out;
}

export interface LocatedChallenge {
  spans: Span[];
  data: Challenge;
}

export function validatePassC(result: PassC, text: string, sourcesSeen: string[]): { thesis: string; premises: string[]; challenges: LocatedChallenge[] } {
  const challenges: LocatedChallenge[] = [];
  for (const ch of result.challenges) {
    const spans: Span[] = [];
    const anchors: string[] = [];
    for (const a of ch.anchors) {
      const span = locateQuote(text, a);
      if (!span) continue;
      spans.push(span);
      anchors.push(text.slice(span.start, span.end));
    }
    if (!spans.length) continue;
    spans.sort((a, b) => a.start - b.start);
    challenges.push({ spans, data: { ...ch, anchors, sources: filterSources(ch.sources, sourcesSeen) } });
  }
  return { thesis: result.thesis, premises: result.premises, challenges: challenges.slice(0, 5) };
}
