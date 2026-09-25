// Turn a draft, the dials and an instruction into provider requests. Pure; no I/O.
import type { PassRequest } from '../providers/types';
import type { Tune } from '../shared/cowriter';
import { PassFill, PassShape, PassTweak } from '../shared/schemas';
import type { TextSnapshot } from '../shared/types';
import { FILL_SYSTEM, SHAPE_SYSTEM, TWEAK_SYSTEM } from './cowriter-prompts';

export function tuneLine(t: Tune): string {
  return `Tune: length=${t.length}; tone=${t.tone}; for=${t.for}`;
}

export function buildShape(snapshot: TextSnapshot, tune: Tune): PassRequest<PassShape> {
  return { pass: 'shape', system: SHAPE_SYSTEM, user: `${tuneLine(tune)}\n\n<dump>\n${snapshot.text}\n</dump>`, schema: PassShape, effort: 'medium' };
}

export function buildFill(input: { dump: string; shaped: string; gap: { what: string; after: number }; tune: Tune }): PassRequest<PassFill> {
  const user = `${tuneLine(input.tune)}\nGap: ${input.gap.what}\nAfter paragraph: ${input.gap.after + 1}\n\n<dump>\n${input.dump}\n</dump>\n\n<shaped>\n${input.shaped}\n</shaped>`;
  return { pass: 'fill', system: FILL_SYSTEM, user, schema: PassFill, effort: 'low' };
}

export function buildTweak(input: { draft: string; passage: string; instruction: string; tune: Tune; current?: string; again?: boolean }): PassRequest<PassTweak> {
  const instruction = input.again ? `Another version of this, clearly different from <current>: ${input.instruction}` : input.instruction;
  let user = `${tuneLine(input.tune)}\nInstruction: ${instruction}\n\n<draft>\n${input.draft}\n</draft>\n\n<passage>\n${input.passage}\n</passage>`;
  if (input.current !== undefined) user += `\n\n<current>\n${input.current}\n</current>`;
  return { pass: 'tweak', system: TWEAK_SYSTEM, user, schema: PassTweak, effort: 'low' };
}
