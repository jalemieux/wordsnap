// Builders that turn a snapshot into PassRequest objects. Pure; no I/O.
import type { PassRequest } from '../providers/types';
import type { Claim, ClarityFinding } from '../shared/schemas';
import { PassA, PassB, PassC, PassCThesis, PassS } from '../shared/schemas';
import type { Effort, TextSnapshot } from '../shared/types';
import { PASS_A_SYSTEM, PASS_B_SYSTEM, PASS_C_SYSTEM, PASS_S_SYSTEM } from './prompts';

export const RESEARCH_BUDGET = { B: 6, C: 4 } as const;

export interface DraftContext {
  subject?: string;
  platform?: 'email' | 'post';
}

function numberedDraft(snapshot: TextSnapshot): string {
  return snapshot.paragraphs
    .map((p, i) => `[P${i + 1}] ${snapshot.text.slice(p.start, p.end)}`)
    .join('\n\n');
}

function contextLine(ctx?: DraftContext): string {
  const bits: string[] = [];
  if (ctx?.platform) bits.push(`Medium: ${ctx.platform === 'email' ? 'email' : 'social post'}.`);
  if (ctx?.subject) bits.push(`Subject line: ${ctx.subject}`);
  return bits.length ? bits.join(' ') + '\n\n' : '';
}

export interface PassAOptions {
  effort: Effort;
  context?: DraftContext;
  /** 0-based indexes of paragraphs that changed since the last run; omit for a full run. */
  changedParagraphs?: number[];
  previous?: { clarity: ClarityFinding[]; claims: Claim[] };
  /** Default true. False when neither Polish nor Structure is on: the model is told to return no clarity findings. */
  clarity?: boolean;
  /** Default true. False when Facts is off: the model is told to extract no claims. */
  claims?: boolean;
}

export function buildPassA(snapshot: TextSnapshot, opts: PassAOptions): PassRequest<PassA> {
  let scope = '';
  if (opts.changedParagraphs && opts.changedParagraphs.length < snapshot.paragraphs.length) {
    const list = opts.changedParagraphs.map((i) => `P${i + 1}`).join(', ');
    scope = `Only these paragraphs changed since your last analysis: ${list}. Return findings and claims for those paragraphs only.\n\n`;
    if (opts.previous && (opts.previous.clarity.length || opts.previous.claims.length)) {
      scope += `Your previous findings for those paragraphs, for id continuity:\n${JSON.stringify(opts.previous)}\n\n`;
    }
  }
  if (opts.clarity === false) scope += 'Skip the clarity part this time: return an empty clarity array.\n\n';
  if (opts.claims === false) scope += 'Skip claim extraction this time: return an empty claims array.\n\n';
  return {
    pass: 'A',
    system: PASS_A_SYSTEM,
    user: `${contextLine(opts.context)}${scope}<draft>\n${numberedDraft(snapshot)}\n</draft>`,
    schema: PassA,
    effort: opts.effort,
  };
}

export interface PassBOptions {
  effort: Effort;
  blockedDomains: string[];
  context?: DraftContext;
}

/** Claims carry the orchestrator's stable ids; the model echoes them back as claimId. */
export function buildPassB(claims: Claim[], snapshot: TextSnapshot, opts: PassBOptions): PassRequest<PassB> {
  const list = claims.map((c) => ({ id: c.id, quote: c.quote, statement: c.statement, type: c.type }));
  return {
    pass: 'B',
    system: PASS_B_SYSTEM,
    user: `${contextLine(opts.context)}<draft>\n${numberedDraft(snapshot)}\n</draft>\n\nClaims to verify:\n<claims>\n${JSON.stringify(list, null, 2)}\n</claims>`,
    schema: PassB,
    effort: opts.effort,
    research: { maxSearches: RESEARCH_BUDGET.B, blockedDomains: opts.blockedDomains },
  };
}

export interface PassCOptions {
  effort: Effort;
  blockedDomains: string[];
  context?: DraftContext;
  /** Structure on, Challenge off: thesis and premises only, no challenges, no research, low effort. */
  thesisOnly?: boolean;
}

export function buildPassC(snapshot: TextSnapshot, opts: PassCOptions): PassRequest<PassC> {
  if (opts.thesisOnly) {
    return {
      pass: 'C',
      system: `${PASS_C_SYSTEM}\n\nThis run is thesis-only: state the thesis and the premises, return an empty challenges array, and do not search.`,
      user: `${contextLine(opts.context)}<draft>\n${numberedDraft(snapshot)}\n</draft>`,
      schema: PassCThesis,
      effort: 'low',
    };
  }
  return {
    pass: 'C',
    system: PASS_C_SYSTEM,
    user: `${contextLine(opts.context)}<draft>\n${numberedDraft(snapshot)}\n</draft>`,
    schema: PassC,
    effort: opts.effort,
    research: { maxSearches: RESEARCH_BUDGET.C, blockedDomains: opts.blockedDomains },
  };
}

export interface PassSOptions {
  effort: Effort;
  context?: DraftContext;
}

/** Structure: the whole draft, no research. Runs before A when the Structure check is on. */
export function buildPassS(snapshot: TextSnapshot, opts: PassSOptions): PassRequest<PassS> {
  return {
    pass: 'S',
    system: PASS_S_SYSTEM,
    user: `${contextLine(opts.context)}<draft>\n${numberedDraft(snapshot)}\n</draft>`,
    schema: PassS,
    effort: opts.effort,
  };
}
