import { describe, expect, it } from 'vitest';
import { buildHpbwFigure, MIN_SPAN_DEG, minSpanRange } from './hpbwFigure';
import { FIGURE_THEMES } from './figureTheme';

describe('minSpanRange', () => {
  it('centres a minimum-span range on a narrow data span', () => {
    const [lo, hi] = minSpanRange([65.01, 65.03])!;
    expect(lo).toBeCloseTo(62.52, 9);
    expect(hi).toBeCloseTo(67.52, 9);
    expect(hi - lo).toBeCloseTo(MIN_SPAN_DEG, 9);
  });
  it('leaves wide data to the automatic range, and ignores gaps', () => {
    expect(minSpanRange([60, 66])).toBeUndefined();
    expect(minSpanRange([null, undefined])).toBeUndefined();
    expect(minSpanRange([])).toBeUndefined();
    expect(minSpanRange([60, null, 70])).toBeUndefined();
  });
});

describe('beamwidth chart axes', () => {
  it('uses at least 5 degrees for a single frequency and the automatic range for a wide spread', () => {
    const one = buildHpbwFigure([{ label: 'a', color: '#123456', points: [{ freq: 1800, h: 65, v: 8 }] }], FIGURE_THEMES.light);
    expect(one.layout.yaxis?.range).toEqual([62.5, 67.5]);
    expect(one.layout.yaxis2?.range).toEqual([5.5, 10.5]);
    const wide = buildHpbwFigure(
      [{ label: 'a', color: '#123456', points: [{ freq: 1700, h: 60, v: 7 }, { freq: 2100, h: 70, v: 9 }] }],
      FIGURE_THEMES.light,
    );
    expect(wide.layout.yaxis?.range).toBeUndefined();
    expect(wide.layout.yaxis2?.range).toEqual([5.5, 10.5]);
  });
});
