import type { Pattern } from '../types';
import { analyzeAll, gridsFor, type AnalysisSettings, type PatternMetrics, type TaggedPattern } from './metrics';
import { mod360, peakCentre, peakIndex, rawGrid, signed, type Grid } from './grid';
import { combine, combineWeighted, reconstruct3d, STEP_3D, type Method3d, type Surface3d } from './pattern3d';
import { angularRegionEfficiency, DB_TO_NEPER, efficiencyOf, noAngularRegions, sampledRegionPowers, SPHERE_ROWS, typeABeam, type AngularRegionEfficiency } from './are';

export interface TiltSettings {
  /** Extra electrical downtilt added to the measured pattern (degrees, positive = down). */
  electricalDeg: number;
  /** Mechanical downtilt of the whole antenna (degrees, positive = down). */
  mechanicalDeg: number;
}

export const NO_TILT: TiltSettings = { electricalDeg: 0, mechanicalDeg: 0 };

export const isTilted = (t: TiltSettings): boolean => t.electricalDeg !== 0 || t.mechanicalDeg !== 0;

/**
 * Which horizontal cut a tilted file shows: `beam` is the ground-frame cone through the tilted beam peak, `horizon`
 * the ground-frame cut at elevation 0°. Both are read from the same rotated 3D reconstruction and keep the file's H
 * offset, so their levels are below the pattern's 3D peak.
 */
export type HCutMode = 'beam' | 'horizon';

/** Tilt plus azimuth (bearing) for one file. */
export interface SimSettings extends TiltSettings {
  azimuthDeg: number;
}

export const NO_SIM: SimSettings = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };

/** Global settings plus a file's offsets (the global object itself when the file has none). */
export function effectiveFor(global: SimSettings, offset?: SimSettings): SimSettings {
  if (!offset) return global;
  return {
    electricalDeg: global.electricalDeg + offset.electricalDeg,
    mechanicalDeg: global.mechanicalDeg + offset.mechanicalDeg,
    azimuthDeg: global.azimuthDeg + offset.azimuthDeg,
  };
}

/**
 * True when any of `ids` is tilted once its offset (if any) is combined with the global
 * settings — a cancelling offset (e.g. +3/-3) is correctly untilted, unlike comparing the
 * raw global and offset fields independently.
 */
export function anyTilted(ids: string[], global: SimSettings, offsets: Record<string, SimSettings>): boolean {
  return ids.some((id) => isTilted(effectiveFor(global, offsets[id])));
}

const DEG360 = Array.from({ length: 360 }, (_, i) => i);
const RAD = Math.PI / 180;

/** Linear interpolation of a 360-sample, 1°-step circle at a fractional angle (wraps). */
export function interp(g: number[], angle: number): number {
  const a = mod360(angle);
  const i0 = Math.floor(a);
  const f = a - i0;
  const v0 = g[i0 % 360];
  if (f === 0) return v0;
  return v0 + (g[(i0 + 1) % 360] - v0) * f;
}

/** out[t] = g(t − byDeg): the circle rotated forward by byDeg. */
export function shiftCircle(g: number[], byDeg: number): number[] {
  return DEG360.map((t) => interp(g, t - byDeg));
}

/** True for the back half of a V cut (91…269°); the front half is 270…359 ∪ 0…90. */
const isBackHalf = (t: number): boolean => t >= 91 && t <= 269;

/**
 * Electrical tilt of a V cut (cone model): the front half moves down by `deltaDeg`
 * (out[t] = g(t − Δe)) and the back half moves down too, towards 90° (out[t] = g(t + Δe)).
 */
export function electricalShift(g: number[], deltaDeg: number): number[] {
  return DEG360.map((t) => interp(g, isBackHalf(t) ? t + deltaDeg : t - deltaDeg));
}

/**
 * A world direction (azimuth φ, elevation θ positive below the horizon) expressed in the
 * frame of an antenna mechanically tilted down by `mechanicalDeg` (rotation about the y axis).
 */
