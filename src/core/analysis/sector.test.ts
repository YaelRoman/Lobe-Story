import { describe, expect, it } from 'vitest';
import { duAperture, duCurve, DU_LEVELS, rollOff, sectorPower } from './sector';
import { beamTracking } from './tracking';
import { gridFrom, quadBeam } from '../../test/synthetic';
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
    // 360 / 8 = 45: integer; 360 / 7 is fractional.
    const g = gridFrom((a) => Math.abs(a) / 10);
    const du = duCurve(g, 7);
    expect(du).toHaveLength(360);
    expect(Number.isFinite(du[0])).toBe(true);
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
      expect(r.edges![0]).toBeCloseTo(lo, 0);
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
});
