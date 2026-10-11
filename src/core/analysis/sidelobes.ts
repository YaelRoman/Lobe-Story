import type { MetricResult } from '../types';
import { beamwidth } from './beamwidth';
import { at, attAt, peakIndex, signed, type Grid } from './grid';

/** × V-HPBW: where a distinct first sidelobe peak must lie (BASTA 12.5.1 / 12.5.2). */
export const FIRST_LOBE_RANGE = 1.78;
/** × V-HPBW: position of a merged first sidelobe. */
export const MERGED_LOBE_AT = 1.55;
/** BASTA 12.5.3 substitute; used by band statistics, not per file. */
export const SLS_NOT_AVAILABLE_DB = 22;

export type LobeKind = 'peak' | 'merged';
export type LobeResult = MetricResult & { kind?: LobeKind };
export type WindowResult = MetricResult & { notAvailable?: true };

export interface FirstLobe {
  /** First sidelobe: suppression (dB below the peak) and its angle. */
  lobe: LobeResult;
  /** The null before it; for a merged lobe identical to `lobe`. */
  fill: LobeResult;
  /** Offset from the peak (degrees ≥ 0) where the sidelobe region begins; null when undefined. */
  startDeg: number | null;
}

export interface ElevationSidelobes {
  firstUsls: LobeResult;
  usls: WindowResult;
  uslsHorizon: WindowResult;
  uslsMax: WindowResult;
  nullFill: LobeResult;
  firstLsls: LobeResult;
}

/**
 * Walks away from the peak on one side. `kNull` is the first relative minimum of level at or
 * beyond the half-power point, `kLobe` the first relative maximum after it (strict comparisons
 * between neighbouring 1° samples). Offsets are integer degrees from the peak.
 */
function scan(g: Grid, dir: 1 | -1, maxK: number): { kNull?: number; kLobe?: number } {
  const p = peakIndex(g);
  const L = (k: number): number => at(g, p + dir * k);
  let k0 = 1;
  while (k0 < 360 && L(k0) < 3) k0++;
  if (L(k0) < 3) return {};
  let kNull: number | undefined;
  for (let k = k0; k <= maxK; k++) {
    if (L(k + 1) < L(k)) {
      kNull = k;
      break;
    }
  }
  if (kNull === undefined) return {};
  for (let k = kNull + 1; k <= maxK; k++) {
    if (L(k + 1) > L(k)) return { kNull, kLobe: k };
  }
  return { kNull };
}

const undefinedResult = (reason: string): FirstLobe => ({
  lobe: { value: null, reason },
  fill: { value: null, reason },
  startDeg: null,
});

/** First sidelobe on the upper (above the beam) or lower side: BASTA 12.5.1 / 12.5.2. */
export function firstLobe(v: Grid, side: 'upper' | 'lower'): FirstLobe {
  const hp = beamwidth(v, 3).hpbw.value;
  if (hp === null) return undefinedResult('HPBW undefined');
  if (FIRST_LOBE_RANGE * hp > 90) return undefinedResult('V-HPBW is too wide for the first-sidelobe rule');
  const dir = side === 'upper' ? -1 : 1;
  const p = peakIndex(v);
  const { kNull, kLobe } = scan(v, dir, Math.floor(FIRST_LOBE_RANGE * hp));
  if (kLobe !== undefined && kNull !== undefined) {
    return {
      lobe: { value: at(v, p + dir * kLobe), angle: signed(p + dir * kLobe), kind: 'peak' },
      fill: { value: at(v, p + dir * kNull), angle: signed(p + dir * kNull), kind: 'peak' },
      startDeg: kNull,
    };
  }
  const d = MERGED_LOBE_AT * hp;
  const merged: LobeResult = {
    value: attAt(v, p + dir * d),
    angle: signed(p + dir * d),
    kind: 'merged',
    reason: `Merged with the main beam: level at 1.55 × V-HPBW ${side === 'upper' ? 'above' : 'below'} the peak`,
  };
  return { lobe: merged, fill: { ...merged }, startDeg: d };
}

/**
 * Highest upper sidelobe level in the elevation window [loDeg, hiDeg] (BASTA 12.5.3), limited to
 * the sidelobe region: angles at least `startDeg` above the peak.
 */
export function upperWindow(v: Grid, startDeg: number, loDeg: number, hiDeg: number): WindowResult {
  const aS = signed(peakIndex(v)) - startDeg;
  const lo = Math.max(loDeg, -90);
  let best: number | null = null;
  let angle = 0;
  const consider = (a: number): void => {
    const val = attAt(v, a);
    if (best === null || val < best) {
      best = val;
      angle = a;
    }
  };
  // The fractional region limit is the highest candidate, so it is considered first.
  if (!Number.isInteger(aS) && aS >= lo && aS <= hiDeg) consider(aS);
  for (let a = Math.min(Math.floor(hiDeg), Math.floor(aS)); a >= Math.ceil(lo); a--) consider(a);
  if (best === null) {
    return { value: null, notAvailable: true, reason: 'Not available: only the main beam lies in this window' };
  }
  return { value: best, angle: signed(angle) };
}

/** Elevation sidelobe family for the V cut: BASTA 7.8.3, 7.8.4.2 – 7.8.4.5 with 12.5. */
export function elevationSidelobes(v: Grid, rangeDeg = 20): ElevationSidelobes {
  const up = firstLobe(v, 'upper');
  const down = firstLobe(v, 'lower');
  const base = { firstUsls: up.lobe, nullFill: down.fill, firstLsls: down.lobe };
  if (up.startDeg === null) {
    const none: WindowResult = { value: null, reason: up.lobe.reason };
    return { ...base, usls: none, uslsHorizon: { ...none }, uslsMax: { ...none } };
  }
  const P = signed(peakIndex(v));
  return {
    ...base,
    usls: upperWindow(v, up.startDeg, P - rangeDeg, P),
    uslsHorizon: upperWindow(v, up.startDeg, -rangeDeg, 0),
    uslsMax: upperWindow(v, up.startDeg, -90, P),
  };
}

/** Maximum sidelobe suppression inside ±edgeDeg of the azimuth cut: beyond the first null each side. */
export function horizontalSls(h: Grid, edgeDeg = 60): MetricResult {
  if (beamwidth(h, 3).hpbw.value === null) return { value: null, reason: 'HPBW undefined' };
  const P = signed(peakIndex(h));
  const kRight = scan(h, 1, 180).kNull;
  const kLeft = scan(h, -1, 180).kNull;
  let best: MetricResult = { value: null, reason: `No sidelobe inside the ±${edgeDeg}° sector` };
  for (let a = Math.ceil(-edgeDeg); a <= Math.floor(edgeDeg); a++) {
    const o = signed(a - P);
    if (!((kRight !== undefined && o >= kRight) || (kLeft !== undefined && -o >= kLeft))) continue;
    const val = at(h, a);
    if (best.value === null || val < best.value) best = { value: val, angle: a };
  }
  return best;
}
