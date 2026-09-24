import { placePanel } from '../../src/ui/components/ChallengesPanel';

const vp = { width: 1400, height: 900 };

describe('placePanel', () => {
  it('keeps a dragged panel where it was dropped, with the room below it as its height', () => {
    expect(placePanel({ left: 400, top: 200 }, vp)).toEqual({ left: 400, top: 200, maxHeight: 692 });
  });

  it('caps the height at 80% of the viewport', () => {
    expect(placePanel({ left: 400, top: 40 }, vp).maxHeight).toBe(720);
  });

  it('keeps the whole width and at least 160px of height on screen', () => {
    expect(placePanel({ left: -300, top: -50 }, vp)).toMatchObject({ left: 8, top: 8 });
    expect(placePanel({ left: 1300, top: 890 }, vp)).toMatchObject({ left: 1400 - 336 - 8, top: 900 - 160 - 8 });
  });

  it('snaps to an edge dropped within 24px of it', () => {
    expect(placePanel({ left: 20, top: 30 }, vp)).toMatchObject({ left: 8, top: 8 });
    expect(placePanel({ left: 1400 - 336 - 30, top: 300 }, vp)).toMatchObject({ left: 1400 - 336 - 8, top: 300 });
  });
});
