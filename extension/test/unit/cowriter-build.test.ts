import { buildFill, buildRequote, buildRevise, buildShape, buildTweak, tuneLine } from '../../src/passes/cowriter-build';
import { REQUOTE_SYSTEM, REVISE_SYSTEM, SHAPE_SYSTEM, TWEAK_DRAFT_SYSTEM, TWEAK_SYSTEM } from '../../src/passes/cowriter-prompts';
import { snapshotFromText } from '../../src/shared/anchoring';

const tune = { length: 'tight', tone: 'formal', for: 'email' } as const;

describe('co-writer requests', () => {
  it('puts the dials first and the dump inside tags', () => {
    const r = buildShape(snapshotFromText('first thought.\n\nsecond thought.'), tune);
    expect(r.pass).toBe('shape');
    expect(r.effort).toBe('medium');
    expect(r.research).toBeUndefined();
    expect(r.system).toBe(SHAPE_SYSTEM);
    expect(r.user).toBe(`${tuneLine(tune)}\n\n<dump>\nfirst thought.\n\nsecond thought.\n</dump>`);
    expect(tuneLine(tune)).toBe('Tune: length=tight; tone=formal; for=email');
  });

  it('asks for a fill after a named paragraph, with the dump and the shaped draft', () => {
    const r = buildFill({ dump: 'd', shaped: 's', gap: { what: 'Who books it', after: 1 }, tune });
    expect(r.pass).toBe('fill');
    expect(r.user).toContain('Gap: Who books it\nAfter paragraph: 2');
    expect(r.user).toContain('<dump>\nd\n</dump>');
    expect(r.user).toContain('<shaped>\ns\n</shaped>');
  });

  it('sends the passage, and the current version on a refine or again', () => {
    const first = buildTweak({ draft: 'D', passage: 'P', instruction: 'Shorter', tune });
    expect(first.system).toBe(TWEAK_SYSTEM);
    expect(first.system).toContain('The instruction decides what the passage says');
    expect(first.effort).toBe('low');
    expect(first.user).toContain('Instruction: Shorter');
    expect(first.user).not.toContain('<current>');
    const again = buildTweak({ draft: 'D', passage: 'P', instruction: 'Shorter', tune, current: 'C', again: true });
    expect(again.user).toContain('Instruction: Another version of this, clearly different from <current>: Shorter');
    expect(again.user).toContain('<current>\nC\n</current>');
  });

  it('sends a draft-wide tweak with the draft alone, under the draft-wide prompt', () => {
    const r = buildTweak({ draft: 'D', passage: 'D', instruction: 'say bot instead of persona', tune, scope: 'draft' });
    expect(r.system).toBe(TWEAK_DRAFT_SYSTEM);
    expect(r.system).toContain('everywhere it applies');
    expect(r.user).toContain('Instruction: say bot instead of persona');
    expect(r.user).toContain('<draft>\nD\n</draft>');
    expect(r.user).not.toContain('<passage>');
    const refine = buildTweak({ draft: 'D', passage: 'D', instruction: 'and lowercase it', tune, scope: 'draft', current: 'C' });
    expect(refine.user).toContain('<current>\nC\n</current>');
  });

  it('numbers the comments and says which passage, or the whole draft, each is on', () => {
    const r = buildRevise({ draft: 'D', comments: [{ text: 'say X', quote: 'a passage' }, { text: 'rename it' }], tune });
    expect(r.pass).toBe('revise');
    expect(r.effort).toBe('medium');
    expect(r.system).toBe(REVISE_SYSTEM);
    expect(r.user).toBe(`${tuneLine(tune)}\n\n<draft>\nD\n</draft>\n\n<comments>\n1. On "a passage": say X\n2. On the whole draft: rename it\n</comments>`);
  });

  it('asks the model to re-quote sentences whose sources did not locate', () => {
    const r = buildRequote({ dump: 'd', sentences: [{ text: 'One.', from: ['x'] }, { text: 'Two.', from: [] }] });
    expect(r.pass).toBe('shape');
    expect(r.effort).toBe('low');
    expect(r.system).toBe(REQUOTE_SYSTEM);
    expect(r.user).toBe('<dump>\nd\n</dump>\n\n<sentences>\n1. One.\n2. Two.\n</sentences>');
  });

  it('keeps tweaks to reasons the draft actually gives', () => {
    expect(TWEAK_SYSTEM).toContain('Take from the rest of the draft only what the instruction needs');
  });
});
