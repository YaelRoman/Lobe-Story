import type { Cut, Pattern } from '../core/types';
import { signed, toGrid, type Grid } from '../core/analysis/grid';

export type AngleFn = (signedAngle: number) => number;

export function cutFrom(fn: AngleFn): Cut {
  const angles = Array.from({ length: 360 }, (_, i) => i);
  return { angles, atten: angles.map((a) => fn(signed(a))) };
}

export function gridFrom(fn: AngleFn): Grid {
  return toGrid(cutFrom(fn));
}

export function patternFrom(hFn: AngleFn, vFn: AngleFn, over: Partial<Pattern> = {}): Pattern {
  return {
    id: 'syn',
    fileName: 'syn.MSI',
    frequencyMHz: 1800,
    declared: {},
    horizontal: cutFrom(hFn),
    vertical: cutFrom(vFn),
    extraHeaders: {},
    ...over,
  };
}

/** Parabolic main beam: exactly 3 dB down at ±hpbw/2 from `steer`, capped at `cap`. */
export const quadBeam =
  (hpbw: number, steer = 0, cap = 40): AngleFn =>
  (a) =>
    Math.min(3 * ((a - steer) / (hpbw / 2)) ** 2, cap);

/** Piecewise-linear function through ascending [x, y] points; constant outside. */
export function pwl(pts: [number, number][]): (x: number) => number {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let k = 0; k < pts.length - 1; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[k + 1];
      if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return pts[pts.length - 1][1];
  };
}

/**
 * V cut with peak at +6° (downtilt), HPBW 8° (edges 2° and 10°),
 * upper null at −3° (30 dB), upper sidelobe at −8° (18 dB),
 * lower null at 16° (22 dB), lower sidelobe at 19° (15 dB).
 */
export const vBeamWithLobes: AngleFn = (a) =>
  pwl([
    [-180, 30],
    [-20, 25],
    [-14, 18],
    [-9, 30],
    [-8, 12],
    [-4, 3],
    [0, 0],
    [4, 3],
    [8, 12],
    [10, 22],
    [13, 15],
    [180, 30],
  ])(a - 6);
