import { splice, TWEAK_DRAFT_TOO_LONG, TWEAK_REJECTED, TWEAK_TOO_LONG, unseenTokens, validateFill, validateRevise, validateShape, validateTweak } from '../../src/passes/cowriter-validate';
import type { Comment } from '../../src/shared/cowriter';
import type { PassShape } from '../../src/shared/schemas';

const DUMP = 'ok so we should move the offsite to march. maybe april is better actually. no, march, because the budget closes in q1. also bring laptops. everyone at acme said yes.';

const s = (text: string, from: string[], bridge = false) => ({ text, from, bridge });
function shape(sentences: ReturnType<typeof s>[][], extra: Partial<PassShape> = {}): PassShape {
  return { note: 'Put the decision first.', paragraphs: sentences.map((ss) => ({ role: 'Part', sentences: ss })), choices: [], dropped: [], missing: [], ...extra };
}

describe('unseenTokens', () => {
  it('finds numbers, links and names the source never had', () => {
    expect(unseenTokens('The venue costs $4,000 at Hilton.', DUMP)).toEqual(['$4,000', 'Hilton']);
    expect(unseenTokens('See https://example.com/x for details.', DUMP)).toEqual(['https://example.com/x']);
  });
  it('accepts what the source has, in any case, and capitals at the start of a sentence', () => {
    expect(unseenTokens('We move it to March. The budget closes in Q1. Acme agreed. Bring laptops.', DUMP)).toEqual([]);
    expect(unseenTokens('I think so: Because it closes.', DUMP)).toEqual([]);
  });
  it('handles curly quotes in sentence endings without misflagging an unknown capital', () => {
    expect(unseenTokens('We move it to March.” Zeta arrived.', DUMP)).toEqual([]);
  });
  it('strips curly quotes when checking for new names', () => {
    expect(unseenTokens('The venue is “Hilton” now.', DUMP)).toEqual(['Hilton']);
  });
  it('accepts names wrapped in curly single quotes if they are in the source', () => {
    expect(unseenTokens('The venue is ‘Hilton’ now.', DUMP)).toEqual(['Hilton']);
  });
});

