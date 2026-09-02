// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { PreviewModal } from '../../../src/ui/components/PreviewModal';
import { SAMPLE_TEXT } from '../../../src/shared/sample';
import { click, sampleState } from './ui-helpers';

function mountModal(tab: 'email' | 'x' | 'linkedin', state = sampleState(), extra: Partial<{ onClose: () => void; onShare: (t: 'x' | 'linkedin') => void; onCopy: (t: string, w: string) => void; onTab: (t: 'email' | 'x' | 'linkedin') => void }> = {}) {
  const c = document.createElement('div');
  render(
    <PreviewModal state={state} text={SAMPLE_TEXT} tab={tab} onTab={extra.onTab ?? (() => {})} onClose={extra.onClose ?? (() => {})} onCopy={extra.onCopy ?? (() => {})} onShare={extra.onShare ?? (() => {})} />,
    c,
  );
  return c;
}

describe('PreviewModal', () => {
  it('X tab splits into a thread and flags the post carrying the open contradicted claim', () => {
    const c = mountModal('x');
    const posts = [...c.querySelectorAll('.ws-post')];
    expect(posts.length).toBeGreaterThan(1);
    const flagged = posts.filter((p) => p.classList.contains('flag'));
    expect(flagged.length).toBe(1);
    expect(flagged[0]!.textContent).toContain('not a single company went back to five days');
    expect(flagged[0]!.querySelector('.pflag')?.textContent).toMatch(/Post \d still carries the contradicted claim/);
    expect(c.querySelector('.ws-meta .n.over')?.textContent).toMatch(/\/ 280$/);
    expect(c.querySelector('.flag')?.textContent).toContain('2 fact-check flags still open');
  });
  it('X tab has no flagged post once the contradicted claim is resolved', () => {
    const s = sampleState();
    s.claims.find((x) => x.id === 'f3')!.status = 'applied';
    const c = mountModal('x', s);
    expect(c.querySelectorAll('.ws-post.flag').length).toBe(0);
  });
  it('Email tab shows words and read time, LinkedIn shows the fold', () => {
    const e = mountModal('email');
    expect(e.textContent).toContain('words');
    expect(e.querySelectorAll('.ws-mail p').length).toBe(7);
    const l = mountModal('linkedin');
    expect(l.querySelector('.ws-li .fold')).not.toBeNull();
    expect(l.textContent).toContain('/ 3,000');
  });
  it('wires close, tabs, copy and share', () => {
    const onClose = vi.fn();
    const onShare = vi.fn();
    const onCopy = vi.fn();
    const onTab = vi.fn();
    const c = mountModal('x', sampleState(), { onClose, onShare, onCopy, onTab });
    click(c.querySelector('.ws-mclose'));
    expect(onClose).toHaveBeenCalled();
    click(c.querySelector('[role="tab"]'));
    expect(onTab).toHaveBeenCalledWith('email');
    click([...c.querySelectorAll('.ws-mfoot .ws-btn')].find((b) => b.textContent?.includes('Copy thread')));
    expect(onCopy).toHaveBeenCalled();
    expect((onCopy.mock.calls[0]![0] as string)).toContain('(1/');
    click(c.querySelector('.ws-mfoot .ws-btn.primary'));
    expect(onShare).toHaveBeenCalledWith('x');
  });
});