export function rotateToAntenna(
  phiDeg: number,
  thetaDeg: number,
  mechanicalDeg: number,
): { phi: number; theta: number } {
  if (mechanicalDeg === 0) return { phi: phiDeg, theta: thetaDeg };
  const p = phiDeg * RAD;
  const t = thetaDeg * RAD;
  const m = mechanicalDeg * RAD;
  const x = Math.cos(t) * Math.cos(p);
  const y = -Math.cos(t) * Math.sin(p);
  const z = -Math.sin(t);
  const ax = x * Math.cos(m) - z * Math.sin(m);
  const az = x * Math.sin(m) + z * Math.cos(m);
  return {
    phi: Math.atan2(-y, ax) / RAD,
    theta: -Math.asin(Math.max(-1, Math.min(1, az))) / RAD,
  };
}

const normalise = (g: number[]): number[] => {
  const min = Math.min(...g);
  return g.map((v) => v - min);
};

function lookup(hN: number[], vN: number[], phi: number, theta: number, method: Method3d): number {
  return combine(interp(hN, phi), interp(vN, theta), method);
}

/**
 * Elevation (positive = below the horizon) at which the 3D reconstruction of a normalised V grid
 * has its 0 dB: the centre of a flat top, else the strongest sample. This is the cone the file's
 * H cut lies on. Always a front-hemisphere elevation: when the strongest sample lies in the back
 * half (|elevation| > 90°), the strongest sample within −90…90° is used instead. A peak refined between two unequal samples is not used, because the linearly
 * interpolated V grid is above 0 dB attenuation there and the cut would no longer reach the peak.
 */
export function beamPeakElevation(vN: number[]): number {
  if (Math.abs(signed(peakIndex(vN))) > 90) {
    let best = 0;
    for (let e = -90; e <= 90; e++) if (vN[mod360(e)] < vN[mod360(best)]) best = e;
    return best;
  }
  const centre = peakCentre(vN);
  return interp(vN, centre) <= 1e-9 ? centre : signed(peakIndex(vN));
}

/** A pattern's 1° grids: raw (offsets kept) and normalised, the H offset and the beam-peak elevation. */
export interface BaseGrids {
  H: number[];
  V: number[];
  hN: number[];
  vN: number[];
  /** Minimum of the raw H cut (the file's own offset). */
  hOff: number;
  /** Elevation of the untilted beam peak, see `beamPeakElevation`. */
  peakTheta: number;
}

// Pattern objects are immutable and stable across renders, so their grids are cached per object.
const baseCache = new WeakMap<Pattern, BaseGrids>();

/** The cached grids of `p` (computed on first use; the same arrays on every later call). */
export function baseGrids(p: Pattern): BaseGrids {
  let g = baseCache.get(p);
  if (!g) {
    const H = rawGrid(p.horizontal);
    const V = rawGrid(p.vertical);
    const vN = normalise(V);
    g = { H, V, hN: normalise(H), vN, hOff: Math.min(...H), peakTheta: beamPeakElevation(vN) };
    baseCache.set(p, g);
  }
  return g;
}

type Direction = { phi: number; theta: number };

const CONE_CACHE_MAX = 64;
let coneCache: { mechanicalDeg: number; byTheta: Map<number, Direction[]> } | null = null;

/**
 * The 360 directions of the ground-frame cone at elevation `thetaDeg` (φ = 0…359°) in the frame
 * of an antenna tilted down by `mechanicalDeg`. Shared by every pattern with the same peak
 * elevation; cached for the last mechanical tilt (same array on repeat calls).
 */
export function coneInAntenna(thetaDeg: number, mechanicalDeg: number): Direction[] {
  if (coneCache?.mechanicalDeg !== mechanicalDeg) coneCache = { mechanicalDeg, byTheta: new Map() };
  let dirs = coneCache.byTheta.get(thetaDeg);
  if (!dirs) {
    if (coneCache.byTheta.size >= CONE_CACHE_MAX) coneCache.byTheta.clear();
    dirs = DEG360.map((phi) => rotateToAntenna(phi, thetaDeg, mechanicalDeg));
    coneCache.byTheta.set(thetaDeg, dirs);
  }
  return dirs;
}

