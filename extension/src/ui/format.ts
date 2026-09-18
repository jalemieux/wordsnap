// Pure helpers for the overlay: text shaping for share targets, counts, relative time.
import { ALL_CHECKS, sameChecks, type CheckId, type Checks, SessionState } from '../shared/types';

export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Seconds to read at 230 words per minute, minimum 1. */
export function readSeconds(text: string): number {
  return Math.max(1, Math.round((wordCount(text) / 230) * 60));
}

/**
 * The shareable body: drops an email-style greeting (first paragraph ending with a comma or
 * with <= 4 words) and sign-off (last paragraph starting with a dash or with <= 3 words).
 */
export function bodyText(text: string): string {
  const ps = paragraphsOf(text);
  if (ps.length === 0) return '';
  const first = ps[0]!;
  if (ps.length > 1 && (/,$/.test(first) || wordCount(first) <= 4)) ps.shift();
  const last = ps[ps.length - 1]!;
  if (ps.length > 1 && (/^[—–-]/.test(last) || wordCount(last) <= 3)) ps.pop();
  return ps.join('\n\n');
}

const SENTENCE_RE = /[^.!?]+[.!?]+["”')\]]*\s*|[^.!?]+$/g;

/**
 * Split text into numbered posts of at most `limit` characters before numbering
 * (the " (i/n)" suffix stays inside 280). Text that already fits returns as one unnumbered post.
 */
export function splitForX(text: string, limit = 270): string[] {
  const flat = text.replace(/\s*\n\s*/g, ' ').trim();
  if (flat.length <= 280) return [flat];
  const sentences = flat.match(SENTENCE_RE) ?? [flat];
  const posts: string[] = [];
  let cur = '';
  for (const raw of sentences) {
    const s = raw;
    if ((cur + s).trim().length > limit && cur.trim()) {
      posts.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
    // A single sentence longer than the limit is hard-wrapped on word boundaries.
    while (cur.trim().length > limit) {
      const cut = cur.lastIndexOf(' ', limit);
      const at = cut > limit / 2 ? cut : limit;
      posts.push(cur.slice(0, at).trim());
      cur = cur.slice(at);
    }
  }
  if (cur.trim()) posts.push(cur.trim());
  const n = posts.length;
  return posts.map((p, i) => `${p} (${i + 1}/${n})`);
}

export function relativeTime(sinceMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - sinceMs) / 1000));
  if (s < 8) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

export const VERDICT_LABEL: Record<string, string> = {
  supported: 'Verified',
  needs_precision: 'Needs precision',
  contradicted: 'Contradicted',
  unverifiable: 'Unverifiable',
};

export const CLARITY_LABEL: Record<string, string> = {
  fuzzy: 'Fuzzy',
  hedge: 'Hedged',
  structure: 'Structure',
  grammar: 'Grammar',
  unsupported_leap: 'Unsupported leap',
};

export const CHALLENGE_LABEL: Record<string, string> = {
  strongest_rebuttal: 'Strongest rebuttal',
  blind_spot: 'Blind spot',
  gap: 'Gap',
  evidence_quality: 'Evidence quality',
};

const CHALLENGE_ORDER: Record<string, number> = { strongest_rebuttal: 0, evidence_quality: 1, blind_spot: 2, gap: 3 };

export function sortChallenges<T extends { data: { kind: string } }>(list: T[]): T[] {
  return [...list].sort((a, b) => (CHALLENGE_ORDER[a.data.kind] ?? 9) - (CHALLENGE_ORDER[b.data.kind] ?? 9));
}

/** Claims still open whose verdict is contradicted or needs precision. */
export function openIssueCount(state: SessionState): number {
  return state.claims.filter(
    (c) => c.status === 'open' && (c.data.verdict?.status === 'contradicted' || c.data.verdict?.status === 'needs_precision'),
  ).length;
}

export interface SummaryCounts {
  checked: number;
  contradicted: number;
  precision: number;
  challenges: number;
  clarity: number;
}

export function summaryCounts(state: SessionState): SummaryCounts {
  const open = state.claims.filter((c) => c.status === 'open');
  return {
    checked: state.claims.filter((c) => c.data.verdict).length,
    contradicted: open.filter((c) => c.data.verdict?.status === 'contradicted').length,
    precision: open.filter((c) => c.data.verdict?.status === 'needs_precision').length,
    challenges: state.challenges.filter((c) => c.status === 'open').length,
    clarity: state.clarity.filter((c) => c.status === 'open').length,
  };
}

/** True once an analysis has started and the draft has changed since. */
export function draftChanged(state: SessionState): boolean {
  return state.analyzedVersion !== undefined && state.snapshotVersion !== state.analyzedVersion;
}

/** True once an analysis has run and a check chip was flipped since. */
export function checksChanged(state: SessionState): boolean {
  return state.analyzedChecks !== undefined && !sameChecks(state.analyzedChecks, checksOf(state));
}

/** Checks in effect for a state; a state from a worker that predates the picker means everything on. */
export function checksOf(state: SessionState): Checks {
  return state.checks ?? ALL_CHECKS;
}

export const CHECK_LABEL: Record<CheckId, string> = { structure: 'Structure', polish: 'Polish', facts: 'Facts', challenge: 'Challenge' };
export const CHECK_HINT: Record<CheckId, string> = {
  structure: 'A proposed order for your own sentences when the point is buried, your thesis as a reader will hear it, and where the narrative loses them.',
  polish: 'Fuzzy sentences, hedges, filler. A tighter phrasing in your register.',
  facts: 'Every factual claim verified with sources.',
  challenge: 'The strongest counterargument, the blind spots, the gaps.',
};

/** Something on screen is waiting for a fresh run: a finding whose text changed, or a proposal the draft moved past. */
export function staleFindings(state: SessionState): boolean {
  return (
    state.clarity.some((f) => f.status === 'stale') ||
    state.claims.some((f) => f.status === 'stale') ||
    state.challenges.some((f) => f.status === 'stale') ||
    state.structure?.status === 'stale'
  );
}

/** A structure proposal is on screen and the other passes are waiting for Apply or Keep. */
export function structureOpen(state: SessionState): boolean {
  return (state.structure?.verdict === 'reorder' || state.structure?.verdict === 'outline') && state.structure.status === 'open';
}

/** An applied outline is beside the draft while the user writes into it; nothing waits on it. */
export function structureGuiding(state: SessionState): boolean {
  return state.structure?.verdict === 'outline' && state.structure.status === 'guiding';
}

export function anyRunning(state: SessionState): boolean {
  return Object.values(state.passes).some((p) => p.state === 'running');
}

export function lastCheckedAt(state: SessionState): number | undefined {
  const ats = Object.values(state.passes)
    .map((p) => p.at)
    .filter((n): n is number => typeof n === 'number');
  return ats.length ? Math.max(...ats) : undefined;
}

export function firstError(state: SessionState): string | undefined {
  for (const p of Object.values(state.passes)) if (p.state === 'error' && p.error) return p.error;
  return undefined;
}

/** Does a post still contain an open, contradicted claim's text? */
export function containsOpenContradiction(post: string, state: SessionState, text: string): boolean {
  return state.claims.some((c) => {
    if (c.status !== 'open' || c.data.verdict?.status !== 'contradicted' || !c.span) return false;
    const current = text.slice(c.span.start, c.span.end);
    return current.length > 0 && post.includes(current);
  });
}