describe('validateShape', () => {
  it('keeps sentences whose sources locate, and bridges that add nothing', () => {
    const r = validateShape(shape([[s('We move the offsite to March.', ['we should move the offsite to march']), s('So timing matters.', [], true), s('The budget closes in Q1.', ['the budget closes in q1'])], [s('Bring laptops.', ['bring laptops'])]]), DUMP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.paragraphs.map((p) => p.sentences.length)).toEqual([3, 1]);
    expect(r.view.paragraphs[0]!.sentences[1]).toEqual({ text: 'So timing matters.', from: [], bridge: true });
  });

  it('drops a sentence with no source that locates, and one that brings in a new fact', () => {
    const r = validateShape(shape([[s('We move the offsite to March.', ['we should move the offsite to march']), s('Everyone loved last year.', ['everyone loved it']), s('The venue costs $4,000.', ['the budget closes in q1']), s('Bring laptops.', ['bring laptops'])]]), DUMP);
    expect(r.ok && r.view.paragraphs[0]!.sentences.map((x) => x.text)).toEqual(['We move the offsite to March.', 'Bring laptops.']);
    expect(r.notes.length).toBe(2);
  });

  it('drops long bridges and bridges beyond one in four, the last ones first', () => {
    const long = 'This is a bridge sentence that goes on and on well past the limit of twenty five words that a bridge is allowed to carry here.';
    const r = validateShape(shape([[s('A.', ['ok so']), s('Bridge one.', [], true), s('B.', ['also bring laptops']), s('Bridge two.', [], true), s(long, [], true), s('C.', ['no, march'])]]), DUMP);
    expect(r.ok && r.view.paragraphs[0]!.sentences.map((x) => x.text)).toEqual(['A.', 'Bridge one.', 'B.', 'C.']);
  });

  it('rejects a result when fewer than half its sentences survive', () => {
    const r = validateShape(shape([[s('One.', ['not in the dump']), s('Two.', ['nor this']), s('Three.', ['bring laptops'])]]), DUMP);
    expect(r).toMatchObject({ ok: false });
  });

  it('reports sentences dropped for unlocatable sources, with their raw quotes, for a requote pass to fix', () => {
    const r = validateShape(shape([[s('We move the offsite to March.', ['we should move the offsite to march']), s('I was careful not to rush it.', ['i was carefull not to enforce too much']), s('Bring laptops.', ['bring laptops'])]]), DUMP);
    expect(r.ok).toBe(true);
    expect(r.unsourced).toEqual([{ paragraph: 0, sentence: 1, text: 'I was careful not to rush it.', from: ['i was carefull not to enforce too much'] }]);
    expect(r.notes).toContain('no source in the dump: I was careful not to rush it. [from: "i was carefull not to enforce too much"]');
  });

  it('returns unsourced sentences even when the whole result is rejected', () => {
    const r = validateShape(shape([[s('One.', ['not in the dump']), s('Two.', ['nor this']), s('Three.', ['bring laptops'])]]), DUMP);
    expect(r.ok).toBe(false);
    expect(r.unsourced.map((u) => u.text)).toEqual(['One.', 'Two.']);
  });

  it('keeps a choice only when both sides locate and it points at a surviving sentence; re-indexes after drops', () => {
    const raw = shape([[s('Gone.', ['nowhere']), s('We move the offsite to March.', ['no, march']), s('Bring laptops.', ['bring laptops'])]], {
      choices: [
        { topic: 'the month', kept: 'no, march', other: 'maybe april is better actually', paragraph: 0, sentence: 1, alt: { text: 'April may be better.', from: ['maybe april is better actually'] } },
        { topic: 'bad', kept: 'not there', other: 'maybe april', paragraph: 0, sentence: 1, alt: { text: 'x', from: ['maybe april'] } },
      ],
    });
    const r = validateShape(raw, DUMP);
    expect(r.ok && r.view.choices).toEqual([{ topic: 'the month', kept: 'no, march', other: 'maybe april is better actually', paragraph: 0, sentence: 0, alt: { text: 'April may be better.', from: ['maybe april is better actually'] } }]);
  });

  it('keeps dropped quotes that locate and clamps missing to the last paragraph', () => {
    const r = validateShape(shape([[s('Bring laptops.', ['bring laptops'])]], { dropped: [{ quote: 'ok so', why: 'filler' }, { quote: 'nope', why: 'x' }], missing: [{ what: 'Who books it', after: 9 }] }), DUMP);
    expect(r.ok && r.view.dropped).toEqual([{ quote: 'ok so', why: 'filler' }]);
    expect(r.ok && r.view.missing).toEqual([{ what: 'Who books it', after: 0 }]);
  });
});

describe('validateFill', () => {
  it('keeps up to three short sentences that add nothing new', () => {
    expect(validateFill({ sentences: [{ text: 'Someone has to book it.', from: [] }, { text: 'It costs $900.', from: [] }] }, DUMP)).toEqual(['Someone has to book it.']);
  });
});

describe('validateTweak', () => {
  const input = { passage: 'maybe april is better actually', draft: DUMP, instruction: 'Shorter' };
  it('accepts a replacement that stays with the text', () => {
    expect(validateTweak({ replacement: 'April may be better.' }, input)).toEqual({ ok: true, text: 'April may be better.' });
  });
  it('rejects one that brings in a new name or number', () => {
    expect(validateTweak({ replacement: 'April, per Hilton, is better.' }, input)).toMatchObject({ ok: false });
  });
  it('rejects one longer than 2.5x unless the instruction asks for more', () => {
    const long = 'April may be better for everyone involved, since the weather is warmer and more of the team is back from leave by then.';
    expect(validateTweak({ replacement: long }, input)).toMatchObject({ ok: false });
    expect(validateTweak({ replacement: long }, { ...input, instruction: 'expand on why' })).toMatchObject({ ok: true });
  });
  it('tells a new fact apart from an answer that outgrew the passage', () => {
    expect(validateTweak({ replacement: 'April, per Hilton, is better.' }, input)).toMatchObject({ ok: false, message: TWEAK_REJECTED });
    expect(validateTweak({ replacement: DUMP }, input)).toMatchObject({ ok: false, reason: 'over 2.5x the passage', message: TWEAK_TOO_LONG });
  });
  it('checks a draft-wide change against the whole draft, with a tighter length cap', () => {
    const draft = { passage: DUMP, draft: DUMP, instruction: 'say retreat instead of offsite', scope: 'draft' as const };
    const renamed = DUMP.replace('offsite', 'retreat');
    expect(validateTweak({ replacement: renamed }, draft)).toEqual({ ok: true, text: renamed });
    expect(validateTweak({ replacement: `${DUMP} ${DUMP.slice(0, 60)}` }, draft)).toMatchObject({ ok: false, reason: 'over 1.3x the draft', message: TWEAK_DRAFT_TOO_LONG });
    expect(validateTweak({ replacement: DUMP.replace('acme', 'Globex') }, draft)).toMatchObject({ ok: false, message: TWEAK_REJECTED });
  });
});

