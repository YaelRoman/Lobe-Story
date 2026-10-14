import type { MetricResult } from '../types';
import { at, peakIndex, refinedPeak, signed, type Grid } from './grid';
import { settingText } from '../fixed';

export interface BeamResult {
  hpbw: MetricResult;
  direction: MetricResult;
  edges: [number, number] | null;
  peakAngle: number;
}

export function beamwidth(g: Grid, levelDb = 3): BeamResult {
  const p = peakIndex(g);
  const walk = (dir: 1 | -1): number | null => {
    for (let k = 1; k <= 180; k++) {
      const a0 = at(g, p + dir * (k - 1));
      const a1 = at(g, p + dir * k);
      if (a1 >= levelDb) return k - 1 + (levelDb - a0) / (a1 - a0);
    }
    return null;
  };
  const left = walk(-1);
  const right = walk(1);
  const peakAngle = refinedPeak(g);
  if (left === null || right === null) {
    const side = left === null ? 'negative' : 'positive';
    const reason = `Pattern never drops ${settingText(levelDb)} dB on the ${side}-angle side`;
    return { hpbw: { value: null, reason }, direction: { value: null, reason }, edges: null, peakAngle };
  }
  const lo = p - left;
  const hi = p + right;
  return {
    hpbw: { value: left + right },
    direction: { value: signed((lo + hi) / 2) },
    edges: [signed(lo), signed(hi)],
    peakAngle,
  };
}
