import { describe, expect, it } from 'vitest';
import { duAperture, duCurve, DU_LEVELS, rollOff, rollOffEdges, sectorPower } from './sector';
import { beamTracking, edgeTracking } from './tracking';
import { gridFrom, pwl, quadBeam } from '../../test/synthetic';
import { signed } from './grid';

const brick = gridFrom((a) => (Math.abs(a) <= 60 ? 0 : 30));
const parabola = quadBeam(65); // att = min(40, 3 (a / 32.5)^2)
const parabolaGrid = gridFrom(parabola);

describe('sectorPower', () => {
  it('matches the closed form for a brick-wall pattern', () => {
    const { spr, air } = sectorPower(brick, 60);
    // Inside: 119 full samples + 2 half-weighted edge samples = 120. Total power: 121 + 239 * 0.001.
    const pd = 120;
    const pu = 121 + 239 * 0.001 - pd;
    expect(spr.value).toBeCloseTo((100 * pu) / pd, 9);
    expect(air.value).toBeCloseTo(10 * Math.log10(pd / pu), 9);
  });

  it('handles a fractional edge (outer samples at integer degrees only)', () => {
    // att = 0 for |a| <= 2, else 30; edge 2.5: samples d = -2..2 are full weight.
    const g = gridFrom((a) => (Math.abs(a) <= 2 ? 0 : 30));
    const { spr } = sectorPower(g, 2.5);
    // pd = 5, pu = 355 * 0.001 -> SPR = 100 * 0.355 / 5 = 7.1
    expect(spr.value).toBeCloseTo(7.1, 9);
  });

  it('reports no AIR and an SPR of 0 when nothing lies outside the sector', () => {
    const { spr, air } = sectorPower(parabolaGrid, 180);
    expect(spr.value).toBe(0);
    expect(air).toEqual({ value: null, reason: 'No power outside the sector' });
  });
});

describe('rollOff', () => {
  it('reads the level at the sector edge', () => {
    expect(rollOff(brick, 60).value).toBe(0);
    expect(rollOff(brick, 61).value).toBe(30);
  });

  it('equals the formula for a parabolic beam', () => {
    const r = rollOff(parabolaGrid, 60);
    expect(r.value).toBeCloseTo(Math.min(40, 3 * (60 / 32.5) ** 2), 9);
  });

  it('picks the worse edge and reports its sign', () => {
    const left = gridFrom((a) => (a === -60 ? 12 : a === 60 ? 5 : 0));
    expect(rollOff(left, 60)).toEqual({ value: 12, angle: -60 });
    const right = gridFrom((a) => (a === 60 ? 9 : a === -60 ? 5 : 0));
    expect(rollOff(right, 60)).toEqual({ value: 9, angle: 60 });
  });

  it('interpolates for a fractional edge', () => {
    const g = gridFrom((a) => Math.abs(a));
    expect(rollOff(g, 60.5).value).toBeCloseTo(60.5, 9);
  });
});

describe('rollOffEdges', () => {
  const asym = gridFrom(pwl([[-180, 30], [-60, 12], [0, 0], [60, 9], [180, 30]]));

  it('reads the level at both edges, left first', () => {
    expect(rollOffEdges(asym)).toEqual([12, 9]);
    expect(rollOffEdges(asym, 30)).toEqual([6, 4.5]);
    expect(rollOff(asym)).toEqual({ value: 12, angle: -60 });
  });
});

describe('edgeTracking', () => {
  const a = gridFrom(pwl([[-180, 30], [-60, 12], [0, 0], [60, 9], [180, 30]]));
  const b = gridFrom(pwl([[-180, 30], [-60, 11], [0, 0], [60, 10], [180, 30]]));

  it('is the port-to-port difference at the two edges', () => {
    const [l, r] = edgeTracking(a, b);
    expect(l).toBeCloseTo(1, 9);
    expect(r).toBeCloseTo(1, 9);
  });

  it('subtracts the gain difference first', () => {
    const [l, r] = edgeTracking(a, b, 60, 0.5);
    expect(l).toBeCloseTo(0.5, 9); // |0.5 − 1|
    expect(r).toBeCloseTo(1.5, 9); // |0.5 − (−1)|
  });
});

