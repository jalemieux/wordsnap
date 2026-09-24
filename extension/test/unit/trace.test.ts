import { TraceLog, formatRun, phasesOf, type PassTrace } from '../../src/shared/trace';

function span(start: number, marks: [PassTrace['marks'][number]['name'], number][], end: number): PassTrace {
  return { pass: 'A', start, end, outcome: 'ok', marks: marks.map(([name, at]) => ({ name, at })) };
}

describe('phasesOf', () => {
  it('splits a pass into prep, wait, reasoning, writing and client work', () => {
    const p = span(0, [['sent', 5], ['firstReasoning', 1200], ['firstContent', 3000], ['end', 3600]], 3650);
    expect(phasesOf(p)).toEqual([
      { name: 'prep', ms: 5 },
      { name: 'wait', ms: 1195 },
      { name: 'reasoning', ms: 1800 },
      { name: 'writing', ms: 600 },
      { name: 'client', ms: 50 },
    ]);
  });

  it('has no reasoning phase when the model streams content straight away', () => {
    const p = span(0, [['sent', 0], ['firstContent', 900], ['end', 1000]], 1000);
    expect(phasesOf(p).map((x) => x.name)).toEqual(['wait', 'writing']);
  });

  it('counts a repair round from its request to its end', () => {
    const p = span(0, [['sent', 0], ['firstContent', 500], ['end', 1000], ['repair', 1010], ['sent', 1010], ['firstContent', 1400], ['end', 1900]], 1920);
    expect(phasesOf(p)).toEqual([
      { name: 'wait', ms: 500 },
      { name: 'writing', ms: 500 },
      { name: 'repair', ms: 890 },
      { name: 'client', ms: 20 },
    ]);
  });

  it('shows an aborted pass as the time it ran, all wait when nothing came back', () => {
    const p: PassTrace = { pass: 'C', start: 0, end: 700, outcome: 'aborted', marks: [{ name: 'sent', at: 0 }] };
    expect(phasesOf(p)).toEqual([{ name: 'wait', ms: 700 }]);
  });
});

describe('TraceLog', () => {
  it('records runs with their passes and keeps the last ten', () => {
    const log = new TraceLog();
    for (let i = 0; i < 12; i++) {
      const run = log.beginRun('reanalyze', i * 100);
      const p = log.beginPass('A', i * 100);
      log.mark(p, 'sent', i * 100 + 1);
      log.endPass(p, 'ok', i * 100 + 50, { inputTokens: 10, outputTokens: 20, searches: 0 });
      log.endRun(run, i * 100 + 60);
    }
    expect(log.runs).toHaveLength(10);
    expect(log.runs[0]!.id).toBe(3);
    expect(log.runs[9]!.passes[0]).toMatchObject({ pass: 'A', outcome: 'ok', outputTokens: 20, end: 1150 });
  });

  it('files a pass that starts outside a run under a run of its own', () => {
    const log = new TraceLog();
    const p = log.beginPass('B', 10, 'claim c1');
    log.endPass(p, 'error', 40);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]).toMatchObject({ trigger: 'other', start: 10, end: 40 });
    expect(log.runs[0]!.passes[0]!.label).toBe('claim c1');
  });

  it('returns a copy that later marks do not change', () => {
    const log = new TraceLog();
    log.beginRun('reanalyze', 0);
    const p = log.beginPass('S', 0);
    const snap = log.snapshot();
    log.mark(p, 'sent', 5);
    expect(snap[0]!.passes[0]!.marks).toEqual([]);
  });
});

describe('formatRun', () => {
  it('leaves out phases under 50ms', () => {
    const log = new TraceLog();
    const run = log.beginRun('auto', 0);
    const p = log.beginPass('A', 0);
    log.mark(p, 'sent', 2);
    log.mark(p, 'firstContent', 800);
    log.mark(p, 'end', 1000);
    log.endPass(p, 'ok', 1003);
    log.endRun(run, 1003);
    expect(formatRun(log.runs[0]!)).toBe('timing run 1 (auto) 1.0s | A 1.0s: wait 0.8 · writing 0.2');
  });

  it('prints one line per run with each pass and its phases', () => {
    const log = new TraceLog();
    const run = log.beginRun('reanalyze', 0);
    const p = log.beginPass('S', 0);
    log.mark(p, 'sent', 0);
    log.mark(p, 'firstReasoning', 2000);
    log.mark(p, 'firstContent', 4500);
    log.mark(p, 'end', 5100);
    log.endPass(p, 'ok', 5100, { inputTokens: 900, outputTokens: 610, searches: 0 });
    log.endRun(run, 5200);
    expect(formatRun(log.runs[0]!)).toBe('timing run 1 (reanalyze) 5.2s | S 5.1s: wait 2.0 · reasoning 2.5 · writing 0.6, 610 out');
  });
});
