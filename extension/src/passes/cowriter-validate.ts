// The co-writer line in code: your ideas, its words. What Shape, Fill and Tweak return is checked against the
// writer's own text before anything reaches the UI. Pure.
import { locateQuote } from '../shared/anchoring';
import type { Comment, ReviseChange, ShapeChoice, ShapeParagraph, ShapeView, TweakScope } from '../shared/cowriter';
import type { PassFill, PassRevise, PassShape, PassTweak } from '../shared/schemas';

export const BRIDGE_MAX_WORDS = 25;
export const BRIDGE_MAX_SHARE = 0.25;
export const SHAPE_MIN_SURVIVING = 0.5;
export const TWEAK_MAX_RATIO = 2.5;
/** A draft-wide change (a term renamed, a habit dropped) leaves the length about where it was. */
export const TWEAK_DRAFT_MAX_RATIO = 1.3;
export const FILL_MAX = 3;
export const SHAPE_REJECTED = 'Shape could not stay with your text; try again.';
export const TWEAK_REJECTED = 'That change added something you did not write; try again.';
export const TWEAK_TOO_LONG = 'That came back far longer than the passage. For a change across the whole draft, use the box in the panel.';
export const TWEAK_DRAFT_TOO_LONG = 'That came back far longer than your draft; try again.';
export const REVISE_REJECTED = 'Revise could not act on any comment; try again.';

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const clean = (t: string) => t.replace(/\s+/g, ' ').trim();

/**
 * Tokens in `text` that carry a fact the source does not: anything with a digit, a link, or a capitalized word that
 * does not start a sentence (a name). Matched against the source case-insensitively.
 */
export function unseenTokens(text: string, source: string): string[] {
  const src = source.toLowerCase();
  const out: string[] = [];
  let sentenceStart = true;
  // Regexes using \uXXXX escapes for curly quotes to prevent flattening:
  // “ = " (left double), ‘ = ' (left single)
  // ” = " (right double), ’ = ' (right single)
  const stripLeading = new RegExp('^[(\\u201c\\u2018[]+');
  const stripTrailing = new RegExp('[)\\u201d\\u2019\\].,;:!?]+$');
  const checkName = new RegExp('^[A-Z][A-Za-z\\u2018\\u2019\'\'-]+$');
  const checkI = new RegExp('^I([\\u2018\\u2019].*)?$');
  const checkSentenceEnd = new RegExp('[.!?:][)\\u201d\\u2019\\]]*$');

  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const w = raw.replace(stripLeading, '').replace(stripTrailing, '');
    const isUrl = /^(https?:\/\/|www\.)/i.test(w);
    const hasDigit = /\d/.test(w);
    const isName = !sentenceStart && checkName.test(w) && !checkI.test(w);
    if (w && (isUrl || hasDigit || isName) && !src.includes(w.toLowerCase())) out.push(w);
    sentenceStart = checkSentenceEnd.test(raw);
  }
  return out;
}

type Kept = { text: string; from: string[]; bridge: boolean; key: string };

/** A sentence Shape wrote whose `from` quotes did not locate in the dump: a candidate for the re-quote pass. Indexes into the raw PassShape. */
export interface UnsourcedSentence {
  paragraph: number;
  sentence: number;
  text: string;
  from: string[];
}

