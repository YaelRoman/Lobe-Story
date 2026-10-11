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

/** As vBeamWithLobes but both first sidelobes 15° from the peak (beyond 1.78 × 8°): merged rule applies. */
export const vFarLobes: AngleFn = (a) =>
  pwl([
    [-180, 30],
    [-20, 25],
    [-15, 18],
    [-9, 30],
    [-8, 12],
    [-4, 3],
    [0, 0],
    [4, 3],
    [8, 12],
    [10, 22],
    [15, 15],
    [180, 30],
  ])(a - 6);

/** As vBeamWithLobes plus a 10 dB lobe 30° above the peak (outside the peak-to-20° window). */
export const vHighFarLobe: AngleFn = (a) =>
  pwl([
    [-180, 30],
    [-40, 30],
    [-30, 10],
    [-24, 28],
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

/** 20° beam with a 1 dB dip on top (two equal maxima at ±4°) and no sidelobes. */
export const rippleTop: AngleFn = pwl([
  [-180, 30],
  [-30, 30],
  [-10, 3],
  [-4, 0],
  [0, 1],
  [4, 0],
  [10, 3],
  [30, 30],
  [180, 30],
]);

/** 20° azimuth beam: nulls at +25° (25 dB) and −30° (28 dB), sidelobes at +35° (12 dB) and −40° (14 dB). */
export const hBeamWithLobes: AngleFn = pwl([
  [-180, 30],
  [-50, 30],
  [-40, 14],
  [-30, 28],
  [-10, 3],
  [0, 0],
  [10, 3],
  [25, 25],
  [35, 12],
  [45, 30],
  [180, 30],
]);
