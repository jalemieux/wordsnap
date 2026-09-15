// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { ChallengesPanel } from '../../../src/ui/components/ChallengesPanel';
import { StatusPill, statusOf } from '../../../src/ui/components/StatusPill';
import { click, sampleState } from './ui-helpers';

describe('ChallengesPanel', () => {
  it('orders the strongest rebuttal first and expands on click', async () => {
    const s = sampleState();
    const onHot = vi.fn();
    const c = document.createElement('div');
    render(<ChallengesPanel state={s} onHot={onHot} />, c);
    const rows = [...c.querySelectorAll('.ws-ch')];
    expect(rows.length).toBe(4);
    expect(rows[0]!.getAttribute('data-kind')).toBe('strongest_rebuttal');
    expect(rows[0]!.querySelector('.ws-ch-tag')?.textContent).toBe('Strongest rebuttal');
    expect(rows[0]!.querySelector('.ws-ch-body')).toBeNull();
    click(rows[0]!.querySelector('.ws-ch-row'));
    await new Promise((r) => setTimeout(r, 0));
    const body = c.querySelector('.ws-ch[data-kind="strongest_rebuttal"] .ws-ch-body');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain('How to address it.');
    expect(body!.querySelector('.ws-src a')?.getAttribute('href')).toContain('autonomy.work');
    expect(c.querySelector('.ws-core')?.textContent).toContain('four-day week trials');
    expect(c.querySelector('.ws-summary')?.textContent).toContain('4 challenges');
  });

  it('reports hot spans on hover and dims addressed challenges', () => {
    const s = sampleState();
    s.challenges.find((x) => x.id === 'ch2')!.status = 'applied';
    const onHot = vi.fn();
    const c = document.createElement('div');
    render(<ChallengesPanel state={s} onHot={onHot} />, c);
    const ch2 = c.querySelector('.ws-ch[data-id="ch2"]')!;
    expect(ch2.classList.contains('dim')).toBe(true);
    expect(ch2.querySelector('.ws-ch-tag')?.textContent).toBe('Addressed by your edit');
    ch2.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(onHot).toHaveBeenCalledWith(['ch2']);
    expect(c.querySelector('.ws-summary')?.textContent).toContain('3 challenges');
  });
});

describe('StatusPill', () => {
  it('shows re-analyzing while a pass runs, with a detail when present', () => {
    const s = sampleState();
    s.passes.B = { state: 'running', detail: 'Searching: UK four-day week pilot' };
    const c = document.createElement('div');
    render(<StatusPill state={s} />, c);
    expect(c.textContent).toContain('Re-analyzing…');
    expect(c.textContent).toContain('UK four-day week pilot');
    expect(c.querySelector('.ws-status')?.classList.contains('running')).toBe(true);
  });
  it('offers Re-analyze only when the draft changed or a pass failed, and says so in the pill', () => {
    const fresh = sampleState();
    fresh.analyzedVersion = fresh.snapshotVersion;
    const c = document.createElement('div');
    const onAnalyze = vi.fn();
    render(<ChallengesPanel state={fresh} onHot={() => {}} onAnalyze={onAnalyze} />, c);
    const btn = c.querySelector<HTMLButtonElement>('.ws-reanalyze')!;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(statusOf(fresh).mode).toBe('done');

    const changed = sampleState();
    changed.analyzedVersion = changed.snapshotVersion - 1;
    render(<ChallengesPanel state={changed} onHot={() => {}} onAnalyze={onAnalyze} />, c);
    const btn2 = c.querySelector<HTMLButtonElement>('.ws-reanalyze')!;
    expect(btn2.disabled).toBe(false);
    expect(statusOf(changed)).toEqual({ mode: 'stale', text: 'Draft changed' });
    click(btn2);
    expect(onAnalyze).toHaveBeenCalledTimes(1);

    const never = sampleState();
    delete never.analyzedVersion;
    render(<ChallengesPanel state={never} onHot={() => {}} onAnalyze={onAnalyze} />, c);
    expect(c.querySelector('.ws-reanalyze')).toBeNull();
  });
  it('shows checked time when done, error when failed, waiting when idle', () => {
    const now = Date.now();
    const done = sampleState();
    expect(statusOf(done, now + 30_000).text).toBe('Checked 30s ago');
    const err = sampleState();
    err.passes.C = { state: 'error', error: 'Rate limited, retrying' };
    expect(statusOf(err).mode).toBe('error');
    expect(statusOf(err).text).toBe('Rate limited, retrying');
    const idle = sampleState({ passes: { S: { state: 'idle' }, A: { state: 'idle' }, B: { state: 'idle' }, C: { state: 'idle' } } });
    expect(statusOf(idle).text).toBe('Waiting for text');
  });
});