export function validateShape(
  raw: PassShape,
  dump: string,
): { ok: true; view: ShapeView; notes: string[]; unsourced: UnsourcedSentence[] } | { ok: false; reason: string; notes: string[]; unsourced: UnsourcedSentence[] } {
  const notes: string[] = [];
  const unsourced: UnsourcedSentence[] = [];
  const locates = (q: string) => !!q.trim() && locateQuote(dump, q) !== null;
  let total = 0;
  const paras: { role?: string; sentences: Kept[] }[] = [];

  raw.paragraphs.forEach((p, pi) => {
    const kept: Kept[] = [];
    p.sentences.forEach((s, si) => {
      total += 1;
      const text = clean(s.text);
      const rawFrom = s.from.map(clean);
      const from = rawFrom.filter(locates);
      const bridge = !!s.bridge;
      const unseen = unseenTokens(text, dump);
      if (!text) return;
      if (unseen.length) return void notes.push(`new fact (${unseen.join(', ')}): ${text}`);
      if (bridge && words(text) > BRIDGE_MAX_WORDS) return void notes.push(`bridge over ${BRIDGE_MAX_WORDS} words: ${text}`);
      if (!bridge && !from.length) {
        unsourced.push({ paragraph: pi, sentence: si, text, from: rawFrom });
        const cited = rawFrom.length ? ` [from: ${rawFrom.map((q) => `"${q}"`).join(' | ')}]` : '';
        return void notes.push(`no source in the dump: ${text}${cited}`);
      }
      kept.push({ text, from, bridge, key: `${pi}:${si}` });
    });
    paras.push({ role: p.role?.trim() || undefined, sentences: kept });
  });

  // One sentence in four may be a bridge; the extra ones go, last first.
  const all = paras.flatMap((p) => p.sentences);
  const maxBridges = Math.floor(all.length * BRIDGE_MAX_SHARE);
  const bridges = all.filter((s) => s.bridge);
  const over = new Set(bridges.slice(maxBridges).map((s) => s.key));
  for (const p of paras) p.sentences = p.sentences.filter((s) => !over.has(s.key) || void notes.push(`bridge over the one-in-four share: ${s.text}`));

  const surviving = paras.reduce((n, p) => n + p.sentences.length, 0);
  if (surviving < total * SHAPE_MIN_SURVIVING || surviving === 0) return { ok: false, reason: `${surviving} of ${total} sentences survived`, notes, unsourced };

  const nonEmpty = paras.filter((p) => p.sentences.length);
  const where = new Map<string, [number, number]>();
  nonEmpty.forEach((p, pi) => p.sentences.forEach((s, si) => where.set(s.key, [pi, si])));
  const paragraphs: ShapeParagraph[] = nonEmpty.map((p) => ({ ...(p.role ? { role: p.role } : {}), sentences: p.sentences.map(({ text, from, bridge }) => ({ text, from, bridge })) }));

  const choices: ShapeChoice[] = [];
  for (const c of raw.choices) {
    const at = where.get(`${c.paragraph}:${c.sentence}`);
    const altFrom = c.alt.from.map(clean).filter(locates);
    const altText = clean(c.alt.text);
    if (!at || !locates(c.kept) || !locates(c.other) || !altFrom.length || !altText || unseenTokens(altText, dump).length) {
      notes.push(`choice dropped: ${c.topic}`);
      continue;
    }
    choices.push({ topic: clean(c.topic), kept: clean(c.kept), other: clean(c.other), paragraph: at[0], sentence: at[1], alt: { text: altText, from: altFrom } });
  }

  const dropped = raw.dropped.filter((d) => locates(d.quote)).map((d) => ({ quote: clean(d.quote), why: clean(d.why) }));
  const missing = raw.missing.filter((m) => clean(m.what)).map((m) => ({ what: clean(m.what), after: Math.min(m.after, paragraphs.length - 1) }));
  return { ok: true, view: { note: clean(raw.note), paragraphs, choices, dropped, missing }, notes, unsourced };
}

export function validateFill(raw: PassFill, dump: string): string[] {
  return raw.sentences
    .map((s) => clean(s.text))
    .filter((t) => t && words(t) <= BRIDGE_MAX_WORDS && !unseenTokens(t, dump).length)
    .slice(0, FILL_MAX);
}

const ASKS_FOR_MORE = /\b(longer|expand|add|elaborate|more detail|more context|flesh)\b/i;

/** `message` is what the card shows; `reason` is for the log. */
export function validateTweak(raw: PassTweak, input: { passage: string; draft: string; instruction: string; scope?: TweakScope }): { ok: true; text: string; note?: string } | { ok: false; reason: string; message: string } {
  const text = raw.replacement.trim();
  if (!text) return { ok: false, reason: 'empty replacement', message: TWEAK_REJECTED };
  const unseen = unseenTokens(text, `${input.draft}\n${input.passage}\n${input.instruction}`);
  if (unseen.length) return { ok: false, reason: `new fact (${unseen.join(', ')})`, message: TWEAK_REJECTED };
  const draftWide = input.scope === 'draft';
  const ratio = draftWide ? TWEAK_DRAFT_MAX_RATIO : TWEAK_MAX_RATIO;
  if (!ASKS_FOR_MORE.test(input.instruction) && text.length > input.passage.length * ratio) {
    return { ok: false, reason: `over ${ratio}x the ${draftWide ? 'draft' : 'passage'}`, message: draftWide ? TWEAK_DRAFT_TOO_LONG : TWEAK_TOO_LONG };
  }
  const note = raw.note?.trim();
  return note ? { ok: true, text, note } : { ok: true, text };
}

/**
 * Revise: every proposed change is tied back to a comment and to the draft. A change answers one passage comment and
 * replaces exactly that span; an edit answers a whole-draft comment and must copy a fragment that locates. Anything
 * that overlaps an earlier accepted span, brings in a fact the comment and the draft do not have, outgrows its
 * span, or answers no comment is dropped. What survives is sorted by position and never overlaps, so Apply can splice.
 */