// The last tilted copy per pattern and horizontal-cut mode, so unchanged files keep their object when another file's
// tilt changes (and the angular-region estimate of a horizon-cut copy can ask for the beam-peak copy without evicting it).
const tiltedCache = new WeakMap<Pattern, Partial<Record<HCutMode, { key: string; result: Pattern }>>>();

// What each tilted copy was made from: the cuts of a mechanically tilted copy do not describe its whole pattern.
const tiltedFrom = new WeakMap<Pattern, { source: Pattern; tilt: TiltSettings; method: Method3d; hCut: HCutMode }>();

/**
 * A copy of the pattern with tilted 1° cuts (raw values, offsets kept).
 * V: electrical tilt as a cone (front and back move down by Δe), then rotated exactly by m.
 * H, `hCut` = 'beam' (the default): the azimuth cut through the tilted beam peak — the ground-frame cone at
 * elevation θpeak + Δe + m — read from the 3D reconstruction of the file's H cut and the electrically
 * tilted V cut. It keeps the file's H offset and is never stronger than the file's H peak;
 * electrical tilt alone leaves it unchanged, mechanical tilt distorts it.
 * H, `hCut` = 'horizon': the ground-frame cut at elevation 0° of the same rotated reconstruction, with the same
 * offset (so its values are levels below the 3D peak). Its maximum lies below the file's H peak by what the V cut
 * has lost at the horizon; a file whose beam peak is at 0° gives its own H cut as the tilt goes to zero.
 * Without a tilt, `beam` returns `p` itself (the file's H cut is taken as the cut through its beam peak), and
 * `horizon` a copy with the file's own V cut (the same object) and the horizon cut of the untilted reconstruction:
 * the file's H cut exactly when the beam peak is at 0° elevation, lower for a file with built-in tilt.
 */
export function tiltPattern(p: Pattern, t: TiltSettings, method: Method3d, hCut: HCutMode = 'beam'): Pattern {
  const tilted = isTilted(t);
  if (!tilted && hCut === 'beam') return p;
  const key = `${method}|${t.electricalDeg}|${t.mechanicalDeg}`;
  let entry = tiltedCache.get(p);
  const hit = entry?.[hCut];
  if (hit && hit.key === key) return hit.result;
  const { V, hN, vN, hOff, peakTheta } = baseGrids(p);
  const ve = t.electricalDeg === 0 ? V : electricalShift(V, t.electricalDeg);
  // Antenna-frame elevations on the cone are in the front half of the V cut, where the electrical
  // tilt is a plain shift: Ve(θ) = V(θ − Δe). Reading V directly (not a pre-shifted 1° grid)
  // interpolates once, so a half-degree tilt still finds the exact peak sample.
  const dirs = coneInAntenna(hCut === 'horizon' ? 0 : peakTheta + t.electricalDeg + t.mechanicalDeg, t.mechanicalDeg);
  const hTilted = dirs.map((d) => hOff + lookup(hN, vN, d.phi, d.theta - t.electricalDeg, method));
  const result: Pattern = {
    ...p,
    horizontal: { angles: [...DEG360], atten: hTilted },
    // Nothing about the vertical cut changes without a tilt: the copy keeps the file's own.
    vertical: tilted ? { angles: [...DEG360], atten: shiftCircle(ve, t.mechanicalDeg) } : p.vertical,
  };
  if (!entry) tiltedCache.set(p, (entry = {}));
  entry[hCut] = { key, result };
  tiltedFrom.set(result, { source: p, tilt: { electricalDeg: t.electricalDeg, mechanicalDeg: t.mechanicalDeg }, method, hCut });
  return result;
}

/**
 * How far (dB, ≥ 0) the maximum of a horizon-cut copy's H cut lies below its pattern's 3D peak; undefined for any
 * other pattern (a file, or a copy cut through the beam peak, whose H cut is taken as reaching the peak).
 */
