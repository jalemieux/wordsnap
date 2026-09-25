// The co-writer line in code: your ideas, its words. What Shape, Fill and Tweak return is checked against the
// writer's own text before anything reaches the UI. Pure.
import { locateQuote } from '../shared/anchoring';
import type { ShapeChoice, ShapeParagraph, ShapeView } from '../shared/cowriter';
import type { PassFill, PassShape, PassTweak } from '../shared/schemas';

export const BRIDGE_MAX_WORDS = 25;
export const BRIDGE_MAX_SHARE = 0.25;
export const SHAPE_MIN_SURVIVING = 0.5;
export const TWEAK_MAX_RATIO = 2.5;
export const FILL_MAX = 3;
export const SHAPE_REJECTED = 'Shape could not stay with your text; try again.';
export const TWEAK_REJECTED = 'That change added something you did not write; try again.';

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
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const w = raw.replace(/^[(“‘[]+/, '').replace(/[\)”’\].,;:!?]+$/, '');
    const isUrl = /^(https?:\/\/|www\.)/i.test(w);
    const hasDigit = /\d/.test(w);
    const isName = !sentenceStart && /^[A-Z][A-Za-z‘’''-]+$/.test(w) && !/^I([‘’].*)?$/.test(w);
    if (w && (isUrl || hasDigit || isName) && !src.includes(w.toLowerCase())) out.push(w);
    sentenceStart = /[.!?:][)”’\]]*$/.test(raw);
  }
  return out;
}

type Kept = { text: string; from: string[]; bridge: boolean; key: string };

export function validateShape(raw: PassShape, dump: string): { ok: true; view: ShapeView; notes: string[] } | { ok: false; reason: string; notes: string[] } {
  const notes: string[] = [];
  const locates = (q: string) => !!q.trim() && locateQuote(dump, q) !== null;
  let total = 0;
  const paras: { role?: string; sentences: Kept[] }[] = [];

  raw.paragraphs.forEach((p, pi) => {
    const kept: Kept[] = [];
    p.sentences.forEach((s, si) => {
      total += 1;
      const text = clean(s.text);
      const from = s.from.map(clean).filter(locates);
      const bridge = !!s.bridge;
      const unseen = unseenTokens(text, dump);
      if (!text) return;
      if (unseen.length) return void notes.push(`new fact (${unseen.join(', ')}): ${text}`);
      if (bridge && words(text) > BRIDGE_MAX_WORDS) return void notes.push(`bridge over ${BRIDGE_MAX_WORDS} words: ${text}`);
      if (!bridge && !from.length) return void notes.push(`no source in the dump: ${text}`);
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
  if (surviving < total * SHAPE_MIN_SURVIVING || surviving === 0) return { ok: false, reason: `${surviving} of ${total} sentences survived`, notes };

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
  return { ok: true, view: { note: clean(raw.note), paragraphs, choices, dropped, missing }, notes };
}

export function validateFill(raw: PassFill, dump: string): string[] {
  return raw.sentences
    .map((s) => clean(s.text))
    .filter((t) => t && words(t) <= BRIDGE_MAX_WORDS && !unseenTokens(t, dump).length)
    .slice(0, FILL_MAX);
}

const ASKS_FOR_MORE = /\b(longer|expand|add|elaborate|more detail|more context|flesh)\b/i;

export function validateTweak(raw: PassTweak, input: { passage: string; draft: string; instruction: string }): { ok: true; text: string; note?: string } | { ok: false; reason: string } {
  const text = raw.replacement.trim();
  if (!text) return { ok: false, reason: 'empty replacement' };
  const unseen = unseenTokens(text, `${input.draft}\n${input.passage}\n${input.instruction}`);
  if (unseen.length) return { ok: false, reason: `new fact (${unseen.join(', ')})` };
  if (!ASKS_FOR_MORE.test(input.instruction) && text.length > input.passage.length * TWEAK_MAX_RATIO) return { ok: false, reason: `over ${TWEAK_MAX_RATIO}x the passage` };
  const note = raw.note?.trim();
  return note ? { ok: true, text, note } : { ok: true, text };
}
