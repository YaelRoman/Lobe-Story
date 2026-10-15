import { describe, expect, it } from 'vitest';
import { exampleFiles } from '../exampleSet';
import { parsePlanet } from '../parse/planet';
import { combine, reconstruct3d, STEP_3D, type Method3d, type Surface3d } from './pattern3d';
import { gridsFor } from './metrics';
import { baseGrids, coneInAntenna, electricalShift, interp, isTilted, reconstructTilted3d, rotateToAntenna, tiltPattern, type TiltSettings } from './tilt';
import type { Grid } from './grid';
import type { Pattern } from '../types';

/**
 * With "Use the back of the vertical cut" off (the default) every number is the one the app gave before the option
 * existed. These are the earlier code paths, copied as they were, compared value for value (Object.is) with today's.
 */

function legacyReconstructTilted3d(h: Grid, v: Grid, t: TiltSettings, azimuthDeg: number, method: Method3d, step = STEP_3D): Surface3d {
  const base = reconstruct3d(h, v, method, step);
  if (!isTilted(t) && azimuthDeg === 0) return base;
  const ve = t.electricalDeg === 0 ? v : electricalShift(v, t.electricalDeg);
  const atten = base.el.map((e) =>
    base.az.map((a) => {
      const r = rotateToAntenna(a - azimuthDeg, e, t.mechanicalDeg);
      return combine(interp(h, r.phi), interp(ve, r.theta), method);
    }),
  );
  return { az: base.az, el: base.el, atten };
}

function legacyTiltedH(p: Pattern, t: TiltSettings, method: Method3d, hCut: 'beam' | 'horizon'): number[] {
  const { hN, vN, hOff, peakTheta } = baseGrids(p);
  const dirs = coneInAntenna(hCut === 'horizon' ? 0 : peakTheta + t.electricalDeg + t.mechanicalDeg, t.mechanicalDeg);
  return dirs.map((d) => hOff + combine(interp(hN, d.phi), interp(vN, d.theta - t.electricalDeg), method));
}

const patterns = exampleFiles()
  .slice(0, 6)
  .map((f) => {
    const r = parsePlanet(f.text, f.name);
    if (!r.ok) throw new Error(r.error);
    return r.pattern;
  });

const TILTS: TiltSettings[] = [
  { electricalDeg: 0, mechanicalDeg: 0 },
  { electricalDeg: 2.5, mechanicalDeg: 0 },
  { electricalDeg: 0, mechanicalDeg: 6 },
  { electricalDeg: -3, mechanicalDeg: 4 },
];

describe('with the back of the vertical cut off, nothing changes', () => {
  for (const method of ['summation', 'weighted'] as const) {
    it(`${method}: the 3D view's surfaces are the earlier ones`, () => {
      for (const p of patterns) {
        const g = gridsFor(p);
        for (const t of TILTS)
          for (const az of [0, 25]) {
            const legacy = legacyReconstructTilted3d(g.h, g.v, t, az, method);
            expect(reconstructTilted3d(g.h, g.v, t, az, method)).toEqual(legacy);
            expect(reconstructTilted3d(g.h, g.v, t, az, method, STEP_3D, false)).toEqual(legacy);
          }
      }
    });

    it(`${method}: the simulated horizontal cuts are the earlier ones`, () => {
      for (const p of patterns)
        for (const t of TILTS)
          for (const hCut of ['beam', 'horizon'] as const) {
            if (!isTilted(t) && hCut === 'beam') continue;
            const legacy = legacyTiltedH(p, t, method, hCut);
            const now = tiltPattern(p, t, method, hCut).horizontal.atten;
            now.forEach((x, i) => expect(Object.is(x, legacy[i])).toBe(true));
            expect(tiltPattern(p, t, method, hCut, false)).toBe(tiltPattern(p, t, method, hCut));
          }
    });
  }
});