describe('check picker chips', () => {
  it('renders four chips from the state and reports a flipped set', () => {
    const s = sampleState();
    s.checks = { structure: true, polish: true, facts: true, challenge: false };
    const onChecks = vi.fn();
    const c = document.createElement('div');
    render(<ChallengesPanel state={s} onHot={() => {}} onChecks={onChecks} />, c);
    const chips = [...c.querySelectorAll('.ws-pick')];
    expect(chips.map((b) => b.textContent?.trim())).toEqual(['Structure', 'Polish', 'Facts', 'Challenge']);
    expect(chips.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true', 'false']);
    click(c.querySelector('.ws-pick[data-check="challenge"]'));
    expect(onChecks).toHaveBeenCalledWith({ structure: true, polish: true, facts: true, challenge: true });
    click(c.querySelector('.ws-pick[data-check="facts"]'));
    expect(onChecks).toHaveBeenLastCalledWith({ structure: true, polish: true, facts: false, challenge: false });
  });

  it('with Challenge off, the section says so and the summary drops the challenge count', () => {
    const s = sampleState();
    s.checks = { structure: true, polish: true, facts: true, challenge: false };
    s.challenges = [];
    const onChecks = vi.fn();
    const c = document.createElement('div');
    render(<ChallengesPanel state={s} onHot={() => {}} onChecks={onChecks} />, c);
    expect(c.querySelector('.ws-off')?.textContent).toContain('Turn on Challenge');
    expect(c.querySelector('.ws-summary')?.textContent).not.toContain('challenges');
    expect(c.querySelector('.ws-summary')?.textContent).toContain('claims checked');
    click(c.querySelector('.ws-off .link'));
    expect(onChecks).toHaveBeenCalledWith(expect.objectContaining({ challenge: true }));
  });

  it('a flipped chip enables Re-analyze and the pill says why', () => {
    const s = sampleState();
    s.analyzedVersion = s.snapshotVersion;
    s.analyzedChecks = { structure: true, polish: true, facts: true, challenge: false };
    s.checks = { structure: true, polish: true, facts: true, challenge: true };
    expect(statusOf(s).text).toBe('Checks changed');
    const c = document.createElement('div');
    render(<ChallengesPanel state={s} onHot={() => {}} onAnalyze={() => {}} />, c);
    expect((c.querySelector('.ws-reanalyze') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('structure section', () => {
  it('shows an open proposal with its note, paragraphs and Apply / Keep, and the pill says so', () => {
    const s = sampleState();
    s.analyzedVersion = s.snapshotVersion;
    s.structure = { verdict: 'reorder', status: 'open', note: 'The ask was last.', paragraphs: ['Can we talk Thursday?', 'Here is why.'], forVersion: s.snapshotVersion };
    expect(statusOf(s)).toEqual({ mode: 'stale', text: 'Structure proposed' });
    const onApply = vi.fn();
    const onKeep = vi.fn();
    const c = document.createElement('div');
    render(<ChallengesPanel state={s} onHot={() => {}} onAnalyze={() => {}} onApplyStructure={onApply} onKeepStructure={onKeep} />, c);
    const sec = c.querySelector('.ws-structure')!;
    expect(sec.getAttribute('data-status')).toBe('open');
    expect(sec.querySelector('.ws-struct-note')?.textContent).toBe('The ask was last.');
    expect([...sec.querySelectorAll('.ws-proposal p')].map((p) => p.textContent)).toEqual(['Can we talk Thursday?', 'Here is why.']);
    expect((c.querySelector('.ws-reanalyze') as HTMLButtonElement).disabled).toBe(true);
    click(sec.querySelector('[data-act="apply-structure"]'));
    expect(onApply).toHaveBeenCalledWith(['Can we talk Thursday?', 'Here is why.']);
    click(sec.querySelector('[data-act="keep-structure"]'));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('a keeps verdict, an applied proposal and a stale one each get one line and no buttons', () => {
    const base = sampleState();
    const c = document.createElement('div');
    const s1 = { ...base, structure: { verdict: 'keeps' as const, status: 'kept' as const, note: 'The ask opens.', paragraphs: [], forVersion: 1 } };
    render(<ChallengesPanel state={s1} onHot={() => {}} onApplyStructure={() => {}} />, c);
    expect(c.querySelector('.ws-structure')?.textContent).toContain('Your order holds. The ask opens.');
    expect(c.querySelector('[data-act="apply-structure"]')).toBeNull();
    const s2 = { ...base, structure: { verdict: 'reorder' as const, status: 'applied' as const, note: 'Moved the ask.', paragraphs: ['x'], forVersion: 1 } };
    render(<ChallengesPanel state={s2} onHot={() => {}} onApplyStructure={() => {}} />, c);
    expect(c.querySelector('.ws-structure')?.textContent).toContain('Structure applied.');
    const s3 = { ...base, structure: { verdict: 'reorder' as const, status: 'stale' as const, note: 'Moved the ask.', paragraphs: ['x'], forVersion: 1 } };
    render(<ChallengesPanel state={s3} onHot={() => {}} onApplyStructure={() => {}} />, c);
    expect(c.querySelector('.ws-structure')?.textContent).toMatch(/draft changed/i);
    expect(c.querySelector('[data-act="apply-structure"]')).toBeNull();
    // Structure off: no section at all.
    const s4 = { ...s1, checks: { structure: false, polish: true, facts: true, challenge: true } };
    render(<ChallengesPanel state={s4} onHot={() => {}} />, c);
    expect(c.querySelector('.ws-structure')).toBeNull();
  });
});

describe('Re-analyze with stale findings', () => {
  it('is enabled when a finding went stale even though the draft version was analyzed', () => {
    const s = sampleState();
    s.analyzedVersion = s.snapshotVersion;
    s.challenges[0]!.status = 'stale';
    const c = document.createElement('div');
    render(<ChallengesPanel state={s} onHot={() => {}} onAnalyze={() => {}} />, c);
    expect((c.querySelector('.ws-reanalyze') as HTMLButtonElement).disabled).toBe(false);
  });
});