export function horizonCutPeakDb(pattern: Pattern): number | undefined {
  const origin = tiltedFrom.get(pattern);
  if (!origin || origin.hCut !== 'horizon') return undefined;
  return Math.min(...pattern.horizontal.atten) - baseGrids(origin.source).hOff;
}

/**
 * Tilt each item with its own settings. Through the beam peak: returns `items` itself when no item is tilted, and
 * untilted items keep their object. At the horizon every item gets a copy, tilted or not (see `tiltPattern`).
 */
export function tiltEach(
  items: TaggedPattern[],
  tiltFor: (id: string) => TiltSettings,
  method: Method3d,
  hCut: HCutMode = 'beam',
): TaggedPattern[] {
  const everyFile = hCut === 'horizon';
  if (!everyFile && !items.some((i) => isTilted(tiltFor(i.pattern.id)))) return items;
  return items.map((i) => {
    const t = tiltFor(i.pattern.id);
    return everyFile || isTilted(t) ? { ...i, pattern: tiltPattern(i.pattern, t, method, hCut) } : i;
  });
}

export function tiltTagged(items: TaggedPattern[], t: TiltSettings, method: Method3d, hCut: HCutMode = 'beam'): TaggedPattern[] {
  return tiltEach(items, () => t, method, hCut);
}

/** Per-id total offsets: the file's own offsets plus its custom group's. Only non-zero totals get an entry. */
export function combineOffsets(
  ids: string[],
  fileOffsets: Record<string, SimSettings>,
  groupOffsets: Record<string, SimSettings>,
  membership: Record<string, string>,
): Record<string, SimSettings> {
  const out: Record<string, SimSettings> = {};
  for (const id of ids) {
    const f = fileOffsets[id];
    const gid = membership[id];
    const g = gid ? groupOffsets[gid] : undefined;
    if (!f && !g) continue;
    const sum = {
      electricalDeg: (f?.electricalDeg ?? 0) + (g?.electricalDeg ?? 0),
      mechanicalDeg: (f?.mechanicalDeg ?? 0) + (g?.mechanicalDeg ?? 0),
      azimuthDeg: (f?.azimuthDeg ?? 0) + (g?.azimuthDeg ?? 0),
    };
    if (sum.electricalDeg !== 0 || sum.mechanicalDeg !== 0 || sum.azimuthDeg !== 0) out[id] = sum;
  }
  return out;
}

/**
 * The 3D reconstruction of normalised grids `h`, `v` as seen in the world frame after
 * electrical tilt, mechanical tilt and an azimuth (bearing) rotation.
 */
export function reconstructTilted3d(
  h: Grid,
  v: Grid,
  t: TiltSettings,
  azimuthDeg: number,
  method: Method3d,
  step = STEP_3D,
): Surface3d {
  const base = reconstruct3d(h, v, method, step);
  if (!isTilted(t) && azimuthDeg === 0) return base;
  const ve = t.electricalDeg === 0 ? v : electricalShift(v, t.electricalDeg);
  const atten = base.el.map((e) =>
    base.az.map((a) => {
      const r = rotateToAntenna(a - azimuthDeg, e, t.mechanicalDeg);
      return lookup(h, ve, r.phi, r.theta, method);
    }),
  );
  return { az: base.az, el: base.el, atten };
}

/**
 * Every direction of the 1° ground-frame grid (elevation −90…90° row by row, azimuth 0…359°) in the frame of an
 * antenna tilted down by a mechanical angle, as the sample below it and the fraction towards the next one on the
 * 1° circles of the two cuts. The same for every file, so it is kept for the last few mechanical tilts.
 */
interface SphereInAntenna {
  hIndex: Uint16Array;
  hFrac: Float32Array;
  vIndex: Uint16Array;
  vFrac: Float32Array;
}

/**
 * One table is SPHERE_ROWS × 360 = 65 160 directions of 12 bytes (two Uint16 and two Float32), about 0.78 MB, so 32
 * tables stay under 25 MB. Least recently used goes first. Files are processed in list order, so a first-in-first-out
 * cache smaller than the number of distinct tilts would rebuild a table for every file.
 */
