import type { MetricResult } from '../types';
import type { BeamResult } from './beamwidth';
import { at, peakIndex, signed, type Grid } from './grid';

/** First local maximum of attenuation walking from `start` in `dir`, or null within `limit` steps. */
function findNull(g: Grid, start: number, dir: 1 | -1, limit: number): number | null {
  for (let k = 0; k < limit; k++) {
    const i = start + dir * k;
    if (at(g, i + dir) < at(g, i)) return i;
  }
  return null;
}

export function usls(v: Grid, beam: BeamResult, rangeDeg = 20): MetricResult {
  if (!beam.edges) return { value: null, reason: 'HPBW undefined' };
  const peak = signed(peakIndex(v));
  const nullAt = findNull(v, Math.floor(beam.edges[0]), -1, 180);
  if (nullAt === null) return { value: null, reason: 'No null found above the main beam' };
  const end = peak - rangeDeg;
  if (nullAt <= end) {
    return { value: null, reason: `First upper null is more than ${rangeDeg}° above the peak` };
  }
  let best = Infinity;
  let angle = nullAt;
  for (let i = nullAt; i >= end; i--) {
    const val = at(v, i);
    if (val < best) {
      best = val;
      angle = i;
    }
  }
  return { value: best, angle: signed(angle) };
}

export function firstNullFill(v: Grid, beam: BeamResult, searchDeg = 90): MetricResult {
  if (!beam.edges) return { value: null, reason: 'HPBW undefined' };
  const nullAt = findNull(v, Math.ceil(beam.edges[1]), 1, searchDeg);
  if (nullAt === null) {
    return { value: null, reason: `No null found below the main beam within ${searchDeg}°` };
  }
  return { value: at(v, nullAt), angle: signed(nullAt) };
}
