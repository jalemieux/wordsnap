// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { HoverCard, cardPosition } from '../../../src/ui/components/HoverCard';
import { click, sampleState } from './ui-helpers';

const anchor = { top: 100, left: 40, width: 200, height: 18 };
const viewport = { width: 1200, height: 800 };

describe('HoverCard', () => {
  it('renders the diff and buttons for a contradicted claim and reports actions', () => {
    const s = sampleState();
    const f3 = s.claims.find((c) => c.id === 'f3')!;
    const onApply = vi.fn();
    const onKeep = vi.fn();
    const c = document.createElement('div');
    render(<HoverCard finding={{ kind: 'claim', f: f3 }} anchor={anchor} pinned={false} viewport={viewport} onApply={onApply} onKeep={onKeep} />, c);

    expect(c.querySelector('.ws-chip')?.textContent).toBe('Contradicted');
    expect(c.querySelector('.ws-diff del')?.textContent).toBe('not a single company went back to five days');
    expect(c.querySelector('.ws-diff ins')?.textContent).toBe('56 of the 61 companies kept it');
    expect(c.querySelector('.ws-src a')?.getAttribute('href')).toContain('autonomy.work');
    expect(c.querySelector('.ws-meter i.on')).not.toBeNull();

    click(c.querySelector('[data-act="apply"]'));
    expect(onApply).toHaveBeenCalledWith('f3', f3.span, '56 of the 61 companies kept it');
    click(c.querySelector('[data-act="keep"]'));
    expect(onKeep).toHaveBeenCalledWith('f3');
  });

  it('shows no buttons for a supported claim, and a done line for an applied one', () => {
    const s = sampleState();
    const f2 = s.claims.find((c) => c.id === 'f2')!;
    const c = document.createElement('div');
    render(<HoverCard finding={{ kind: 'claim', f: f2 }} anchor={anchor} pinned viewport={viewport} onApply={() => {}} onKeep={() => {}} />, c);
    expect(c.querySelector('.ws-chip')?.textContent).toBe('Verified');
    expect(c.querySelector('[data-act="apply"]')).toBeNull();
    expect(c.textContent).toContain('pinned');

    const f3 = { ...s.claims.find((c) => c.id === 'f3')!, status: 'applied' as const };
    const c2 = document.createElement('div');
    render(<HoverCard finding={{ kind: 'claim', f: f3 }} anchor={anchor} pinned={false} viewport={viewport} onApply={() => {}} onKeep={() => {}} />, c2);
    expect(c2.querySelector('.ws-done')?.textContent).toContain('Change applied');
    expect(c2.querySelector('[data-act="apply"]')).toBeNull();
  });

  it('renders a clarity note with its suggestion diff', () => {
    const s = sampleState();
    const c1 = s.clarity.find((c) => c.id === 'c1')!;
    const c = document.createElement('div');
    render(<HoverCard finding={{ kind: 'clarity', f: c1 }} anchor={anchor} pinned={false} viewport={viewport} onApply={() => {}} onKeep={() => {}} />, c);
    expect(c.querySelector('.ws-chip')?.textContent).toBe('Fuzzy');
    expect(c.textContent).toContain('Who is "people"?');
    expect(c.querySelector('.ws-diff ins')?.textContent).toContain('nice perk');
  });

  it('flips above the anchor when there is no room below and clamps to the right edge', () => {
    const below = cardPosition({ top: 700, left: 1100, width: 50, height: 18 }, viewport, 240);
    expect(below.top).toBeLessThan(700);
    expect(below.left + 330).toBeLessThanOrEqual(viewport.width - 12);
  });
});
