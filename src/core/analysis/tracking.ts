import type { MetricResult } from '../types';
import { at, type Grid } from './grid';

/** Worst port-to-port difference within ±windowDeg; `gainDeltaDb` = gain(a) − gain(b) in dB (0 compares shapes only). */
export function beamTracking(a: Grid, b: Grid, windowDeg = 60, gainDeltaDb = 0): MetricResult {
  let worst = 0;
  let angle = 0;
  for (let d = -windowDeg; d <= windowDeg; d++) {
    const diff = Math.abs(gainDeltaDb - (at(a, d) - at(b, d)));
    if (diff > worst) {
      worst = diff;
      angle = d;
    }
  }
  return { value: worst, angle };
}