const SPHERE_CACHE_MAX = 32;
const sphereCache = new Map<number, SphereInAntenna>();
let tablesBuilt = 0;

/** How many direction tables have been built so far (a test reads it to see that a table is built once per tilt). */
export const sphereTablesBuilt = (): number => tablesBuilt;

function sphereInAntenna(mechanicalDeg: number): SphereInAntenna {
  const hit = sphereCache.get(mechanicalDeg);
  if (hit) {
    // Map keeps insertion order: re-inserting makes this the most recently used.
    sphereCache.delete(mechanicalDeg);
    sphereCache.set(mechanicalDeg, hit);
    return hit;
  }
  tablesBuilt++;
  const n = SPHERE_ROWS * 360;
  const map: SphereInAntenna = { hIndex: new Uint16Array(n), hFrac: new Float32Array(n), vIndex: new Uint16Array(n), vFrac: new Float32Array(n) };
  const split = (angle: number, index: Uint16Array, frac: Float32Array, at: number) => {
    const a = mod360(angle);
    const i0 = Math.floor(a);
    index[at] = i0 % 360;
    frac[at] = a - i0;
  };
  for (let row = 0, at = 0; row < SPHERE_ROWS; row++) {
    for (let az = 0; az < 360; az++, at++) {
      const d = rotateToAntenna(az, row - 90, mechanicalDeg);
      split(d.phi, map.hIndex, map.hFrac, at);
      split(d.theta, map.vIndex, map.vFrac, at);
    }
  }
  if (sphereCache.size >= SPHERE_CACHE_MAX) sphereCache.delete(sphereCache.keys().next().value!);
  sphereCache.set(mechanicalDeg, map);
  return map;
}

/** One buffer for the sampled intensity (made on first use): it is filled and reduced within one call. */
let sphereIntensity: Float64Array | null = null;

/** A 1° circle with its first sample repeated at the end, so the sample after 359° needs no wrap. */
const closed = (g: number[]): Float64Array => {
  const out = new Float64Array(361);
  out.set(g);
  out[360] = g[0];
  return out;
};

// Linear power of 0…120 dB in steps of 1/64 dB. Read with linear interpolation it is within 2e-6 (relative) of the
// exponential, and several times cheaper, which matters for the 65 160 directions of every mechanically tilted file.
const POWER_STEPS_PER_DB = 64;
const POWER_TABLE_DB = 120;
let powerTable: Float64Array | null = null;

function powerSteps(): Float64Array {
  if (!powerTable) {
    powerTable = new Float64Array(POWER_TABLE_DB * POWER_STEPS_PER_DB + 2);
    for (let i = 0; i < powerTable.length; i++) powerTable[i] = Math.exp((-i / POWER_STEPS_PER_DB) * DB_TO_NEPER);
  }
  return powerTable;
}

/**
 * The angular-region estimate of a mechanically tilted file: the power of the ROTATED 3D reconstruction (the
 * model of `reconstructTilted3d`: the file's H cut and its electrically tilted V cut, read in the antenna frame)
 * in the Type A regions of the tilted beam. `tiltedGrids` are the simulated cuts: the regions follow their θpeak
 * and HPBW, as the table shows them, but the cuts are not integrated — off boresight a rotated beam is tilted
 * less than its elevation cut says, so the product of the two tilted cuts is a different pattern.
 */
