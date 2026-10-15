import { describe, expect, it } from 'vitest';
import { angularRegionEfficiency, regionPowers, typeARegions, LOWER_REGION_START_DEG, type AngularRegions } from './are';
import { combine, type Method3d } from './pattern3d';
import { gridFrom, quadBeam } from '../../test/synthetic';
import type { Grid } from './grid';

/** Integrates the 3D reconstruction many times: about 1 s alone, up to ~15 s when the whole suite runs in parallel on a busy machine. */
const HEAVY_TEST_MS = 30_000;

const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
const METHODS: Method3d[] = ['summation', 'weighted'];

const isotropic = gridFrom(() => 0);
const sumOf = (p: ReturnType<typeof regionPowers>) => p.upper + p.interference + p.service + p.lower;

/** A macro-like pair of cuts: 65° azimuth beam with a 25 dB back level, 8° elevation beam 6° below the horizon with a 20 dB floor. */
const h65 = gridFrom(quadBeam(65, 0, 25));
const v8 = gridFrom(quadBeam(8, 6, 20));

/** Linear power of a grid at a fractional angle, linear between the 1° samples (the integrator's stated model). */
function powerAt(g: Grid, angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  const i = Math.floor(a);
  const f = a - i;
  const p0 = 10 ** (-g[i % 360] / 10);
  const p1 = 10 ** (-g[(i + 1) % 360] / 10);
  return p0 + (p1 - p0) * f;
}

/** Midpoint rule with a fine step: an independent check of a 1D integral of `f` over [lo, hi] degrees, in radians. */
function fine(f: (deg: number) => number, lo: number, hi: number, n = 20000): number {
  const step = (hi - lo) / n;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += f(lo + (k + 0.5) * step);
  return sum * step * RAD;
}

describe('typeARegions (BASTA Table 7-1, Type A, in elevation from the horizon)', () => {
  it('puts the service region from half a beamwidth above the peak down to 75° below the horizon', () => {
    expect(typeARegions(6, 8, 60)).toEqual({ upperEndDeg: -2, serviceStartDeg: 2, serviceEndDeg: 75, sectorEdgeDeg: 60 });
    expect(LOWER_REGION_START_DEG).toBe(75);
  });

  it('never lets the upper region reach below the horizon (theta1 = min(90°, peak − HPBW) from the zenith)', () => {
    expect(typeARegions(12, 8, 45)).toEqual({ upperEndDeg: 0, serviceStartDeg: 8, serviceEndDeg: 75, sectorEdgeDeg: 45 });
  });

  it('follows an uptilted beam above the horizon', () => {
    expect(typeARegions(-3, 10, 60)).toEqual({ upperEndDeg: -13, serviceStartDeg: -8, serviceEndDeg: 75, sectorEdgeDeg: 60 });
  });
});

