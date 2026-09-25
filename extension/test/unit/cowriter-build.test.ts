import { buildFill, buildShape, buildTweak, tuneLine } from '../../src/passes/cowriter-build';
import { SHAPE_SYSTEM, TWEAK_SYSTEM } from '../../src/passes/cowriter-prompts';
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
    expect(first.effort).toBe('low');
    expect(first.user).toContain('Instruction: Shorter');
    expect(first.user).not.toContain('<current>');
    const again = buildTweak({ draft: 'D', passage: 'P', instruction: 'Shorter', tune, current: 'C', again: true });
    expect(again.user).toContain('Instruction: Another version of this, clearly different from <current>: Shorter');
    expect(again.user).toContain('<current>\nC\n</current>');
  });
});
