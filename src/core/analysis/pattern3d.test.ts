import { describe, expect, it } from 'vitest';
import { combine, reconstruct3d } from './pattern3d';
import { at } from './grid';
import { gridFrom, quadBeam } from '../../test/synthetic';

const h = gridFrom(quadBeam(65));
const v = gridFrom(quadBeam(10));

describe('combine', () => {
  it('adds the cuts for summation', () => {
    expect(combine(3, 4, 'summation')).toBe(7);
  });

  it('returns the other cut when one cut is at its peak (weighted)', () => {
    expect(combine(0, 12, 'weighted')).toBeCloseTo(12, 9);
    expect(combine(9, 0, 'weighted')).toBeCloseTo(9, 9);
  });

  it('falls back to summation at the joint peak (weighted)', () => {
    expect(combine(0, 0, 'weighted')).toBe(0);
  });

  it('stays between the two cut values and is never NaN (weighted)', () => {
    for (const [a, b] of [
      [3, 10],
      [20, 1],
      [40, 40],
      [0.01, 35],
    ]) {
      const r = combine(a, b, 'weighted');
      expect(Number.isNaN(r)).toBe(false);
      expect(r).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
      expect(r).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
    }
  });
});

describe('reconstruct3d', () => {
  for (const method of ['summation', 'weighted'] as const) {
    it(`${method}: matches the H cut on the horizon and the V cut at boresight`, () => {
      const s = reconstruct3d(h, v, method);
      expect(s.az).toHaveLength(121);
      expect(s.el).toHaveLength(61);
      expect(s.az[0]).toBe(-180);
      expect(s.el[0]).toBe(-90);
      const horizon = s.el.indexOf(0);
      const bore = s.az.indexOf(0);
      s.az.forEach((a, j) => expect(s.atten[horizon][j]).toBeCloseTo(at(h, a), 9));
      s.el.forEach((e, i) => expect(s.atten[i][bore]).toBeCloseTo(at(v, e), 9));
    });
  }

  it('summation adds both cuts off-axis', () => {
    const s = reconstruct3d(h, v, 'summation');
    expect(s.atten[s.el.indexOf(6)][s.az.indexOf(30)]).toBeCloseTo(at(h, 30) + at(v, 6), 9);
  });

  it('weighted produces finite values everywhere', () => {
    const s = reconstruct3d(h, v, 'weighted');
    expect(s.atten.flat().every(Number.isFinite)).toBe(true);
  });
});
