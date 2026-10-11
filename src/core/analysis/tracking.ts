import type { MetricResult } from '../types';
import { attAt, type Grid } from './grid';

/** Worst port-to-port difference within ±windowDeg; `gainDeltaDb` = gain(a) − gain(b) in dB (0 compares shapes only). */
export function beamTracking(a: Grid, b: Grid, windowDeg = 60, gainDeltaDb = 0): MetricResult {
  const diffAt = (d: number) => Math.abs(gainDeltaDb - (attAt(a, d) - attAt(b, d)));
  let worst = 0;
  let angle = 0;
  const consider = (d: number) => {
    const diff = diffAt(d);
    if (diff > worst) {
      worst = diff;
      angle = d;
    }
  };
  for (let d = -Math.floor(windowDeg); d <= Math.floor(windowDeg); d++) consider(d);
  // A fractional window edge is part of the window, so the sector-edge statistic can never exceed this maximum.
  if (!Number.isInteger(windowDeg)) {
    consider(-windowDeg);
    consider(windowDeg);
  }
  return { value: worst, angle };
}

/** Port-to-port level difference at the two sector edges [−edgeDeg, +edgeDeg] (BASTA 12.4.5). */
export function edgeTracking(a: Grid, b: Grid, edgeDeg = 60, gainDeltaDb = 0): [number, number] {
  const diffAt = (d: number) => Math.abs(gainDeltaDb - (attAt(a, d) - attAt(b, d)));
  return [diffAt(-edgeDeg), diffAt(edgeDeg)];
}
