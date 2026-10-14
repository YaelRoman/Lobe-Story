import type { MetricResult } from '../types';
import { beamwidth } from './beamwidth';
import { at, attAt, peakCentre, peakIndex, signed, type Grid } from './grid';
import { settingText } from '../fixed';

/** × V-HPBW: where a distinct first sidelobe peak must lie (BASTA 12.5.1 / 12.5.2). */
export const FIRST_LOBE_RANGE = 1.78;
/** Minimum depth (dB) of a null relative to the lobe after it for the pair to count; smaller wiggles are ripples. */
export const MIN_PROMINENCE_DB = 0.5;
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
 * Walks away from the peak sample on one side. `kNull` is the first relative minimum of level at or
 * beyond the half-power point whose following relative maximum (`kLobe`) is at least
 * `MIN_PROMINENCE_DB` higher in level; shallower pairs are ripples and are skipped. A null with no
 * lobe after it before `maxK` is returned alone. Offsets are integer degrees from the peak sample.
 */
function scan(g: Grid, dir: 1 | -1, maxK: number): { kNull?: number; kLobe?: number } {
  const p = peakIndex(g);
  const L = (k: number): number => at(g, p + dir * k);
  let k0 = 1;
  while (k0 < 360 && L(k0) < 3) k0++;
  if (L(k0) < 3) return {};
  let k = k0;
  while (k <= maxK) {
    let kNull = k;
    while (kNull <= maxK && !(L(kNull + 1) < L(kNull))) kNull++;
    if (kNull > maxK) return {};
    let kLobe = kNull + 1;
    while (kLobe <= maxK && !(L(kLobe + 1) > L(kLobe))) kLobe++;
    if (kLobe > maxK) return { kNull };
    if (L(kNull) - L(kLobe) >= MIN_PROMINENCE_DB) return { kNull, kLobe };
    k = kLobe + 1;
  }
  return {};
}

const undefinedResult = (reason: string): FirstLobe => ({
  lobe: { value: null, reason },
  fill: { value: null, reason },
  startDeg: null,
});

/**
 * First sidelobe on the upper (above the beam) or lower side: BASTA 12.5.1 / 12.5.2. Distances are
 * measured from the peak direction (`peakCentre`); `lobeLimitFactor` × V-HPBW is how far a distinct
 * lobe may lie. Above the default factor the search is capped at 90° instead of giving up.
 */
export function firstLobe(v: Grid, side: 'upper' | 'lower', lobeLimitFactor = FIRST_LOBE_RANGE): FirstLobe {
  const hp = beamwidth(v, 3).hpbw.value;
  if (hp === null) return undefinedResult('HPBW undefined');
  const tooWide = undefinedResult('V-HPBW is too wide for the first-sidelobe rule');
  let limit = lobeLimitFactor * hp;
  if (limit > 90) {
    if (lobeLimitFactor <= FIRST_LOBE_RANGE || MERGED_LOBE_AT * hp > 90) return tooWide;
    limit = 90;
  }
  const dir = side === 'upper' ? -1 : 1;
  const p = peakIndex(v);
  const centre = peakCentre(v);
  const off = signed(centre - p); // the peak direction lies `off` degrees beyond the peak sample
  const { kNull, kLobe } = scan(v, dir, Math.floor(limit + dir * off));
  if (kLobe !== undefined && kNull !== undefined) {
    return {
      lobe: { value: at(v, p + dir * kLobe), angle: signed(p + dir * kLobe), kind: 'peak' },
      fill: { value: at(v, p + dir * kNull), angle: signed(p + dir * kNull), kind: 'peak' },
      startDeg: kNull - dir * off,
    };
  }
  const d = MERGED_LOBE_AT * hp;
  const merged: LobeResult = {
    value: attAt(v, centre + dir * d),
    angle: signed(centre + dir * d),
    kind: 'merged',
    reason: `Merged with the main beam: level at ${MERGED_LOBE_AT} × V-HPBW ${side === 'upper' ? 'above' : 'below'} the peak`,
  };
  return { lobe: merged, fill: { ...merged }, startDeg: d };
}

/**
 * Highest upper sidelobe level in the elevation window [loDeg, hiDeg] (BASTA 12.5.3), limited to
 * the sidelobe region: angles at least `startDeg` above the peak direction.
 */
export function upperWindow(v: Grid, startDeg: number, loDeg: number, hiDeg: number): WindowResult {
  const centre = peakCentre(v);
  const aS = Math.round((centre - startDeg) * 1e9) / 1e9; // snapped so an integer region start is recognised
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
    const reason =
      centre < loDeg
        ? 'Not available: the beam peak is above this window'
        : 'Not available: only the main beam lies in this window';
    return { value: null, notAvailable: true, reason };
  }
  return { value: best, angle: signed(angle) };
}

/** Elevation sidelobe family for the V cut: BASTA 7.8.3, 7.8.4.2 – 7.8.4.5 with 12.5. */
export function elevationSidelobes(v: Grid, rangeDeg = 20, lobeLimitFactor = FIRST_LOBE_RANGE): ElevationSidelobes {
  const up = firstLobe(v, 'upper', lobeLimitFactor);
  const down = firstLobe(v, 'lower', lobeLimitFactor);
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
  let best: MetricResult = { value: null, reason: `No sidelobe inside the ±${settingText(edgeDeg)}° sector` };
  for (let a = Math.ceil(-edgeDeg); a <= Math.floor(edgeDeg); a++) {
    const o = signed(a - P);
    if (!((kRight !== undefined && o >= kRight) || (kLeft !== undefined && -o >= kLeft))) continue;
    const val = at(h, a);
    if (best.value === null || val < best.value) best = { value: val, angle: a };
  }
  return best;
}
