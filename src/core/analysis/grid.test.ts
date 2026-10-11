import { describe, expect, it } from 'vitest';
import { at, mod360, peakIndex, refinedPeak, signed, toGrid } from './grid';
import { gridFrom } from '../../test/synthetic';

const deg = Array.from({ length: 360 }, (_, i) => i);

describe('angle helpers', () => {
  it('wraps angles', () => {
    expect(mod360(-1)).toBe(359);
    expect(mod360(360)).toBe(0);
    expect(signed(270)).toBe(-90);
    expect(signed(180)).toBe(180);
    expect(signed(-190)).toBe(170);
  });
});

describe('toGrid', () => {
  it('passes a 1° grid through and normalises to its minimum', () => {
    const g = toGrid({ angles: deg, atten: deg.map((a) => (a === 10 ? 2 : 5)) });
    expect(g).toHaveLength(360);
    expect(g[10]).toBe(0);
    expect(g[0]).toBe(3);
  });

  it('linearly resamples a 2° grid, wrapping past 358°', () => {
    const angles = deg.filter((a) => a % 2 === 0);
    const g = toGrid({ angles, atten: angles.map((a) => a) });
    expect(g[1]).toBeCloseTo(1);
    expect(g[359]).toBeCloseTo(179);
  });

  it('accepts signed angles', () => {
    const angles = deg.map((a) => a - 180);
    const g = toGrid({ angles, atten: angles.map((a) => Math.abs(a)) });
    expect(g[350]).toBeCloseTo(10);
    expect(g[0]).toBe(0);
  });

  it('uses the last value for duplicate angles', () => {
    const g = toGrid({ angles: [...deg, 0], atten: [...deg.map(() => 5), 1] });
    expect(g[0]).toBe(0);
    expect(g[1]).toBe(4);
  });
});

describe('peak helpers', () => {
  it('finds the first minimum and reads any angle', () => {
    const g = gridFrom((a) => Math.abs(a + 8));
    expect(peakIndex(g)).toBe(352);
    expect(at(g, -8)).toBe(0);
    expect(at(g, 362)).toBe(10);
  });

  it('refines the peak with a parabola', () => {
    expect(refinedPeak(gridFrom((a) => (a - 0.3) ** 2))).toBeCloseTo(0.3, 5);
    expect(refinedPeak(gridFrom((a) => Math.abs(a - 20)))).toBe(20);
  });
});