describe('regionPowers', () => {
  const regions: AngularRegions = { upperEndDeg: -2, serviceStartDeg: 2, serviceEndDeg: 75, sectorEdgeDeg: 60 };

  it.each(METHODS)('gives the solid angles of the regions for an isotropic pattern (%s)', (method) => {
    const p = regionPowers(isotropic, isotropic, regions, method);
    // Solid angle of an elevation band [a, b] over an azimuth width w (radians): w · (sin b − sin a).
    expect(p.upper).toBeCloseTo(2 * Math.PI * (sin(-2) - sin(-90)), 9);
    expect(p.service).toBeCloseTo(120 * RAD * (sin(75) - sin(2)), 9);
    expect(p.interference).toBeCloseTo(2 * Math.PI * (sin(75) - sin(-2)) - 120 * RAD * (sin(75) - sin(2)), 9);
    expect(p.lower).toBeCloseTo(2 * Math.PI * (sin(90) - sin(75)), 9);
  });

  it.each(METHODS)('gives the solid angles for non-integer boundaries too (%s)', (method) => {
    const odd: AngularRegions = { upperEndDeg: -7.3, serviceStartDeg: 1.25, serviceEndDeg: 75, sectorEdgeDeg: 32.5 };
    const p = regionPowers(isotropic, isotropic, odd, method);
    expect(p.upper).toBeCloseTo(2 * Math.PI * (sin(-7.3) + 1), 9);
    expect(p.service).toBeCloseTo(65 * RAD * (sin(75) - sin(1.25)), 9);
    expect(p.lower).toBeCloseTo(2 * Math.PI * (1 - sin(75)), 9);
  });

  it.each(METHODS)('partitions the sphere: the four regions of an isotropic pattern add up to 4π (%s)', (method) => {
    for (const r of [regions, { upperEndDeg: -7.3, serviceStartDeg: 1.25, serviceEndDeg: 75, sectorEdgeDeg: 32.5 }]) {
      expect(sumOf(regionPowers(isotropic, isotropic, r, method)) / (4 * Math.PI)).toBeCloseTo(1, 6);
    }
  });

  it.each(METHODS)('partitions the power of a real beam: the total does not depend on where the boundaries are (%s)', (method) => {
    const whole = sumOf(regionPowers(h65, v8, regions, method));
    const moved = sumOf(regionPowers(h65, v8, { upperEndDeg: -11.37, serviceStartDeg: 3.61, serviceEndDeg: 75, sectorEdgeDeg: 47.2 }, method));
    expect(moved / whole).toBeCloseTo(1, 9);
    const p = regionPowers(h65, v8, regions, method);
    for (const part of [p.upper, p.interference, p.service, p.lower]) expect(part).toBeGreaterThan(0);
  });

  it('is the product of the two cut integrals for the summation method', () => {
    const p = regionPowers(h65, v8, regions, 'summation');
    const azAll = fine((a) => powerAt(h65, a), -180, 180);
    const azSector = fine((a) => powerAt(h65, a), -60, 60);
    const el = (lo: number, hi: number) => fine((e) => powerAt(v8, e) * Math.cos(e * RAD), lo, hi);
    expect(p.service).toBeCloseTo(azSector * el(2, 75), 6);
    expect(p.upper).toBeCloseTo(azAll * el(-90, -2), 6);
    expect(p.lower).toBeCloseTo(azAll * el(75, 90), 6);
    expect(p.interference).toBeCloseTo(azAll * el(-2, 75) - azSector * el(2, 75), 6);
  });

  it('integrates the same intensity as the 3D reconstruction for the weighted method', () => {
    // Trapezoid over the 1° samples of combine(), row by row, with the cos(elevation) weight evaluated finely.
    const row = (e: number, lo: number, hi: number) => {
      let s = 0;
      for (let a = lo; a < hi; a++) {
        const at = (x: number) => 10 ** (-combine(h65[(x + 360) % 360], v8[(e + 360) % 360], 'weighted') / 10);
        s += (at(a) + at(a + 1)) / 2;
      }
      return s * RAD;
    };
    const band = (lo: number, hi: number, azLo: number, azHi: number) =>
      fine((x) => {
        const e = Math.min(Math.floor(x), hi - 1);
        const f = x - e;
        return (row(e, azLo, azHi) * (1 - f) + row(e + 1, azLo, azHi) * f) * Math.cos(x * RAD);
      }, lo, hi, 4000);
    const p = regionPowers(h65, v8, regions, 'weighted');
    expect(p.service).toBeCloseTo(band(2, 75, -60, 60), 6);
    expect(p.lower).toBeCloseTo(band(75, 90, -180, 180), 6);
  }, HEAVY_TEST_MS);

  it('interpolates at a non-integer elevation boundary instead of snapping to a whole degree', () => {
    // A step in the elevation cut between 3° and 4°: the boundary at 3.5° cuts that step in two.
    const step = gridFrom((a) => (a <= 3 ? 0 : 10));
    const at = (start: number) => regionPowers(isotropic, step, { ...regions, serviceStartDeg: start }, 'summation').service;
    expect(at(3.5)).toBeLessThan(at(3));
    expect(at(3.5)).toBeGreaterThan(at(4));
    const expected = 120 * RAD * fine((e) => powerAt(step, e) * Math.cos(e * RAD), 3.5, 75);
    expect(at(3.5)).toBeCloseTo(expected, 7);
    expect(Math.abs(at(3.5) - at(3))).toBeGreaterThan(1e-3);
    expect(Math.abs(at(3.5) - at(4))).toBeGreaterThan(1e-4);
  });

  it('interpolates at a non-integer sector edge', () => {
    const narrow = gridFrom((a) => (Math.abs(a) <= 30 ? 0 : 10));
    const at = (edge: number) => regionPowers(narrow, isotropic, { ...regions, sectorEdgeDeg: edge }, 'summation').service;
    const elevation = sin(75) - sin(2);
    expect(at(30.5)).toBeCloseTo(fine((a) => powerAt(narrow, a), -30.5, 30.5) * elevation, 7);
    expect(at(30.5)).toBeGreaterThan(at(30));
    expect(at(30.5)).toBeLessThan(at(31));
  });

  it('counts a direction without a finite level as no power', () => {
    const hole = [...isotropic];
    hole[180] = Infinity;
    for (const method of METHODS) expect(Number.isFinite(sumOf(regionPowers(hole, isotropic, regions, method)))).toBe(true);
  });
});

