// Timing traces for dev builds and the playground: one run per orchestrator run, one span per pass request, marks
// stamped by the orchestrator as the provider reports them. Pure; the clock is passed in.
import type { CowriterPassId } from './cowriter';
import type { PassId } from './types';

export type TraceMarkName = 'sent' | 'firstReasoning' | 'firstContent' | 'end' | 'repair';
/** reanalyze covers Start, Re-analyze and a structure Keep or Done: every explicit run. */
export type TraceTrigger = 'reanalyze' | 'recheck' | 'auto' | 'other' | 'shape' | 'fill' | 'tweak';
export type TraceOutcome = 'ok' | 'aborted' | 'error' | 'refused';

export interface PassTrace {
  pass: PassId | CowriterPassId;
  /** What the span is for when a pass fans out (one B request per claim). */
  label?: string;
  start: number;
  end?: number;
  outcome?: TraceOutcome;
  marks: { name: TraceMarkName; at: number }[];
  inputTokens?: number;
  outputTokens?: number;
  searches?: number;
}

export interface RunTrace {
  id: number;
  trigger: TraceTrigger;
  start: number;
  end?: number;
  passes: PassTrace[];
}

export type PhaseName = 'prep' | 'wait' | 'reasoning' | 'writing' | 'repair' | 'client';

const KEEP_RUNS = 10;

/**
 * Where a pass spent its time. prep: before the request left. wait: request to first token (queue, prefill, search).
 * reasoning: first reasoning token to first content token. writing: content streaming. repair: the repair round, whole.
 * client: after the last byte (parse, validate). Empty phases are left out.
 */
export function phasesOf(p: PassTrace): { name: PhaseName; ms: number }[] {
  const end = p.end ?? p.marks.at(-1)?.at ?? p.start;
  const repairAt = p.marks.findIndex((m) => m.name === 'repair');
  const first = repairAt === -1 ? p.marks : p.marks.slice(0, repairAt);
  const at = (name: TraceMarkName) => first.find((m) => m.name === name)?.at;
  const sent = at('sent');
  const reasoning = at('firstReasoning');
  const content = at('firstContent');
  const end1 = at('end');
  const lastEnd = [...p.marks].reverse().find((m) => m.name === 'end')?.at;
  const out: { name: PhaseName; ms: number }[] = [];
  const add = (name: PhaseName, from: number | undefined, to: number | undefined) => {
    if (from !== undefined && to !== undefined && to - from > 0) out.push({ name, ms: to - from });
  };
  add('prep', p.start, sent);
  add('wait', sent, reasoning ?? content ?? end1 ?? (repairAt === -1 ? end : p.marks[repairAt]!.at));
  add('reasoning', reasoning, content ?? end1);
  add('writing', content, end1);
  if (repairAt !== -1) {
    const repairStart = p.marks[repairAt]!.at;
    const repairEnd = lastEnd !== undefined && lastEnd >= repairStart ? lastEnd : end;
    add('repair', repairStart, repairEnd);
  }
  add('client', lastEnd, end);
  return out;
}

export class TraceLog {
  runs: RunTrace[] = [];
  private seq = 0;
  private open: RunTrace | null = null;
  /** Runs opened for a stray pass (a retry, a sample run); they close with that pass. */
  private stray = new Set<RunTrace>();

  beginRun(trigger: TraceTrigger, now: number): RunTrace {
    const run: RunTrace = { id: ++this.seq, trigger, start: now, passes: [] };
    this.runs.push(run);
    if (this.runs.length > KEEP_RUNS) this.runs.splice(0, this.runs.length - KEEP_RUNS);
    this.open = run;
    return run;
  }

  endRun(run: RunTrace, now: number): void {
    run.end = now;
    if (this.open === run) this.open = null;
  }

  beginPass(pass: PassId | CowriterPassId, now: number, label?: string): PassTrace {
    let run = this.open;
    if (!run) {
      run = this.beginRun('other', now);
      this.open = null;
      this.stray.add(run);
    }
    const p: PassTrace = { pass, start: now, marks: [] };
    if (label) p.label = label;
    run.passes.push(p);
    return p;
  }

  mark(p: PassTrace, name: TraceMarkName, now: number): void {
    p.marks.push({ name, at: now });
  }

  endPass(p: PassTrace, outcome: TraceOutcome, now: number, usage?: { inputTokens: number; outputTokens: number; searches: number }): void {
    p.end = now;
    p.outcome = outcome;
    if (usage) {
      p.inputTokens = usage.inputTokens;
      p.outputTokens = usage.outputTokens;
      p.searches = usage.searches;
    }
    for (const run of this.stray) {
      if (run.passes.includes(p)) {
        run.end = now;
        this.stray.delete(run);
      }
    }
  }

  snapshot(): RunTrace[] {
    return structuredClone(this.runs);
  }
}

const secs = (ms: number) => (ms / 1000).toFixed(1);

/** One console line per run: `timing run 3 (reanalyze) 14.2s | S 5.1s: wait 2.0 · reasoning 2.5 · writing 0.6, 610 out | …` */
export function formatRun(run: RunTrace): string {
  const total = run.end !== undefined ? `${secs(run.end - run.start)}s` : 'running';
  const passes = run.passes.map((p) => {
    const name = p.label ? `${p.pass} ${p.label}` : p.pass;
    const dur = p.end !== undefined ? `${secs(p.end - p.start)}s` : 'running';
    const phases = phasesOf(p)
      .filter((x) => x.ms >= 50)
      .map((x) => `${x.name} ${secs(x.ms)}`)
      .join(' · ');
    const extra = [p.outcome && p.outcome !== 'ok' ? p.outcome : '', p.outputTokens ? `${p.outputTokens} out` : '', p.searches ? `${p.searches} results` : ''].filter(Boolean).join(', ');
    return `${name} ${dur}${phases ? `: ${phases}` : ''}${extra ? `, ${extra}` : ''}`;
  });
  return [`timing run ${run.id} (${run.trigger}) ${total}`, ...passes].join(' | ');
}
