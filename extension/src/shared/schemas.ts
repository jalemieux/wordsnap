// Wire schemas for the three passes. Zod is the source of truth; types derive from it.
// Every finding carries an exact `quote` that must be a substring of the submitted text.
// Offsets are never sent to or returned from the model.
import { z } from 'zod';

export const Source = z.object({
  url: z.string().url(),
  title: z.string(),
  publisher: z.string().optional(),
  date: z.string().optional(), // as printed on the page; not parsed
  quote: z.string().max(300).optional(), // supporting excerpt
});
export type Source = z.infer<typeof Source>;

export const ClarityFinding = z.object({
  id: z.string(),
  quote: z.string(),
  kind: z.enum(['fuzzy', 'hedge', 'structure', 'grammar', 'unsupported_leap']),
  note: z.string().max(280),
  suggestion: z.string().optional(), // replaces quote only; <= 1.3x its length (enforced in code)
  severity: z.enum(['low', 'medium', 'high']),
});
export type ClarityFinding = z.infer<typeof ClarityFinding>;

export const Claim = z.object({
  id: z.string(),
  quote: z.string(),
  statement: z.string(), // normalized, self-contained
  checkable: z.boolean(),
  type: z.enum(['statistic', 'event', 'attribution', 'causal', 'comparison', 'other']),
  entities: z.array(z.string()),
});
export type Claim = z.infer<typeof Claim>;

export const PassA = z.object({ clarity: z.array(ClarityFinding), claims: z.array(Claim) });
export type PassA = z.infer<typeof PassA>;

export const Verdict = z.object({
  claimId: z.string(),
  status: z.enum(['supported', 'needs_precision', 'contradicted', 'unverifiable']),
  finding: z.string().max(600),
  confidence: z.number().int().min(1).max(5),
  sources: z.array(Source).min(0).max(4),
  suggestion: z.string().optional(),
});
export type Verdict = z.infer<typeof Verdict>;

export const PassB = z.object({ verdicts: z.array(Verdict) });
export type PassB = z.infer<typeof PassB>;

export const Challenge = z.object({
  id: z.string(),
  kind: z.enum(['strongest_rebuttal', 'blind_spot', 'gap', 'evidence_quality']),
  title: z.string().max(120),
  body: z.string().max(700),
  howToAddress: z.string().max(280),
  anchors: z.array(z.string()).min(1).max(3), // exact quotes
  sources: z.array(Source).max(3),
});
export type Challenge = z.infer<typeof Challenge>;

export const PassC = z.object({
  thesis: z.string().max(280),
  premises: z.array(z.string()).max(5),
  challenges: z.array(Challenge).min(1).max(5), // strongest first
});
export type PassC = z.infer<typeof PassC>;
/** Pass C in thesis-only mode (Structure on, Challenge off): the challenges array is expected empty. */
export const PassCThesis = PassC.extend({ challenges: z.array(Challenge).max(5) });

/**
 * Structure pass: does the order of ideas serve the reader? `keeps` means yes and `paragraphs` is empty. `reorder`
 * carries the proposal: the writer's own sentences regrouped, paragraph by paragraph. Code checks the proposal reuses
 * the draft's words (src/passes/validate.ts) before it is shown.
 */
/**
 * One paragraph of an outline built from notes: its job for the reader, the writer's own fragments that belong in
 * it, and what the notes leave out. Nothing here is prose for the message.
 */
export const StructureSlot = z.object({
  role: z.string().max(24),
  job: z.string().max(160),
  from: z.array(z.string().max(400)).max(6),
  gap: z.string().max(200).optional(),
});
export type StructureSlot = z.infer<typeof StructureSlot>;

export const PassS = z.object({
  /** keeps: the order serves the reader. reorder: the same sentences regrouped. outline: the text is notes, not a draft; slots say what to write. */
  verdict: z.enum(['keeps', 'reorder', 'outline']),
  note: z.string().max(280),
  paragraphs: z.array(z.string().max(2000)).max(20),
  /** One short label per paragraph naming its job for the reader ("Ask", "Evidence"). Optional: older answers lack it. */
  roles: z.array(z.string().max(24)).max(20).optional(),
  /** Outline only: one entry per paragraph the message needs, in order. */
  slots: z.array(StructureSlot).max(12).optional(),
});
export type PassS = z.infer<typeof PassS>;