describe('duCurve', () => {
  it('is the desired minus the strongest neighbouring-sector copy', () => {
    const du = duCurve(parabolaGrid, 3);
    expect(du).toHaveLength(360);
    expect(du[0]).toBeCloseTo(40, 9);
  });

  it('is Infinity with fewer than two sectors', () => {
    expect(duCurve(parabolaGrid, 1).every((v) => v === Infinity)).toBe(true);
  });

  it('interpolates fractional sector shifts', () => {
    // att = |a|/10 on the signed angle; 7 sectors -> shifts of 360/7 degrees (fractional).
    const g = gridFrom((a) => Math.abs(a) / 10);
    const du = duCurve(g, 7);
    expect(du).toHaveLength(360);
    expect(du[0]).toBeCloseTo(5.143, 3);
  });

  it('matches a brute-force interpolation across the 359 -> 0 wrap', () => {
    const att = (a: number) => Math.abs(signed(a)) / 10;
    const g = gridFrom(att);
    const sectors = 7;
    const du = duCurve(g, sectors);
    for (const p of [0, 1, 2, 357, 358, 359]) {
      let m = Infinity;
      for (let k = 1; k < sectors; k++) {
        const a = (((p - (k * 360) / sectors) % 360) + 360) % 360;
        const i = Math.floor(a);
        const f = a - i;
        // linear interpolation of the integer-grid samples, wrapping 359 -> 0
        m = Math.min(m, g[i % 360] * (1 - f) + g[(i + 1) % 360] * f - g[p]);
      }
      expect(du[p]).toBeCloseTo(m, 9);
    }
  });
});

/** Brute-force aperture on the continuous parabola, 0.01 degree steps. */
function bruteAperture(thr: number, sectors = 3): [number, number] {
  const att = (a: number) => parabola(signed(a));
  const du = (p: number) => {
    let m = Infinity;
    for (let k = 1; k < sectors; k++) m = Math.min(m, att(p - (k * 360) / sectors) - att(p));
    return m;
  };
  let hi = 0;
  while (du(hi + 0.01) >= thr) hi += 0.01;
  let lo = 0;
  while (du(lo - 0.01) >= thr) lo -= 0.01;
  return [lo, hi];
}

describe('duAperture', () => {
  it('exposes the three QAM levels', () => {
    expect(DU_LEVELS.map((l) => l.db)).toEqual([15, 20, 25]);
  });

  it('matches a brute-force evaluation and shrinks with the threshold', () => {
    const widths = [15, 20, 25].map((thr) => {
      const r = duAperture(parabolaGrid, thr, 3);
      const [lo, hi] = bruteAperture(thr);
      expect(Math.abs(r.edges![0] - lo)).toBeLessThan(0.1);
      expect(Math.abs(r.edges![1] - hi)).toBeLessThan(0.1);
      expect(r.edges![0]).toBeCloseTo(-r.edges![1], 9);
      expect(r.value).toBeCloseTo(r.edges![1] - r.edges![0], 9);
      expect(r.angle).toBeCloseTo(0, 9);
      return r.value as number;
    });
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
  });

  it('is null with a reason when boresight is below the threshold', () => {
    expect(duAperture(parabolaGrid, 45, 3)).toEqual({ value: null, reason: 'D/U at boresight is below 45 dB' });
  });

  it('is null for an omni pattern at every level', () => {
    const omni = gridFrom(() => 0);
    for (const l of DU_LEVELS) expect(duAperture(omni, l.db, 3).value).toBeNull();
  });

  it('is 360 with a single sector', () => {
    expect(duAperture(parabolaGrid, 25, 1).value).toBe(360);
  });
});

describe('beamTracking', () => {
  const flat = gridFrom(() => 0);
  it('adds the gain delta to identical shapes', () => {
    expect(beamTracking(flat, flat, 60, 1.5).value).toBeCloseTo(1.5, 9);
  });

  it('combines shape difference and gain delta', () => {
    const b = gridFrom((a) => (a === 40 ? 0 : 0));
    const a = gridFrom((x) => (x === 40 ? 2 : 0));
    const r = beamTracking(a, b, 60, -0.5);
    expect(r.value).toBeCloseTo(2.5, 9);
    expect(r.angle).toBe(40);
  });
  it('samples the grids like the edge statistic, so a fractional edge cannot exceed the maximum', () => {
    const a = gridFrom(() => 0);
    const b = gridFrom((x) => (x === -60 ? 10 : 0));
    const edges = edgeTracking(a, b, 59.5);
    expect(edges[0]).toBeCloseTo(5, 9);
    expect(edges[1]).toBeCloseTo(0, 9);
    const worst = beamTracking(a, b, 59.5);
    expect(worst.value).toBeGreaterThanOrEqual(Math.max(...edges));
    expect(worst.value).toBeCloseTo(5, 9);
    expect(worst.angle).toBe(-59.5);
  });
});
