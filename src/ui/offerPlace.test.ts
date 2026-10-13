import { describe, expect, it } from 'vitest';
import { covered, offerPlace, overlapArea } from './offerPlace';

const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });

describe('overlapArea', () => {
  it('is the shared area, and nothing for boxes apart or only touching', () => {
    expect(overlapArea(box(0, 0, 100, 40), box(50, 20, 100, 40))).toBe(50 * 20);
    expect(overlapArea(box(0, 0, 100, 40), box(100, 0, 50, 40))).toBe(0);
    expect(overlapArea(box(0, 0, 100, 40), box(0, 41, 100, 40))).toBe(0);
    expect(overlapArea(box(0, 0, 100, 40), box(10, 10, 20, 10))).toBe(200);
  });
});

describe('where the undo offer goes in a short window', () => {
  const offer = box(200, 260, 240, 36);
  it('stays at the foot while it lies on no slider or number box', () => {
    const sliders = [box(100, 200, 140, 20), box(100, 300, 140, 20)];
    expect(covered(offer, sliders)).toBe(0);
    expect(offerPlace(covered(offer, sliders), () => 0)).toBe('foot');
  });

  it('goes under the status line when it lies on one at the foot and on less at the top', () => {
    const sliders = [box(220, 270, 140, 20)];
    expect(covered(offer, sliders)).toBeGreaterThan(0);
    expect(offerPlace(covered(offer, sliders), () => 0)).toBe('top');
    expect(offerPlace(100, () => 40)).toBe('top');
  });

  it('stays at the foot when the top is no better, and does not try the top when the foot is free', () => {
    expect(offerPlace(100, () => 100)).toBe('foot');
    expect(offerPlace(100, () => 250)).toBe('foot');
    let asked = 0;
    offerPlace(0, () => ++asked);
    expect(asked).toBe(0);
  });
});
