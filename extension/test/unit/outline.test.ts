import { describe, expect, it } from 'vitest';
import { OUTLINE_MIN_SLOTS, validatePassS } from '../../src/passes/validate';
import { SAMPLE_IDEA_TEXT, SAMPLE_PASS_S_OUTLINE } from '../../src/shared/sample';
import { PassS } from '../../src/shared/schemas';
import { mapStructure, outlineFill, paragraphSpans } from '../../src/shared/structure-map';
import { outlineParagraphs } from '../../src/ui/components/CompareView';
import { Session } from '../../src/background/session';
import { skeletonEdit, snapshotFromText } from '../../src/shared/anchoring';

const NOTES = [
  'Email to the team about the board experiment.',
  'Point: rigid orchestration is counterproductive, agents self organize.',
  'What I saw: sessions picked up work, coordinated on collisions.',
  'Ask them to try it this week.',
].join('\n');

const OUTLINE: PassS = {
  verdict: 'outline',
  note: 'Ask first, then the point, then what you saw.',
  paragraphs: [],
  slots: [
    { role: 'Ask', job: 'What you want from them.', from: ['Ask them to try it this week.'] },
    { role: 'Point', job: 'The claim in one sentence.', from: ['Point: rigid orchestration is counterproductive, agents self organize.'] },
    { role: 'What you saw', job: 'The experiment, concretely.', from: ['What I saw: sessions picked up work, coordinated on collisions.'], gap: 'How many sessions, for how long.' },
    { role: 'Next step', job: 'What happens next.', from: [], gap: 'What you will build and when.' },
  ],
};

describe('validatePassS on an outline', () => {
  it('keeps slots whose fragments are in the notes, with roles trimmed and gaps carried', () => {
    const { proposal, reason } = validatePassS(OUTLINE, NOTES, 'elaborate');
    expect(reason).toBeUndefined();
    expect(proposal.verdict).toBe('outline');
    expect(proposal.paragraphs).toEqual([]);
    expect(proposal.slots?.map((s) => s.role)).toEqual(['Ask', 'Point', 'What you saw', 'Next step']);
    expect(proposal.slots?.[2]?.gap).toBe('How many sessions, for how long.');
    expect(proposal.slots?.[3]?.from).toEqual([]);
  });

  it('drops a fragment the notes do not contain, and a fragment quoted twice', () => {
    const r = PassS.parse({
      ...OUTLINE,
      slots: [
        { role: 'Ask', job: 'j', from: ['Ask them to try it this week.', 'Please reply by Friday.'] },
        { role: 'Again', job: 'j', from: ['Ask them to try it this week.'] },
      ],
    });
    const { proposal } = validatePassS(r, NOTES, 'elaborate');
    expect(proposal.verdict).toBe('outline');
    expect(proposal.slots?.[0]?.from).toEqual(['Ask them to try it this week.']);
    expect(proposal.slots?.[1]?.from).toEqual([]);
  });

  it('matches fragments loosely on punctuation and case, and normalizes role and job whitespace', () => {
    const r = PassS.parse({
      ...OUTLINE,
      slots: [
        { role: '  Ask: ', job: 'What  you want.', from: ['ask them to try it this week'] },
        { role: 'Point', job: 'j', from: [] },
      ],
    });
    const { proposal } = validatePassS(r, NOTES, 'elaborate');
    expect(proposal.slots?.[0]).toEqual({ role: 'Ask', job: 'What you want.', from: ['ask them to try it this week'] });
  });

  it('becomes keeps when no slot places a fragment: the model may not invent the points', () => {
    const r = PassS.parse({
      ...OUTLINE,
      slots: [
        { role: 'Ask', job: 'j', from: ['Nothing like this in the notes.'] },
        { role: 'Point', job: 'j', from: [] },
      ],
    });
    const { proposal, reason } = validatePassS(r, NOTES, 'elaborate');
    expect(proposal.verdict).toBe('keeps');
    expect(reason).toMatch(/none of the writer/);
  });

  it(`becomes keeps with fewer than ${OUTLINE_MIN_SLOTS} usable slots`, () => {
    const r = PassS.parse({
      ...OUTLINE,
      slots: [
        { role: 'Ask', job: 'j', from: ['Ask them to try it this week.'] },
        { role: '   ', job: 'j', from: [] },
      ],
    });
    const { proposal, reason } = validatePassS(r, NOTES, 'elaborate');
    expect(proposal.verdict).toBe('keeps');
    expect(reason).toMatch(/1 slot/);
  });

  it('is demoted to keeps when the Organize job was asked for: an outline is never shown uninvited', () => {
    const { proposal, reason } = validatePassS(OUTLINE, NOTES, 'organize');
    expect(proposal.verdict).toBe('keeps');
    expect(reason).toMatch(/organize/);
  });

  it('accepts the canned outline against the sample notes', () => {
    const { proposal, reason } = validatePassS(SAMPLE_PASS_S_OUTLINE, SAMPLE_IDEA_TEXT, 'elaborate');
    expect(reason).toBeUndefined();
    expect(proposal.verdict).toBe('outline');
    expect(proposal.slots).toHaveLength(5);
  });
});

