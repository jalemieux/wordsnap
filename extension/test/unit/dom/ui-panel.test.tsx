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
  it('shows checked time when done, error when failed, waiting when idle', () => {
    const now = Date.now();
    const done = sampleState();
    expect(statusOf(done, now + 30_000).text).toBe('Checked 30s ago');
    const err = sampleState();
    err.passes.C = { state: 'error', error: 'Rate limited, retrying' };
    expect(statusOf(err).mode).toBe('error');
    expect(statusOf(err).text).toBe('Rate limited, retrying');
    const idle = sampleState({ passes: { A: { state: 'idle' }, B: { state: 'idle' }, C: { state: 'idle' } } });
    expect(statusOf(idle).text).toBe('Waiting for text');
  });
});
