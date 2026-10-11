import type { Pattern } from '../types';
import { analyzeAll, type AnalysisSettings, type PatternMetrics, type TaggedPattern } from './metrics';
import { mod360, rawGrid, type Grid } from './grid';
import { combine, reconstruct3d, STEP_3D, type Method3d, type Surface3d } from './pattern3d';

export interface TiltSettings {
  /** Extra electrical downtilt added to the measured pattern (degrees, positive = down). */
  electricalDeg: number;
  /** Mechanical downtilt of the whole antenna (degrees, positive = down). */
  mechanicalDeg: number;
}

export const NO_TILT: TiltSettings = { electricalDeg: 0, mechanicalDeg: 0 };

export const isTilted = (t: TiltSettings): boolean => t.electricalDeg !== 0 || t.mechanicalDeg !== 0;

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

/** A pattern's 1° grids: raw (offsets kept) and normalised, plus the untilted horizon lookup per method. */
export interface BaseGrids {
  H: number[];
  V: number[];
  hN: number[];
  vN: number[];
  horizon: Partial<Record<Method3d, number[]>>;
}

// Pattern objects are immutable and stable across renders, so their grids are cached per object.
const baseCache = new WeakMap<Pattern, BaseGrids>();

/** The cached grids of `p` (computed on first use; the same arrays on every later call). */
export function baseGrids(p: Pattern): BaseGrids {
  let g = baseCache.get(p);
  if (!g) {
    const H = rawGrid(p.horizontal);
    const V = rawGrid(p.vertical);
    g = { H, V, hN: normalise(H), vN: normalise(V), horizon: {} };
    baseCache.set(p, g);
  }
  return g;
}

function untiltedHorizon(g: BaseGrids, method: Method3d): number[] {
  return (g.horizon[method] ??= DEG360.map((phi) => lookup(g.hN, g.vN, phi, 0, method)));
}

let horizonCache: { mechanicalDeg: number; dirs: { phi: number; theta: number }[] } | null = null;

/**
 * The 360 horizon directions (φ = 0…359°, θ = 0) in the frame of an antenna tilted down by
 * `mechanicalDeg`. Shared by every pattern; the last value is cached (same array on repeat calls).
 */
export function horizonInAntenna(mechanicalDeg: number): { phi: number; theta: number }[] {
  if (horizonCache?.mechanicalDeg !== mechanicalDeg) {
    horizonCache = { mechanicalDeg, dirs: DEG360.map((phi) => rotateToAntenna(phi, 0, mechanicalDeg)) };
  }
  return horizonCache.dirs;
}

/**
 * A copy of the pattern with tilted 1° cuts (raw values, offsets kept).
 * V: electrical tilt as a cone (front and back move down by Δe), then rotated exactly by m.
 * H: measured H plus the change the tilt causes in the 3D reconstruction along the horizon.
 * Returns `p` itself when there is no tilt.
 */
// The last tilted copy per pattern, so unchanged files keep their object when another file's tilt changes.
const tiltedCache = new WeakMap<Pattern, { key: string; result: Pattern }>();

export function tiltPattern(p: Pattern, t: TiltSettings, method: Method3d): Pattern {
  if (!isTilted(t)) return p;
  const key = `${method}|${t.electricalDeg}|${t.mechanicalDeg}`;
  const hit = tiltedCache.get(p);
  if (hit && hit.key === key) return hit.result;
  const g = baseGrids(p);
  const { H, V, hN, vN } = g;
  // The H estimate only looks up the front half of Ve, where the cone model is a plain shift.
  const veN = t.electricalDeg === 0 ? vN : electricalShift(vN, t.electricalDeg);
  const ve = t.electricalDeg === 0 ? V : electricalShift(V, t.electricalDeg);
  const vTilted = shiftCircle(ve, t.mechanicalDeg);
  const dirs = horizonInAntenna(t.mechanicalDeg);
  const base = untiltedHorizon(g, method);
  const hTilted = H.map(
    (h, phi) => h + lookup(hN, veN, dirs[phi].phi, dirs[phi].theta, method) - base[phi],
  );
  const result: Pattern = {
    ...p,
    horizontal: { angles: [...DEG360], atten: hTilted },
    vertical: { angles: [...DEG360], atten: vTilted },
  };
  tiltedCache.set(p, { key, result });
  return result;
}

/** Tilt each item with its own settings. Returns `items` itself when no item is tilted; untilted items keep their object. */
export function tiltEach(
  items: TaggedPattern[],
  tiltFor: (id: string) => TiltSettings,
  method: Method3d,
): TaggedPattern[] {
  if (!items.some((i) => isTilted(tiltFor(i.pattern.id)))) return items;
  return items.map((i) => {
    const t = tiltFor(i.pattern.id);
    return isTilted(t) ? { ...i, pattern: tiltPattern(i.pattern, t, method) } : i;
  });
}

export function tiltTagged(items: TaggedPattern[], t: TiltSettings, method: Method3d): TaggedPattern[] {
  return tiltEach(items, () => t, method);
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

export const DECLARED_REASON = 'Declared values describe the measured pattern';

const minOf = (xs: number[]): number => xs.reduce((a, b) => (b < a ? b : a), Infinity);

/**
 * Metrics of patterns already tilted with `tiltTagged(…, t, …)`.
 * Horizon guard: when the tilted H cut's peak is more than `levelDb` below the tilted V cut's
 * peak, the horizon no longer crosses the main beam and the H-cut metrics are null.
 */
export function analyzeTilted(
  tiltedItems: TaggedPattern[],
  s: AnalysisSettings,
  t: TiltSettings | ((id: string) => TiltSettings),
): Map<string, PatternMetrics> {
  const tiltFor = typeof t === 'function' ? t : () => t;
  const out = analyzeAll(tiltedItems, s, {
    nominalOffsetDeg: (id) => {
      const x = tiltFor(id);
      return x.electricalDeg + x.mechanicalDeg;
    },
    // Only tilted files lose their Δ-declared values; an untilted file in a mixed batch
    // keeps comparing its measured pattern against its declared ones.
    declaredReason: (id) => (isTilted(tiltFor(id)) ? DECLARED_REASON : undefined),
  });
  for (const { pattern } of tiltedItems) {
    if (!isTilted(tiltFor(pattern.id))) continue;
    const m = out.get(pattern.id);
    if (!m) continue;
    const drop = minOf(pattern.horizontal.atten) - minOf(pattern.vertical.atten);
    if (!(drop > s.levelDb)) continue;
    const off = {
      value: null,
      reason: `Horizon cut misses the main beam at this tilt (peak ${drop.toFixed(1)} dB down)`,
    };
    out.set(pattern.id, {
      ...m,
      h: { ...m.h, hpbw: off, direction: off, edges: null },
      squint: off,
      fb180: off,
      fbWindow: off,
      beamTracking: off,
    });
  }
  return out;
}