describe('outlineParagraphs', () => {
  it('joins each slot into one paragraph and skips empty slots', () => {
    expect(outlineParagraphs(OUTLINE.slots!)).toEqual([
      'Ask them to try it this week.',
      'Point: rigid orchestration is counterproductive, agents self organize.',
      'What I saw: sessions picked up work, coordinated on collisions.',
    ]);
  });
});

describe('outlineFill', () => {
  const slots = OUTLINE.slots!;
  const seeded = outlineParagraphs(slots).join('\n\n');
  const fillOf = (text: string) =>
    outlineFill(
      text,
      mapStructure(
        text,
        slots.map((s) => s.from.join(' ')),
      ),
      slots.length,
    );

  it('reports every placed slot as seeded right after Apply, and the empty slot as empty', () => {
    expect(fillOf(seeded)).toEqual(['seeded', 'seeded', 'seeded', 'empty']);
  });

  it('marks a slot written once its paragraph grows past the fragment', () => {
    const text = seeded.replace('Ask them to try it this week.', 'Ask them to try it this week. Twenty minutes on one real task is enough to see it.');
    expect(fillOf(text)).toEqual(['written', 'seeded', 'seeded', 'empty']);
  });

  it('does not count a word or two of editing as written', () => {
    const text = seeded.replace('Ask them to try it this week.', 'Ask them all to try it this week.');
    expect(fillOf(text)[0]).toBe('seeded');
  });

  it('marks an empty slot written once a paragraph appears where it belongs', () => {
    const text = `${seeded}\n\nNext I will wire notifications so nobody polls the board.`;
    expect(fillOf(text)[3]).toBe('written');
  });

  it('a fragment the writer deleted leaves its slot empty', () => {
    const text = outlineParagraphs(slots).slice(1).join('\n\n');
    expect(fillOf(text)[0]).toBe('empty');
  });
});

describe('paragraphSpans', () => {
  it('splits on blank lines and keeps single line breaks inside a paragraph', () => {
    const spans = paragraphSpans('One\nstill one.\n\nTwo.\n\n\nThree.');
    expect(spans.map((s) => 'One\nstill one.\n\nTwo.\n\n\nThree.'.slice(s.start, s.end))).toEqual(['One\nstill one.', 'Two.', 'Three.']);
  });
});

