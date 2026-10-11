import type { MetricResult } from '../types';
import { at, signed, type Grid } from './grid';

export function frontToBack(h: Grid, windowDeg = 30): { fb180: MetricResult; fbWindow: MetricResult } {
  let worst = Infinity;
  let angle = 180;
  for (let d = -windowDeg; d <= windowDeg; d++) {
    const v = at(h, 180 + d);
    if (v < worst) {
      worst = v;
      angle = signed(180 + d);
    }
  }
  return { fb180: { value: h[180], angle: 180 }, fbWindow: { value: worst, angle } };
}