export function tiltedAngularRegions(
  source: Pattern,
  t: TiltSettings,
  tiltedGrids: { h: Grid; v: Grid },
  sectorEdgeDeg: number,
  method: Method3d,
): AngularRegionEfficiency {
  const beam = typeABeam(tiltedGrids.h, tiltedGrids.v, sectorEdgeDeg);
  if ('reason' in beam) return noAngularRegions(beam.reason);
  const { hN, vN } = baseGrids(source);
  const h = closed(hN);
  const v = closed(t.electricalDeg === 0 ? vN : electricalShift(vN, t.electricalDeg));
  const { hIndex, hFrac, vIndex, vFrac } = sphereInAntenna(t.mechanicalDeg);
  const out = (sphereIntensity ??= new Float64Array(SPHERE_ROWS * 360));
  const table = powerSteps();
  // Linear power of a level in dB; a level that is not a finite number carries none (as in `are.ts`).
  const powerOf = (att: number): number => {
    if (att >= 0 && att < POWER_TABLE_DB) {
      const x = att * POWER_STEPS_PER_DB;
      const n = x | 0;
      return table[n] + (table[n + 1] - table[n]) * (x - n);
    }
    const p = Math.exp(-att * DB_TO_NEPER);
    return p === p && p !== Infinity ? p : 0;
  };
  const weighted = method === 'weighted';
  for (let k = 0; k < out.length; k++) {
    // As `interp`: linear in dB between the samples, and the sample itself on a whole degree (a level may be infinite).
    const i = hIndex[k];
    const f = hFrac[k];
    const aH = f === 0 ? h[i] : h[i] + (h[i + 1] - h[i]) * f;
    const j = vIndex[k];
    const g = vFrac[k];
    const aV = g === 0 ? v[j] : v[j] + (v[j + 1] - v[j]) * g;
    out[k] = powerOf(weighted ? combineWeighted(aH, aV, powerOf(aH), powerOf(aV)) : aH + aV);
  }
  return efficiencyOf(sampledRegionPowers(out, beam.regions));
}

export const DECLARED_REASON = 'Declared values describe the measured pattern';

/**
 * Metrics of patterns already tilted with `tiltEach(…)`: the nominal tilt follows the sliders and
 * the Δ-declared values of tilted files are null (they describe the measured pattern), as are the horizontal ones of
 * a horizon-cut copy, tilted or not. With `areMethod` the
 * angular-region estimate is computed too: from the tilted cuts for an electrical tilt, as for the originals, and
 * from the rotated 3D reconstruction for a file with a mechanical tilt (`tiltedAngularRegions`). The estimate does
 * not depend on the horizontal cut shown: for a horizon-cut copy it is taken from the copy cut through the beam peak.
 * The dB levels of a horizon-cut copy's horizontal metrics are below the 3D peak (see `AnalyzeOptions.hCutPeakDb`).
 */
export function analyzeTilted(
  tiltedItems: TaggedPattern[],
  s: AnalysisSettings,
  t: TiltSettings | ((id: string) => TiltSettings),
  areMethod?: Method3d,
): Map<string, PatternMetrics> {
  const tiltFor = typeof t === 'function' ? t : () => t;
  return analyzeAll(tiltedItems, s, {
    nominalOffsetDeg: (id) => {
      const x = tiltFor(id);
      return x.electricalDeg + x.mechanicalDeg;
    },
    // Only tilted files lose their Δ-declared values; an untilted file in a mixed batch
    // keeps comparing its measured pattern against its declared ones.
    declaredReason: (id) => (isTilted(tiltFor(id)) ? DECLARED_REASON : undefined),
    // A horizon cut is not the cut the header describes, tilted or not; the V cut of an untilted copy still is.
    declaredHReason: (pattern) => (tiltedFrom.get(pattern)?.hCut === 'horizon' ? DECLARED_REASON : undefined),
    areMethod,
    areModel: (pattern, grids, sectorEdgeDeg, method) => {
      const origin = tiltedFrom.get(pattern);
      if (!origin) return undefined;
      if (origin.hCut === 'horizon') {
        // The regions follow the beam (its θpeak and HPBW): they are those of the cut through the beam peak.
        const beam = gridsFor(tiltPattern(origin.source, origin.tilt, origin.method, 'beam'));
        return origin.tilt.mechanicalDeg !== 0
          ? tiltedAngularRegions(origin.source, origin.tilt, beam, sectorEdgeDeg, method)
          : angularRegionEfficiency(beam.h, beam.v, sectorEdgeDeg, method);
      }
      return origin.tilt.mechanicalDeg !== 0
        ? tiltedAngularRegions(origin.source, origin.tilt, grids, sectorEdgeDeg, method)
        : undefined;
    },
    hCutPeakDb: horizonCutPeakDb,
  });
}
