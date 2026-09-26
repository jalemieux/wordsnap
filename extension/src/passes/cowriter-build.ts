// Turn a draft, the dials and an instruction into provider requests. Pure; no I/O.
import type { PassRequest } from '../providers/types';
import type { Tune, TweakScope } from '../shared/cowriter';
import { PassFill, PassRequote, PassRevise, PassShape, PassTweak } from '../shared/schemas';
import type { TextSnapshot } from '../shared/types';
import { FILL_SYSTEM, REQUOTE_SYSTEM, REVISE_SYSTEM, SHAPE_SYSTEM, TWEAK_DRAFT_SYSTEM, TWEAK_SYSTEM } from './cowriter-prompts';

export function tuneLine(t: Tune): string {
  return `Tune: length=${t.length}; tone=${t.tone}; for=${t.for}`;
}

export function buildShape(snapshot: TextSnapshot, tune: Tune): PassRequest<PassShape> {
  return { pass: 'shape', system: SHAPE_SYSTEM, user: `${tuneLine(tune)}\n\n<dump>\n${snapshot.text}\n</dump>`, schema: PassShape, effort: 'medium' };
}

export function buildRequote(input: { dump: string; sentences: { text: string; from: string[] }[] }): PassRequest<PassRequote> {
  const list = input.sentences.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
  const user = `<dump>\n${input.dump}\n</dump>\n\n<sentences>\n${list}\n</sentences>`;
  return { pass: 'shape', system: REQUOTE_SYSTEM, user, schema: PassRequote, effort: 'low' };
}

export function buildFill(input: { dump: string; shaped: string; gap: { what: string; after: number }; tune: Tune }): PassRequest<PassFill> {
  const user = `${tuneLine(input.tune)}\nGap: ${input.gap.what}\nAfter paragraph: ${input.gap.after + 1}\n\n<dump>\n${input.dump}\n</dump>\n\n<shaped>\n${input.shaped}\n</shaped>`;
  return { pass: 'fill', system: FILL_SYSTEM, user, schema: PassFill, effort: 'low' };
}

/** The comment as the model sees it, numbered from 1 in the order given. A comment with no quote is on the whole draft. */
export interface ReviseComment {
  text: string;
  quote?: string;
}

export function buildRevise(input: { draft: string; comments: ReviseComment[]; tune: Tune }): PassRequest<PassRevise> {
  const lines = input.comments.map((c, i) => `${i + 1}. ${c.quote ? `On "${c.quote}": ` : 'On the whole draft: '}${c.text}`);
  const user = `${tuneLine(input.tune)}\n\n<draft>\n${input.draft}\n</draft>\n\n<comments>\n${lines.join('\n')}\n</comments>`;
  return { pass: 'revise', system: REVISE_SYSTEM, user, schema: PassRevise, effort: 'medium' };
}

/** A passage tweak sends the draft for context and the passage to change; a draft-wide one sends the draft alone, and it is the passage. */
export function buildTweak(input: { draft: string; passage: string; instruction: string; tune: Tune; current?: string; again?: boolean; scope?: TweakScope }): PassRequest<PassTweak> {
  const instruction = input.again ? `Another version of this, clearly different from <current>: ${input.instruction}` : input.instruction;
  const draftWide = input.scope === 'draft';
  let user = `${tuneLine(input.tune)}\nInstruction: ${instruction}\n\n<draft>\n${input.draft}\n</draft>`;
  if (!draftWide) user += `\n\n<passage>\n${input.passage}\n</passage>`;
  if (input.current !== undefined) user += `\n\n<current>\n${input.current}\n</current>`;
  return { pass: 'tweak', system: draftWide ? TWEAK_DRAFT_SYSTEM : TWEAK_SYSTEM, user, schema: PassTweak, effort: 'low' };
}
