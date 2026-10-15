import type { Pattern } from '../types';
import { analyzeAll, angularRegionsOfCuts, gridsFor, type AnalysisSettings, type PatternMetrics, type TaggedPattern } from './metrics';
import { beamPeakElevation, interp, mod360, rawGrid, type Grid } from './grid';
import { combine, combineWeighted, reconstruct3d, STEP_3D, type Method3d, type Surface3d } from './pattern3d';
import { tablePower } from './powerTable';
import { backBlendPower, backHalfModel, backHalfModelOf, backHalfAtt, backWeight, mismatchWeight, poleWeight, reconstructBack3d } from './backHalf3d';
import { efficiencyOf, noAngularRegions, sampledRegionPowers, SPHERE_ROWS, typeABeam, withRegions, type AngularRegionEfficiency } from './are';

// Kept here for their earlier importers; they live with the other grid functions.
export { beamPeakElevation, interp };

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
const tiltedFrom = new WeakMap<Pattern, { source: Pattern; tilt: TiltSettings; method: Method3d; hCut: HCutMode; backHalf: boolean }>();

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
export function tiltPattern(p: Pattern, t: TiltSettings, method: Method3d, hCut: HCutMode = 'beam', backHalf = false): Pattern {
  const tilted = isTilted(t);
  if (!tilted && hCut === 'beam') return p;
  const key = `${backHalf ? 'back|' : ''}${method}|${t.electricalDeg}|${t.mechanicalDeg}`;
  let entry = tiltedCache.get(p);
  const hit = entry?.[hCut];
  if (hit && hit.key === key) return hit.result;
  const { V, hN, vN, hOff, peakTheta } = baseGrids(p);
  const ve = t.electricalDeg === 0 ? V : electricalShift(V, t.electricalDeg);
  // Antenna-frame elevations on the cone are in the front half of the V cut, where the electrical
  // tilt is a plain shift: Ve(θ) = V(θ − Δe). Reading V directly (not a pre-shifted 1° grid)
  // interpolates once, so a half-degree tilt still finds the exact peak sample.
  const dirs = coneInAntenna(hCut === 'horizon' ? 0 : peakTheta + t.electricalDeg + t.mechanicalDeg, t.mechanicalDeg);
  const hTilted = backHalf
    ? backHalfCone(baseGrids(p), dirs, t.electricalDeg, method)
    : dirs.map((d) => hOff + lookup(hN, vN, d.phi, d.theta - t.electricalDeg, method));
  const result: Pattern = {
    ...p,
    horizontal: { angles: [...DEG360], atten: hTilted },
    // Nothing about the vertical cut changes without a tilt: the copy keeps the file's own.
    vertical: tilted ? { angles: [...DEG360], atten: shiftCircle(ve, t.mechanicalDeg) } : p.vertical,
  };
  if (!entry) tiltedCache.set(p, (entry = {}));
  entry[hCut] = { key, result };
  tiltedFrom.set(result, { source: p, tilt: { electricalDeg: t.electricalDeg, mechanicalDeg: t.mechanicalDeg }, method, hCut, backHalf });
  return result;
}

/**
 * The raw H cut of `tiltPattern` along `dirs` with the back of the vertical cut (`backHalf3d`): the front of the V cut
 * read as the existing model reads it (V(θ − Δe), one interpolation), its back half from the electrically tilted grid
 * (whose back moves down by Δe too), the cone where the tilted front has its 0 dB.
 */
function backHalfCone({ hN, vN, hOff, peakTheta }: BaseGrids, dirs: Direction[], electricalDeg: number, method: Method3d): number[] {
  const ve = electricalDeg === 0 ? vN : electricalShift(vN, electricalDeg);
  const front = (theta: number) => interp(vN, theta - electricalDeg);
  const back = (theta: number) => interp(ve, 180 - theta);
  const m = backHalfModel(hN[180], front, back, peakTheta + electricalDeg, method);
  return dirs.map((d) => hOff + backHalfAtt(m, d.phi, d.theta, interp(hN, d.phi), front(d.theta), back(d.theta)));
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
  backHalf = false,
): TaggedPattern[] {
  const everyFile = hCut === 'horizon';
  if (!everyFile && !items.some((i) => isTilted(tiltFor(i.pattern.id)))) return items;
  return items.map((i) => {
    const t = tiltFor(i.pattern.id);
    return everyFile || isTilted(t) ? { ...i, pattern: tiltPattern(i.pattern, t, method, hCut, backHalf) } : i;
  });
}