export function validateRevise(
  raw: PassRevise,
  input: { draft: string; comments: Comment[] },
): { ok: true; changes: ReviseChange[]; skipped: { comment: string; why: string }[]; note?: string; notes: string[] } | { ok: false; reason: string; notes: string[] } {
  const notes: string[] = [];
  const skipped: { comment: string; why: string }[] = [];
  const answered = new Set<string>();
  const accepted: ReviseChange[] = [];
  const byNumber = (n: number) => input.comments[n - 1];
  const overlaps = (s: { start: number; end: number }) => accepted.some((c) => c.span.start < s.end && c.span.end > s.start);
  const fits = (text: string, passage: string, comment: Comment, kind: string): string | null => {
    const unseen = unseenTokens(text, `${input.draft}\n${comment.text}`);
    if (unseen.length) return `${kind} for comment "${comment.text}" brings in ${unseen.join(', ')}`;
    if (!ASKS_FOR_MORE.test(comment.text) && text.length > passage.length * TWEAK_MAX_RATIO) return `${kind} for comment "${comment.text}" is over ${TWEAK_MAX_RATIO}x its span`;
    return null;
  };

  for (const ch of raw.changes) {
    const c = byNumber(ch.comment);
    if (!c || !c.quote || answered.has(c.id)) {
      notes.push(`change for comment ${ch.comment}: ${!c ? 'no such comment' : !c.quote ? 'that comment is on the whole draft' : 'already answered'}`);
      continue;
    }
    const span = locateQuote(input.draft, c.quote, c.span?.start);
    if (!span) {
      answered.add(c.id);
      skipped.push({ comment: c.id, why: 'The passage moved or changed.' });
      continue;
    }
    const passage = input.draft.slice(span.start, span.end);
    const text = ch.replacement.trim();
    answered.add(c.id);
    if (!text || clean(text) === clean(passage)) {
      skipped.push({ comment: c.id, why: ch.note?.trim() || 'Came back unchanged.' });
      continue;
    }
    const bad = fits(text, passage, c, 'change');
    if (bad) {
      notes.push(bad);
      skipped.push({ comment: c.id, why: 'The answer brought in something you did not write.' });
      continue;
    }
    if (overlaps(span)) {
      notes.push(`change for comment "${c.text}" overlaps another change`);
      skipped.push({ comment: c.id, why: 'This passage is already changed by another comment.' });
      continue;
    }
    const note = ch.note?.trim();
    accepted.push({ comment: c.id, span, quote: passage, replacement: text, ...(note ? { note } : {}) });
  }

  const editCount = new Map<string, number>();
  for (const e of raw.edits) {
    const c = byNumber(e.comment);
    if (!c || c.quote) {
      notes.push(`edit for comment ${e.comment}: ${!c ? 'no such comment' : 'that comment is on a passage'}`);
      continue;
    }
    const span = locateQuote(input.draft, e.quote);
    if (!span) {
      notes.push(`edit for comment "${c.text}": fragment not in the draft: ${e.quote}`);
      continue;
    }
    const passage = input.draft.slice(span.start, span.end);
    const text = e.replacement.trim();
    if (clean(text) === clean(passage)) continue;
    const bad = fits(text, passage, c, 'edit');
    if (bad) {
      notes.push(bad);
      continue;
    }
    if (overlaps(span)) {
      notes.push(`edit for comment "${c.text}" overlaps another change: ${e.quote}`);
      continue;
    }
    accepted.push({ comment: c.id, span, quote: passage, replacement: text });
    editCount.set(c.id, (editCount.get(c.id) ?? 0) + 1);
  }
  for (const [id] of editCount) answered.add(id);

  for (const sk of raw.skipped) {
    const c = byNumber(sk.comment);
    if (!c || answered.has(c.id)) continue;
    answered.add(c.id);
    skipped.push({ comment: c.id, why: clean(sk.why) || 'Could not act on this.' });
  }
  for (const c of input.comments) {
    if (answered.has(c.id)) continue;
    skipped.push({ comment: c.id, why: c.quote ? 'No change came back for this.' : 'Nothing in the draft matched this.' });
  }

  accepted.sort((a, b) => a.span.start - b.span.start);
  if (!accepted.length) return { ok: false, reason: `no change survived (${skipped.length} skipped)`, notes };
  const note = raw.note?.trim();
  return { ok: true, changes: accepted, skipped, ...(note ? { note } : {}), notes };
}

/** The draft with the changes spliced in. Changes must be sorted and non-overlapping, as validateRevise returns them. */
export function splice(text: string, changes: Pick<ReviseChange, 'span' | 'replacement'>[]): { span: { start: number; end: number }; replacement: string } | null {
  if (!changes.length) return null;
  const start = changes[0]!.span.start;
  const end = changes[changes.length - 1]!.span.end;
  let out = '';
  let at = start;
  for (const c of changes) {
    out += text.slice(at, c.span.start) + c.replacement;
    at = c.span.end;
  }
  return { span: { start, end }, replacement: out };
}
