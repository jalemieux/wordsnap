import { CowriterSession, SAVED_VERSION } from '../../src/background/cowriter';
import type { LLMProvider, PassRequest } from '../../src/providers/types';
import { ProviderError } from '../../src/providers/types';
import { snapshotFromText } from '../../src/shared/anchoring';
import type { CowriterState, Tune } from '../../src/shared/cowriter';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

const DUMP = 'we should move the offsite to march. maybe april is better actually. no, march, because the budget closes in q1. also bring laptops.';
const SHAPE = {
  note: 'Decision first.',
  paragraphs: [{ role: 'Decision', sentences: [{ text: 'We move the offsite to March.', from: ['we should move the offsite to march'] }, { text: 'The budget closes in Q1.', from: ['the budget closes in q1'] }] }, { role: 'Ask', sentences: [{ text: 'Bring laptops.', from: ['also bring laptops'] }] }],
  choices: [{ topic: 'the month', kept: 'no, march', other: 'maybe april is better actually', paragraph: 0, sentence: 0, alt: { text: 'April may be better.', from: ['maybe april is better actually'] } }],
  dropped: [],
  missing: [{ what: 'Who books the venue', after: 1 }],
};

class Fake implements LLMProvider {
  readonly id = 'mock' as const;
  readonly capabilities = { streaming: true, structuredOutput: true, webSearch: false, researchMode: 'none' as const };
  calls: PassRequest<unknown>[] = [];
  answers: Record<string, unknown[]> = { shape: [], fill: [], tweak: [] };
  async runPass<T>(req: PassRequest<T>, _s: AbortSignal, onEvent: (e: { type: 'mark'; mark: 'sent' | 'end' }) => void) {
    this.calls.push(req as PassRequest<unknown>);
    onEvent({ type: 'mark', mark: 'sent' });
    const a = this.answers[req.pass]!.shift();
    if (a instanceof Error) throw a;
    onEvent({ type: 'mark', mark: 'end' });
    return { data: req.schema.parse(a), sourcesSeen: [], usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, searches: 0 } };
  }
  async listModels() { return []; }
  async probe() {}
}

function setup(tune: Tune = { length: 'balanced', tone: 'neutral', for: 'post' }) {
  const fake = new Fake();
  const states: CowriterState[] = [];
  const tunes: Tune[] = [];
  const s = new CowriterSession('k', 'gmail', { provider: () => fake, settings: () => DEFAULT_SETTINGS, emit: (st) => states.push(st), tune, onTune: (t) => tunes.push(t), now: () => 1000 });
  s.handleSnapshot(snapshotFromText(DUMP, 1));
  return { s, fake, states, tunes, last: () => states[states.length - 1]! };
}

