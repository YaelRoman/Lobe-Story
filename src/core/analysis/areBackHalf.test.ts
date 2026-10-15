import { describe, expect, it } from 'vitest';
import { exampleFiles } from '../exampleSet';
import { parsePlanet } from '../parse/planet';
import { analyzeAll, angularRegionsOfCuts, DEFAULT_SETTINGS, gridsFor, type TaggedPattern } from './metrics';
import { angularRegionEfficiency } from './are';
import { analyzeTilted, tiltEach, tiltedAngularRegions, tiltPattern } from './tilt';
import { backHalfAtt, backHalfModelOf } from './backHalf3d';
import { interp } from './grid';
import type { Pattern } from '../types';

/** Integrates the reconstruction over the sphere several times: about 1 s alone, longer when the whole suite runs in parallel. */
const HEAVY_TEST_MS = 30_000;
const RAD = Math.PI / 180;

const example = (index: number): Pattern => {
  const f = exampleFiles()[index];
  const r = parsePlanet(f.text, f.name);
  if (!r.ok) throw new Error(r.error);
  return r.pattern;
};

const value = (x: { value: number | null }): number => {
  if (x.value === null) throw new Error('no value');
  return x.value;
};

describe('angular regions with the back of the vertical cut', () => {
  const p = example(0);
  const g = gridsFor(p);

  for (const method of ['summation', 'weighted'] as const) {
    it(
      `${method}: the 1° sum agrees with a fine integration of the same model`,
      () => {
        const e = angularRegionEfficiency(g.h, g.v, 60, method, true);
        const regions = e.regions!;
        const m = backHalfModelOf(g.h, g.v, method);
        const f = (az: number, el: number) =>
          10 ** (-backHalfAtt(m, az, el, interp(g.h, az), interp(g.v, el), interp(g.v, 180 - el)) / 10);
        // Midpoint rule, 0.25° × 0.5° cells.
        const box = (el0: number, el1: number, az0: number, az1: number): number => {
          let sum = 0;
          for (let el = el0 + 0.125; el < el1; el += 0.25) for (let az = az0 + 0.25; az < az1; az += 0.5) sum += f(az, el) * Math.cos(el * RAD);
          return sum;
        };
        const total = box(-90, 90, -180, 180);
        const service = box(regions.serviceStartDeg, 75, -60, 60);
        const lower = box(75, 90, -180, 180);
        expect(value(e.sector)).toBeCloseTo((100 * service) / total, 0);
        expect(Math.abs(value(e.lower) - (100 * lower) / total)).toBeLessThan(0.01);
      },
      HEAVY_TEST_MS,
    );

    it(
      `${method}: a mechanical tilt of almost nothing gives the untilted values (the rotated path samples the same model)`,
      () => {
        const t = { electricalDeg: 0, mechanicalDeg: 1e-7 };
        const tilted = tiltPattern(p, t, method, 'beam', true);
        const rotated = tiltedAngularRegions(p, t, gridsFor(tilted), 60, method, true);
        const flat = angularRegionEfficiency(g.h, g.v, 60, method, true);
        expect(value(rotated.sector)).toBeCloseTo(value(flat.sector), 3);
        expect(value(rotated.spatial)).toBeCloseTo(value(flat.spatial), 3);
        expect(value(rotated.lower)).toBeCloseTo(value(flat.lower), 4);
      },
      HEAVY_TEST_MS,
    );
  }

  it(
    'summation: the poles no longer lose the azimuth cut, so the lower region gets more power; the existing values do not move',
    () => {
      const off = angularRegionEfficiency(g.h, g.v, 60, 'summation');
      const on = angularRegionEfficiency(g.h, g.v, 60, 'summation', true);
      expect(value(on.lower)).toBeGreaterThan(value(off.lower));
      expect(angularRegionEfficiency(g.h, g.v, 60, 'summation', false)).toEqual(off);
    },
    HEAVY_TEST_MS,
  );

  it(
    'the per-pattern memo keeps the two reconstructions apart',
    () => {
      const tagged: TaggedPattern[] = [0, 1, 2].map((i) => ({ pattern: example(i), tags: {} }));
      const off1 = analyzeAll(tagged, DEFAULT_SETTINGS, { areMethod: 'summation' });
      const on = analyzeAll(tagged, DEFAULT_SETTINGS, { areMethod: 'summation', areBackHalf: true });
      const off2 = analyzeAll(tagged, DEFAULT_SETTINGS, { areMethod: 'summation' });
      for (const i of tagged) {
        const id = i.pattern.id;
        expect(off2.get(id)!.are).toEqual(off1.get(id)!.are);
        expect(on.get(id)!.are.lower.value).not.toBe(off1.get(id)!.are.lower.value);
      }
      expect(angularRegionsOfCuts(tagged[0].pattern, 60, 'summation', true)).toEqual(on.get(tagged[0].pattern.id)!.are);
    },
    HEAVY_TEST_MS,
  );

  it(
    'under every kind of tilt and both horizontal cuts the estimate is a number, and it is the back-half model that answers',
    () => {
      const tagged: TaggedPattern[] = [{ pattern: p, tags: {} }];
      for (const t of [
        { electricalDeg: 3, mechanicalDeg: 0 },
        { electricalDeg: 0, mechanicalDeg: 6 },
        { electricalDeg: 2, mechanicalDeg: 4 },
      ])
        for (const hCut of ['beam', 'horizon'] as const)
          for (const method of ['summation', 'weighted'] as const) {
            const on = analyzeTilted(tiltEach(tagged, () => t, method, hCut, true), DEFAULT_SETTINGS, () => t, method, true).get(p.id)!.are;
            const off = analyzeTilted(tiltEach(tagged, () => t, method, hCut), DEFAULT_SETTINGS, () => t, method).get(p.id)!.are;
            for (const k of ['sector', 'spatial', 'lower'] as const) {
              expect(Number.isFinite(value(on[k]))).toBe(true);
              expect(on[k].value).not.toBe(off[k].value);
            }
          }
    },
    HEAVY_TEST_MS,
  );
});