describe('validateRevise', () => {
  const at = (q: string) => ({ start: DUMP.indexOf(q), end: DUMP.indexOf(q) + q.length });
  const comments: Comment[] = [
    { id: 'c1', text: 'say: April is out; March it is', quote: 'maybe april is better actually', span: at('maybe april is better actually') },
    { id: 'c2', text: 'say retreat instead of offsite' },
    { id: 'c3', text: 'Clearer', quote: 'also bring laptops', span: at('also bring laptops') },
  ];
  const input = { draft: DUMP, comments };

  it('ties each change and edit to its comment, locates them, sorts them and never lets them overlap', () => {
    const r = validateRevise(
      {
        changes: [
          { comment: 1, replacement: 'April is out; March it is.' },
          { comment: 3, replacement: 'also bring laptops' },
        ],
        edits: [
          { comment: 2, quote: 'ok so we should move the offsite to march.', replacement: 'ok so we should move the retreat to march.' },
          { comment: 2, quote: 'maybe april is better', replacement: 'maybe april is worse' },
        ],
        skipped: [],
      },
      input,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.map((c) => [c.comment, c.quote, c.replacement])).toEqual([
      ['c2', 'ok so we should move the offsite to march.', 'ok so we should move the retreat to march.'],
      ['c1', 'maybe april is better actually', 'April is out; March it is.'],
    ]);
    expect(r.skipped).toEqual([{ comment: 'c3', why: 'Came back unchanged.' }]);
    expect(r.notes.some((n) => n.includes('overlaps'))).toBe(true);
  });

  it('drops what brings in a new fact, what outgrows its span, what answers no comment, and reports the unanswered', () => {
    const r = validateRevise(
      {
        changes: [
          { comment: 1, replacement: 'Per Hilton, April is out.' },
          { comment: 2, replacement: 'the whole draft rewritten' },
          { comment: 9, replacement: 'x' },
        ],
        edits: [{ comment: 2, quote: 'not in the dump at all', replacement: 'y' }],
        skipped: [{ comment: 3, why: 'Nothing unclear here.' }],
      },
      input,
    );
    expect(r.ok).toBe(false);
    expect(r.notes.length).toBeGreaterThanOrEqual(4);
  });

  it('marks a comment whose passage is gone as moved', () => {
    const r = validateRevise({ changes: [{ comment: 1, replacement: 'March it is.' }, { comment: 3, replacement: 'Bring laptops.' }], edits: [], skipped: [] }, { draft: DUMP.replace('maybe april is better actually. ', ''), comments });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped).toEqual([{ comment: 'c1', why: 'The passage moved or changed.' }, { comment: 'c2', why: 'Nothing in the draft matched this.' }]);
    expect(r.changes).toHaveLength(1);
  });

  it('splices sorted changes into one edit that leaves everything between them untouched', () => {
    const changes = [
      { span: at('offsite'), replacement: 'retreat' },
      { span: at('laptops'), replacement: 'chargers' },
    ];
    const e = splice(DUMP, changes)!;
    expect(e.span).toEqual({ start: DUMP.indexOf('offsite'), end: DUMP.indexOf('laptops') + 'laptops'.length });
    expect(DUMP.slice(0, e.span.start) + e.replacement + DUMP.slice(e.span.end)).toBe(DUMP.replace('offsite', 'retreat').replace('laptops', 'chargers'));
    expect(splice(DUMP, [])).toBeNull();
  });
});
