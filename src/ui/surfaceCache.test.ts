import { describe, expect, it } from 'vitest';
import { surfaceFor, surfacesComputed } from './surfaceCache';
import { gridsFor } from '../core/analysis/metrics';
import { reconstructTilted3d } from '../core/analysis/tilt';
import { patternFrom, quadBeam } from '../test/synthetic';

const flat = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
const tilted = { electricalDeg: 2, mechanicalDeg: 3, azimuthDeg: 10 };

describe('surfaceFor', () => {
  it('is the reconstruction of the file at its tilt and azimuth with the method asked', () => {
    const p = patternFrom(quadBeam(65), quadBeam(10));
    const g = gridsFor(p);
    for (const method of ['summation', 'weighted'] as const) {
      expect(surfaceFor(p, tilted, method)).toEqual(reconstructTilted3d(g.h, g.v, tilted, 10, method));
    }
  });

  it('computes each method once per tilt: asking again, or for the other method, reuses what was computed', () => {
    const p = patternFrom(quadBeam(60), quadBeam(12));
    const start = surfacesComputed();
    const sum = surfaceFor(p, flat, 'summation');
    const wtd = surfaceFor(p, flat, 'weighted');
    expect(surfacesComputed() - start).toBe(2);
    // The same values in another object (the held slider's release gives a new one) are the same input.
    expect(surfaceFor(p, { ...flat }, 'summation')).toBe(sum);
    expect(surfaceFor(p, flat, 'weighted')).toBe(wtd);
    expect(surfacesComputed() - start).toBe(2);
    // A new tilt is a new input: computed again, for that method only.
    expect(surfaceFor(p, tilted, 'summation')).not.toBe(sum);
    expect(surfacesComputed() - start).toBe(3);
    expect(surfaceFor(p, tilted, 'weighted')).not.toBe(wtd);
    expect(surfacesComputed() - start).toBe(4);
  });

  it('keeps files apart', () => {
    const a = patternFrom(quadBeam(65), quadBeam(10), { id: 'a' });
    const b = patternFrom(quadBeam(30), quadBeam(10), { id: 'b' });
    expect(surfaceFor(a, flat, 'summation')).not.toEqual(surfaceFor(b, flat, 'summation'));
  });
});