describe('CowriterSession', () => {
  it('runs nothing until asked', () => {
    const { fake } = setup();
    expect(fake.calls).toHaveLength(0);
  });

  it('shapes with the current dials and opens the validated result', async () => {
    const { s, fake, last } = setup();
    fake.answers.shape!.push(SHAPE);
    await s.shape();
    expect(fake.calls[0]!.user).toContain('Tune: length=balanced; tone=neutral; for=post');
    expect(last().shape).toMatchObject({ status: 'open', forVersion: 1, stale: false, flips: [], fills: {} });
    expect(last().shape!.view!.paragraphs).toHaveLength(2);
  });

  it('shows an error, not a partial draft, when the result cannot stay with the text', async () => {
    const { s, fake, last } = setup();
    fake.answers.shape!.push({ ...SHAPE, paragraphs: [{ sentences: [{ text: 'Invented.', from: ['nowhere'] }, { text: 'Also invented.', from: ['nope'] }] }] });
    await s.shape();
    expect(last().shape).toMatchObject({ status: 'error', error: 'Shape could not stay with your text; try again.' });
    expect(last().shape!.view).toBeUndefined();
  });

  it('flips a choice and fills a gap without reshaping', async () => {
    const { s, fake, last } = setup();
    fake.answers.shape!.push(SHAPE);
    fake.answers.fill!.push({ sentences: [{ text: 'Someone has to book it.', from: [] }] });
    await s.shape();
    s.flip(0);
    expect(last().shape!.flips).toEqual([0]);
    await s.fill(0);
    expect(last().shape!.fills).toEqual({ 0: ['Someone has to book it.'] });
    expect(fake.calls.map((c) => c.pass)).toEqual(['shape', 'fill']);
    s.flip(0);
    expect(last().shape!.flips).toEqual([]);
  });

  it('marks an open shape stale when the draft changes, and records apply or keep', async () => {
    const { s, fake, last } = setup();
    fake.answers.shape!.push(SHAPE);
    await s.shape();
    s.handleSnapshot(snapshotFromText(DUMP + ' one more thing.', 2));
    expect(last().shape!.stale).toBe(true);
    s.shapeAction('kept');
    expect(last().shape!.status).toBe('kept');
  });

  it('remembers new dials for the site and leaves the shaped result alone', async () => {
    const { s, fake, last, tunes } = setup();
    fake.answers.shape!.push(SHAPE);
    await s.shape();
    s.setTune({ length: 'tight', tone: 'formal', for: 'email' });
    expect(tunes).toEqual([{ length: 'tight', tone: 'formal', for: 'email' }]);
    expect(last().tune.length).toBe('tight');
    expect(last().shape!.tune.length).toBe('balanced');
    expect(fake.calls).toHaveLength(1);
  });

  it('tweaks, refines on top, asks again, and records what was applied', async () => {
    const { s, fake, last } = setup();
    const quote = 'maybe april is better actually';
    const span = { start: DUMP.indexOf(quote), end: DUMP.indexOf(quote) + quote.length };
    fake.answers.tweak!.push({ replacement: 'April may be better.' }, { replacement: 'April might be better.' }, { replacement: 'Perhaps April.' });
    await s.tweak({ id: 't1', quote, span, instruction: 'Shorter', mode: 'new' });
    expect(last().tweak).toMatchObject({ id: 't1', status: 'open', steps: [{ instruction: 'Shorter', text: 'April may be better.' }] });
    await s.tweak({ id: 't1', quote, span, instruction: 'softer', mode: 'refine' });
    expect(fake.calls[1]!.user).toContain('<current>\nApril may be better.\n</current>');
    expect(last().tweak!.steps.map((x) => x.instruction)).toEqual(['Shorter', 'softer']);
    await s.tweak({ id: 't1', quote, span, instruction: 'softer', mode: 'again' });
    expect(last().tweak!.steps.map((x) => x.text)).toEqual(['April may be better.', 'Perhaps April.']);
    s.tweakAction('t1', 'applied');
    expect(last().tweak).toBeUndefined();
    expect(last().applied).toEqual([{ instruction: 'Shorter → softer', quote }]);
  });

  it('refuses a tweak that brings in something new, and marks one stale when its passage changed', async () => {
    const { s, fake, last } = setup();
    const quote = 'also bring laptops';
    const span = { start: DUMP.indexOf(quote), end: DUMP.indexOf(quote) + quote.length };
    fake.answers.tweak!.push({ replacement: 'Bring the 12 laptops from Hilton.' });
    await s.tweak({ id: 't2', quote, span, instruction: 'Clearer', mode: 'new' });
    expect(last().tweak).toMatchObject({ status: 'error', error: 'That change added something you did not write; try again.' });
    fake.answers.tweak!.push({ replacement: 'Bring laptops.' });
    const pending = s.tweak({ id: 't3', quote, span, instruction: 'Clearer', mode: 'new' });
    s.handleSnapshot(snapshotFromText(DUMP.replace(quote, 'bring chargers'), 3));
    await pending;
    expect(last().tweak).toMatchObject({ id: 't3', status: 'stale' });
  });

  it('turns a provider error into a plain message and runs nothing on its own after it', async () => {
    const { s, fake, last } = setup();
    fake.answers.shape!.push(new ProviderError('nope', 'rate_limit', 5000));
    await s.shape();
    expect(last().shape).toMatchObject({ status: 'error', error: 'Rate limited. Try again in 5s.' });
    expect(fake.calls).toHaveLength(1);
  });

  it('saves and restores only its own format', async () => {
    const { s, fake } = setup();
    fake.answers.shape!.push(SHAPE);
    await s.shape();
    const saved = s.dump();
    expect(saved.version).toBe(SAVED_VERSION);
    const again = setup().s;
    expect(again.restore({ state: {}, snapshot: null, analyzedSnapshot: null })).toBe(false);
    expect(again.restore(saved)).toBe(true);
    expect(again.state.shape!.status).toBe('open');
  });

  it('records a trace per action when tracing is on', async () => {
    const fake = new Fake();
    const states: CowriterState[] = [];
    const s = new CowriterSession('k', 'gmail', { provider: () => fake, settings: () => DEFAULT_SETTINGS, emit: (st) => states.push(st), tune: { length: 'balanced', tone: 'neutral', for: 'post' }, trace: true, now: () => 1000 });
    s.handleSnapshot(snapshotFromText(DUMP, 1));
    fake.answers.shape!.push(SHAPE);
    await s.shape();
    expect(states[states.length - 1]!.trace![0]).toMatchObject({ trigger: 'shape', passes: [{ pass: 'shape', outcome: 'ok' }] });
  });
});
