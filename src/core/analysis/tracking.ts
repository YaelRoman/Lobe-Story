import type { MetricResult } from '../types';
import { at, type Grid } from './grid';

export function beamTracking(a: Grid, b: Grid, windowDeg = 60): MetricResult {
  let worst = 0;
  let angle = 0;
  for (let d = -windowDeg; d <= windowDeg; d++) {
    const diff = Math.abs(at(a, d) - at(b, d));
    if (diff > worst) {
      worst = diff;
      angle = d;
    }
  }
  return { value: worst, angle };
}