describe('angularRegionEfficiency', () => {
  it.each(METHODS)('is the three ratios of the region powers, in percent (%s)', (method) => {
    const r = angularRegionEfficiency(h65, v8, 60, method);
    // quadBeam(8, 6): peak 6° below the horizon, HPBW 8° → Type A regions as in typeARegions(6, 8, 60).
    const p = regionPowers(h65, v8, typeARegions(6, 8, 60), method);
    expect(r.sector.value).toBeCloseTo((100 * p.service) / sumOf(p), 6);
    expect(r.spatial.value).toBeCloseTo((100 * p.service) / (p.service + p.interference), 6);
    expect(r.lower.value).toBeCloseTo((100 * p.lower) / sumOf(p), 6);
    for (const m of [r.sector, r.spatial, r.lower]) {
      expect(m.value).toBeGreaterThan(0);
      expect(m.value).toBeLessThan(100);
    }
    expect(r.spatial.value!).toBeGreaterThan(r.sector.value!);
    expect(r.sector.value!).toBeGreaterThan(r.lower.value!);
  });

  it.each(METHODS)('is about 100 % for a pattern confined to the service region (%s)', (method) => {
    // Flat tops with an 80 dB floor: azimuth ±40° (inside the ±60° sector), elevation 5…11° below the horizon.
    const h = gridFrom((a) => (Math.abs(a) <= 40 ? 0 : 80));
    const v = gridFrom((a) => (a >= 5 && a <= 11 ? 0 : 80));
    const r = angularRegionEfficiency(h, v, 60, method);
    expect(r.sector.value).toBeGreaterThan(99.99);
    expect(r.sector.value).toBeLessThanOrEqual(100);
    expect(r.spatial.value).toBeGreaterThan(99.99);
    expect(r.lower.value).toBeLessThan(0.01);
    expect(r.lower.value).toBeGreaterThanOrEqual(0);
  });

  it.each(METHODS)('grows with the sector width; the lower region ratio does not depend on it (%s)', (method) => {
    const edges = [20, 30, 45, 60, 75.5, 90, 120];
    const results = edges.map((e) => angularRegionEfficiency(h65, v8, e, method));
    for (let k = 1; k < results.length; k++) {
      expect(results[k].sector.value!).toBeGreaterThan(results[k - 1].sector.value!);
      expect(results[k].spatial.value!).toBeGreaterThan(results[k - 1].spatial.value!);
      expect(results[k].lower.value).toBeCloseTo(results[0].lower.value!, 9);
    }
  });

  it('gives no number, with the reason, for a beam outside the Type A ranges', () => {
    const wideV = angularRegionEfficiency(h65, gridFrom(quadBeam(30, 6, 30)), 60, 'summation');
    for (const m of [wideV.sector, wideV.spatial, wideV.lower]) {
      expect(m.value).toBeNull();
      expect(m.reason).toMatch(/Type A/);
      expect(m.reason).toMatch(/V-HPBW 30\.0° is outside 0\.5–25°/);
    }
    const narrowH = angularRegionEfficiency(gridFrom(quadBeam(33, 0, 30)), v8, 60, 'summation');
    expect(narrowH.sector.value).toBeNull();
    expect(narrowH.sector.reason).toMatch(/H-HPBW 33\.0° is outside 50–130°/);
    const wideH = angularRegionEfficiency(gridFrom(quadBeam(150, 0, 30)), v8, 60, 'summation');
    expect(wideH.lower.reason).toMatch(/H-HPBW 150\.0° is outside 50–130°/);
  });

  it('never prints a rejected beamwidth as the limit it is outside of', () => {
    // 25.04° rounds to "25.0": the message must not read "25.0° is outside 0.5–25°".
    const justWideV = angularRegionEfficiency(h65, gridFrom(quadBeam(25.04, 6, 30)), 60, 'summation');
    expect(justWideV.sector.value).toBeNull();
    const [, shown] = /V-HPBW ([\d.]+)° is outside 0\.5–25°/.exec(justWideV.sector.reason!)!;
    expect(Number(shown)).toBeGreaterThan(25);
    expect(Number(shown)).toBeCloseTo(25.04, 1);
    expect(shown).toMatch(/^25\.0\d*[1-9]$/);
    const justWideH = angularRegionEfficiency(gridFrom(quadBeam(130.03, 0, 30)), v8, 60, 'summation');
    const [, shownH] = /H-HPBW ([\d.]+)° is outside 50–130°/.exec(justWideH.sector.reason!)!;
    expect(Number(shownH)).toBeGreaterThan(130);
    const justNarrowH = angularRegionEfficiency(gridFrom(quadBeam(49.97, 0, 30)), v8, 60, 'summation');
    const [, shownN] = /H-HPBW ([\d.]+)° is outside 50–130°/.exec(justNarrowH.sector.reason!)!;
    expect(Number(shownN)).toBeLessThan(50);
    // A value clearly outside keeps its one decimal.
    expect(angularRegionEfficiency(h65, gridFrom(quadBeam(30, 6, 30)), 60, 'summation').sector.reason).toContain('V-HPBW 30.0° is outside');
  });

  it('accepts the ends of the Type A ranges', () => {
    expect(angularRegionEfficiency(gridFrom(quadBeam(130, 0, 30)), gridFrom(quadBeam(25, 6, 30)), 60, 'summation').sector.value).not.toBeNull();
    expect(angularRegionEfficiency(gridFrom(quadBeam(50, 0, 30)), v8, 60, 'summation').sector.value).not.toBeNull();
  });

  it('gives no number when a beamwidth is not defined', () => {
    const r = angularRegionEfficiency(isotropic, v8, 60, 'summation');
    expect(r.sector.value).toBeNull();
    expect(r.sector.reason).toMatch(/H-HPBW/);
    expect(angularRegionEfficiency(h65, isotropic, 60, 'summation').spatial.reason).toMatch(/V-HPBW/);
  });

  it('gives no number when the elevation peak is behind the antenna', () => {
    const back = gridFrom(quadBeam(8, 170, 30));
    const r = angularRegionEfficiency(h65, back, 60, 'summation');
    expect(r.sector.value).toBeNull();
    expect(r.sector.reason).toMatch(/peak/i);
  });
});