describe('Session with an outline', () => {
  it('opens on the proposal, guides after Apply, survives edits while guiding, and finishes on Done', () => {
    const s = new Session('k', 'gmail');
    s.applySnapshot(snapshotFromText(NOTES, 1));
    s.setStructure({ verdict: 'outline', note: 'n', paragraphs: [], slots: OUTLINE.slots! }, 1);
    expect(s.state.structure?.status).toBe('open');
    expect(s.applyStructureAction('done')).toBe(false); // nothing to finish yet
    expect(s.applyStructureAction('applied')).toBe(true);
    expect(s.state.structure?.status).toBe('guiding');
    s.applySnapshot(snapshotFromText(`${NOTES} and more`, 2));
    expect(s.state.structure?.status).toBe('guiding');
    expect(s.applyStructureAction('done')).toBe(true);
    expect(s.state.structure?.status).toBe('applied');
    expect(s.applyStructureAction('done')).toBe(false);
  });

  it('an open outline goes stale on an edit, like a reorder; a reorder still finishes on Apply', () => {
    const s = new Session('k', 'gmail');
    s.applySnapshot(snapshotFromText(NOTES, 1));
    s.setStructure({ verdict: 'outline', note: 'n', paragraphs: [], slots: OUTLINE.slots! }, 1);
    s.applySnapshot(snapshotFromText(`${NOTES} and more`, 2));
    expect(s.state.structure?.status).toBe('stale');
    s.setStructure({ verdict: 'reorder', note: 'n', paragraphs: ['a', 'b'] }, 2);
    expect(s.applyStructureAction('applied')).toBe(true);
    expect(s.state.structure?.status).toBe('applied');
    expect(s.applyStructureAction('done')).toBe(false);
  });

  it('keeps has nothing to act on', () => {
    const s = new Session('k', 'gmail');
    s.setStructure({ verdict: 'keeps', note: 'n', paragraphs: [] }, 1);
    expect(s.state.structure?.status).toBe('kept');
    expect(s.applyStructureAction('applied')).toBe(false);
  });
});

describe('skeletonEdit', () => {
  const slots = OUTLINE.slots!;
  const fragments = slots.flatMap((s) => s.from);
  const paragraphs = outlineParagraphs(slots);

  it('replaces only the paragraphs that hold the placed fragments: a greeting above and a signature below stay', () => {
    const text = `Hi all,\n\n${NOTES}\n\n— Jac`;
    const snap = snapshotFromText(text);
    const edit = skeletonEdit(snap, paragraphs, fragments)!;
    expect(text.slice(edit.span.start, edit.span.end)).toBe(NOTES);
    const after = text.slice(0, edit.span.start) + edit.replacement + text.slice(edit.span.end);
    expect(after.startsWith('Hi all,\n\n')).toBe(true);
    expect(after.endsWith('\n\n— Jac')).toBe(true);
    expect(after).not.toContain('Email to the team about');
  });

  it('spans from the first placed fragment to the last, even when they sit in different paragraphs', () => {
    const text = `Hi all,\n\nAsk them to try it this week.\n\nSomething in between.\n\nWhat I saw: sessions picked up work, coordinated on collisions.\n\n— Jac`;
    const snap = snapshotFromText(text);
    const edit = skeletonEdit(snap, paragraphs, fragments)!;
    expect(text.slice(edit.span.start, edit.span.end)).toBe('Ask them to try it this week.\n\nSomething in between.\n\nWhat I saw: sessions picked up work, coordinated on collisions.');
  });

  it('locates fragments loosely, as the validator did, so a quote with different punctuation still anchors', () => {
    const snap = snapshotFromText(NOTES);
    const edit = skeletonEdit(snap, paragraphs, ['ask them to try it this week'])!;
    expect(edit.span).toEqual({ start: 0, end: NOTES.length });
  });

  it('falls back to the whole draft when nothing locates', () => {
    const snap = snapshotFromText(NOTES);
    const edit = skeletonEdit(snap, paragraphs, ['nothing of the kind'])!;
    expect(edit.span).toEqual({ start: 0, end: NOTES.length });
  });

  it('is null when the text is already the skeleton', () => {
    const snap = snapshotFromText(paragraphs.join('\n\n'));
    expect(skeletonEdit(snap, paragraphs, fragments)).toBeNull();
  });
});
