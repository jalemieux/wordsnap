// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { ExportBar } from '../../../src/ui/components/ExportBar';
import { SAMPLE_TEXT } from '../../../src/shared/sample';
import { bodyText } from '../../../src/ui/format';
import { click, sampleState } from './ui-helpers';

function mountBar(state = sampleState(), handlers: Partial<{ onCopy: () => void; onShare: (t: 'x' | 'linkedin') => void; onPreview: () => void }> = {}) {
  const c = document.createElement('div');
  render(<ExportBar state={state} text={SAMPLE_TEXT} onCopy={handlers.onCopy ?? (() => {})} onShare={handlers.onShare ?? (() => {})} onPreview={handlers.onPreview ?? (() => {})} />, c);
  return c;
}

describe('ExportBar', () => {
  it('warns in red while a claim is contradicted or imprecise', () => {
    const c = mountBar();
    expect(c.querySelector('.warn')?.textContent).toBe('2 claims still open');
    expect(c.querySelector('.ok')).toBeNull();
  });
  it('turns green once the open claims are resolved', () => {
    const s = sampleState();
    s.claims.find((x) => x.id === 'f3')!.status = 'applied';
    s.claims.find((x) => x.id === 'f1')!.status = 'kept';
    const c = mountBar(s);
    expect(c.querySelector('.ok')?.textContent).toBe('Claims checked, nothing open');
  });
  it('shows a neutral note before any claim was checked', () => {
    const s = sampleState();
    s.claims.forEach((x) => delete x.data.verdict);
    const c = mountBar(s);
    expect(c.textContent).toContain('Claims not checked yet');
  });
  it('shows the body character count and wires the buttons', () => {
    const onShare = vi.fn();
    const onPreview = vi.fn();
    const onCopy = vi.fn();
    const c = mountBar(sampleState(), { onShare, onPreview, onCopy });
    expect(c.querySelector('[data-x="x"] .g')?.textContent).toBe(String(bodyText(SAMPLE_TEXT).length));
    click(c.querySelector('[data-x="x"]'));
    expect(onShare).toHaveBeenCalledWith('x');
    click(c.querySelector('[data-x="linkedin"]'));
    expect(onShare).toHaveBeenCalledWith('linkedin');
    click(c.querySelector('[data-x="preview"]'));
    expect(onPreview).toHaveBeenCalled();
    click(c.querySelector('[data-x="copy"]'));
    expect(onCopy).toHaveBeenCalled();
  });
});