export function tiltTagged(items: TaggedPattern[], t: TiltSettings, method: Method3d, hCut: HCutMode = 'beam', backHalf = false): TaggedPattern[] {
  return tiltEach(items, () => t, method, hCut, backHalf);
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
 * electrical tilt, mechanical tilt and an azimuth (bearing) rotation. With `backHalf`, the reconstruction that reads
 * the back of the vertical cut (`backHalf3d`).
 */
export function reconstructTilted3d(
  h: Grid,
  v: Grid,
  t: TiltSettings,
  azimuthDeg: number,
  method: Method3d,
  step = STEP_3D,
  backHalf = false,
): Surface3d {
  if (backHalf) return reconstructBackTilted3d(h, v, t, azimuthDeg, method, step);
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

/** `reconstructTilted3d` with the back of the vertical cut. */
function reconstructBackTilted3d(h: Grid, v: Grid, t: TiltSettings, azimuthDeg: number, method: Method3d, step: number): Surface3d {
  if (!isTilted(t) && azimuthDeg === 0) return reconstructBack3d(h, v, method, step);
  const ve = t.electricalDeg === 0 ? v : electricalShift(v, t.electricalDeg);
  // The electrically tilted grid's own cone: where the untilted front has its 0 dB, moved down by Δe.
  const m = backHalfModelOf(h, ve, method, beamPeakElevation(v) + t.electricalDeg);
  const az: number[] = [];
  const el: number[] = [];
  for (let a = -180; a <= 180; a += step) az.push(a);
  for (let e = -90; e <= 90; e += step) el.push(e);
  const atten = el.map((e) =>
    az.map((a) => {
      const r = rotateToAntenna(a - azimuthDeg, e, t.mechanicalDeg);
      return backHalfAtt(m, r.phi, r.theta, interp(h, r.phi), interp(ve, r.theta), interp(ve, 180 - r.theta));
    }),
  );
  return { az, el, atten };
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
  /** b(φ) of `backHalf3d` in each direction, made the first time the back of the vertical cut asks for it. */
  backWeights?: Float32Array;
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
  backHalf = false,
): AngularRegionEfficiency {
  const beam = typeABeam(tiltedGrids.h, tiltedGrids.v, sectorEdgeDeg);
  if ('reason' in beam) return noAngularRegions(beam.reason);
  const { hN, vN, peakTheta } = baseGrids(source);
  const h = closed(hN);
  const vGrid = t.electricalDeg === 0 ? vN : electricalShift(vN, t.electricalDeg);
  const v = closed(vGrid);
  const sphere = sphereInAntenna(t.mechanicalDeg);
  const { hIndex, hFrac, vIndex, vFrac } = sphere;
  const out = (sphereIntensity ??= new Float64Array(SPHERE_ROWS * 360));
  // Linear power of a level in dB; a level that is not a finite number carries none (as in `are.ts`).
  const powerOf = tablePower;
  const weighted = method === 'weighted';
  if (backHalf) {
    backHalfSphere(backHalfModelOf(hN, vGrid, method, peakTheta + t.electricalDeg), h, v, sphere, out, powerOf);
    return withRegions(efficiencyOf(sampledRegionPowers(out, beam.regions)), beam.regions);
  }
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
  return withRegions(efficiencyOf(sampledRegionPowers(out, beam.regions)), beam.regions);
}

/**
 * `tiltedAngularRegions`' intensity with the back of the vertical cut: the model `m` (`backHalf3d`) read in each
 * direction of the table, the cuts read as there (`h`, `v` closed 1° circles); the back half of the vertical cut at
 * V(180° − θ), interpolated the same way.
 */
function backHalfSphere(
  m: ReturnType<typeof backHalfModelOf>,
  h: Float64Array,
  v: Float64Array,
  table: SphereInAntenna,
  out: Float64Array,
  powerOf: (att: number) => number,
): void {
  const { hIndex, hFrac, vIndex, vFrac } = table;
  // b(φ) depends on the direction only (one array per table); q(θ) and w(θ) on the file's cone, so they are taken at
  // whole degrees of θ mod 360 and read linearly between them (both are smooth: q within 1e-4 of the formula, w within
  // 0.01). Index 360 is θ = 0 again (the closed circle).
  const back = (table.backWeights ??= Float32Array.from(hIndex, (i, k) => backWeight(i + hFrac[k])));
  const qAt = new Float64Array(361);
  const wAt = new Float64Array(361);
  for (let d = 0; d <= 360; d++) {
    qAt[d] = poleWeight(m.coneDeg, d >= 180 ? d - 360 : d);
    wAt[d] = mismatchWeight(m.coneDeg, d >= 180 ? d - 360 : d);
  }
  const { coneDeg, h180, mismatch, nadir, zenith } = m;
  const weighted = m.method === 'weighted';
  const nadirPower = powerOf(nadir.level);
  const zenithPower = powerOf(zenith.level);
  const h180Power = powerOf(h180);
  // The two readings of the back blend that depend on θ only, as powers at whole degrees of θ mod 360, read linearly
  // between them as q and w are: the front model straight behind, Fm(180°, θ), and T(θ).
  const behindAt = new Float64Array(361);
  const backAt = new Float64Array(361);
  for (let d = 0; d <= 360; d++) {
    const theta = d >= 180 ? d - 360 : d;
    const aF = v[d];
    const behind = weighted ? combineWeighted(h180, aF, h180Power, powerOf(aF)) : h180 + aF;
    const r = behind + qAt[d] * (theta >= coneDeg ? nadir : zenith).behind;
    behindAt[d] = powerOf(r > 0 ? r : r === r ? 0 : behind);
    backAt[d] = powerOf(v[(540 - d) % 360] + wAt[d] * mismatch);
  }
  // `backHalfFrom` written out (powers from the table, the θ-only readings tabulated): 65 160 directions per file.
  for (let k = 0; k < out.length; k++) {
    const i = hIndex[k];
    const f = hFrac[k];
    const aH = f === 0 ? h[i] : h[i] + (h[i + 1] - h[i]) * f;
    const j = vIndex[k];
    const g = vFrac[k];
    const aF = g === 0 ? v[j] : v[j] + (v[j + 1] - v[j]) * g;
    const pH = weighted ? powerOf(aH) : 0;
    const pF = weighted ? powerOf(aF) : 0;
    const o = weighted ? combineWeighted(aH, aF, pH, pF) : aH + aF;
    const b = back[k];
    const q = g === 0 ? qAt[j] : qAt[j] + (qAt[j + 1] - qAt[j]) * g;
    if (b === 0 && q === 0) {
      out[k] = powerOf(o);
      continue;
    }
    const thetaMod = j + g;
    const pole = (thetaMod >= 180 ? thetaMod - 360 : thetaMod) >= coneDeg ? nadir : zenith;
    let fm = o;
    if (q !== 0) {
      const atPole = weighted ? combineWeighted(aH, pole.level, pH, pole === nadir ? nadirPower : zenithPower) : aH + pole.level;
      const r = o + q * (pole.level - atPole);
      fm = r > 0 ? r : r === r ? 0 : o;
    }
    if (b === 0) {
      out[k] = powerOf(fm);
      continue;
    }
    const w = g === 0 ? wAt[j] : wAt[j] + (wAt[j + 1] - wAt[j]) * g;
    const p180 = g === 0 ? behindAt[j] : behindAt[j] + (behindAt[j + 1] - behindAt[j]) * g;
    const pT = g === 0 ? backAt[j] : backAt[j] + (backAt[j + 1] - backAt[j]) * g;
    out[k] = backBlendPower(powerOf(fm), p180, pT, b, w);
  }
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
  backHalf = false,
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
    areBackHalf: backHalf,
    areModel: (pattern, grids, sectorEdgeDeg, method) => {
      const origin = tiltedFrom.get(pattern);
      if (!origin) return undefined;
      if (origin.hCut === 'horizon') {
        // The regions follow the beam (its θpeak and HPBW): they are those of the cut through the beam peak, which
        // for an untilted file is the file itself. Its two-cut estimate is shared with the pass that analysed it.
        const beam = tiltPattern(origin.source, origin.tilt, origin.method, 'beam', origin.backHalf);
        return origin.tilt.mechanicalDeg !== 0
          ? tiltedAngularRegions(origin.source, origin.tilt, gridsFor(beam), sectorEdgeDeg, method, backHalf)
          : angularRegionsOfCuts(beam, sectorEdgeDeg, method, backHalf);
      }
      return origin.tilt.mechanicalDeg !== 0
        ? tiltedAngularRegions(origin.source, origin.tilt, grids, sectorEdgeDeg, method, backHalf)
        : undefined;
    },
    hCutPeakDb: horizonCutPeakDb,
  });
}
