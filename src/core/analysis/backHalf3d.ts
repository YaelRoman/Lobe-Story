import { at, beamPeakElevation, interp, mod360, type Grid } from './grid';
import { combine, combineWeighted, STEP_3D, type Method3d, type Surface3d } from './pattern3d';
import { tablePower as power } from './powerTable';

/**
 * The back-half-aware two-cut reconstruction ("Use the back of the vertical cut", off by default).
 *
 * Directions are antenna-frame azimuth φ (0° = boresight, ±180° = straight behind) and elevation θ (−90…90°,
 * positive below the horizon). Three readings of the normalised cuts describe a direction:
 * - aH = H(φ), the azimuth cut at φ;
 * - aF = V(θ), the front half of the vertical cut at θ (the plane φ = 0);
 * - aB = V(180° − θ), the back half of the vertical cut: the plane φ = 180° at elevation θ (straight behind at the
 *   horizon is V(180°); 10° below the horizon behind the antenna is V(170°); straight down is V(90°) from both halves).
 *
 * The existing model is O(φ, θ) = combine(H(φ), V(θ)) (`pattern3d`); it reproduces the azimuth cut on the cone θc where
 * the front of the vertical cut has its 0 dB (the cone the file's azimuth cut is taken to lie on) and the front of
 * the vertical cut at the azimuth of the H peak, but behind the antenna it gives H(180°) + V(θ): the back half of the
 * vertical cut is never read, and at the poles (θ = ±90°, where every azimuth is the same direction) it depends on φ.
 *
 * This model keeps O and adds two corrections, as a transfinite (Coons) blend of the errors O makes on the two other
 * boundaries it should honour, the meridian behind the antenna and the poles:
 *
 *   R = O + b(φ)·[T(θ) − O(180°, θ)] + q(θ)·[P − O(φ, ±90°) − b(φ)·(P − O(180°, ±90°))]
 *
 * - b(φ) = cos²φ behind the antenna (cos φ < 0) and 0 in front: 1 at 180°, 0 at ±90° with zero slope at both ends,
 *   so the whole front hemisphere is the existing model (apart from the pole term below).
 * - q(θ) = 1 − cos(90°·s), s the distance from θc towards the pole on that side as a fraction of the way
 *   (s = (θ − θc)/(90° − θc) below the cone, (θc − θ)/(90° + θc) above): 0 with zero slope on the cone, 1 at the pole.
 *   For θc = 0 it is 1 − cos θ: the share of the azimuth cut's variation removed is what the circle of constant elevation
 *   has shrunk by.
 * - P is the vertical cut at that pole (V(90°) below, V(270°) above): one direction, one value.
 * - T(θ) = B(θ) + w(θ)·m is the back half of the vertical cut, moved by the mismatch m = O(180°, θc) − B(θc)
 *   between the two cuts where they cross behind the antenna (m = 0 when the cuts agree there, H(180°) = V(180° − θc)),
 *   so it meets the azimuth cut on the cone. w(θ) = cos²(90°·(θ − θc)/10°) within 10° of the cone, 0 beyond: the two
 *   cuts meet in one direction, and a disagreement there is a local matter of the two measurements (one of them in a
 *   null a degree away, or a cut taken at another elevation; measured files disagree by up to 20 dB or more there), so
 *   beyond 10° the back half is taken as measured. Spreading the shift further would move the whole back by it.
 *
 * What it reproduces exactly, with either combination method:
 * - on the cone θc, R = O: the azimuth cut H(φ) for every azimuth (q = 0 and T(θc) = O(180°, θc));
 * - at φ = 180°, R = T(θ): the back half of the vertical cut at every elevation (B(θ) itself when the cuts agree
 *   behind the antenna, and beyond 10° from the cone whether they agree or not);
 * - at φ = 0, R = O(0, θ) + q(θ)·[P − O(0, ±90°)]: the front half of the vertical cut when H(0°) = 0 (the existing
 *   model's own condition), since then O(0, θ) = V(θ) and O(0, ±90°) = P;
 * - at the poles, R = P for every azimuth (single-valued).
 * Between the 1° samples the readings are what the caller passes (the conventions of each path are unchanged).
 * The result is clipped at 0 dB from below (the strongest direction stays the azimuth cut's peak on the cone, as in O),
 * and a correction that is not a number (infinite levels) leaves the existing model's value.
 */
export interface BackHalfModel {
  method: Method3d;
  /** θc: the cone the azimuth cut lies on, where the front of the vertical cut has its 0 dB. */
  coneDeg: number;
  /** H(180°). */
  h180: number;
  /** 10^(−H(180°)/10), for the weighted combination. */
  h180Power: number;
  /** m = O(180°, θc) − B(θc). */
  mismatch: number;
  /** P below (θ → +90°) and the constant P − O(180°, 90°). */
  nadir: Pole;
  /** P above (θ → −90°) and the constant P − O(180°, −90°). */
  zenith: Pole;
}

interface Pole {
  level: number;
  /** 10^(−level/10), for the weighted combination. */
  power: number;
  /** P − O(180°, pole). */
  behind: number;
}

const RAD = Math.PI / 180;

/**
 * Model constants of normalised cuts. `front(θ)` and `back(θ)` read the vertical cut's front half V(θ) and back half
 * V(180° − θ) as the caller reads them for directions (the same interpolation); `h180` is H(180°).
 */
export function backHalfModel(
  h180: number,
  front: (thetaDeg: number) => number,
  back: (thetaDeg: number) => number,
  coneDeg: number,
  method: Method3d,
): BackHalfModel {
  const pole = (thetaDeg: number): Pole => {
    const level = back(thetaDeg);
    return { level, power: 10 ** (-level / 10), behind: level - combine(h180, level, method) };
  };
  return {
    method,
    coneDeg,
    h180,
    h180Power: 10 ** (-h180 / 10),
    mismatch: combine(h180, front(coneDeg), method) - back(coneDeg),
    nadir: pole(90),
    zenith: pole(-90),
  };
}

/** How far from the cone (degrees) a disagreement of the two cuts behind the antenna is blended (see `BackHalfModel`). */
export const MISMATCH_BLEND_DEG = 10;

/** w(θ): 1 on the cone θc, 0 from `MISMATCH_BLEND_DEG` away (see `BackHalfModel`). */
export function mismatchWeight(coneDeg: number, thetaDeg: number): number {
  const d = Math.abs(thetaDeg - coneDeg);
  if (d >= MISMATCH_BLEND_DEG) return 0;
  const c = Math.cos(((d / MISMATCH_BLEND_DEG) * 90 * Math.PI) / 180);
  return c * c;
}

/** q(θ): 0 on the cone θc, 1 at the poles (see `BackHalfModel`). */
export function poleWeight(coneDeg: number, thetaDeg: number): number {
  const below = thetaDeg >= coneDeg;
  const along = below ? thetaDeg - coneDeg : coneDeg - thetaDeg;
  if (along === 0) return 0;
  const way = below ? 90 - coneDeg : 90 + coneDeg;
  const s = way > 0 ? along / way : 1;
  return s >= 1 ? 1 : 1 - Math.cos(s * 90 * RAD);
}

/** b(φ): 0 in front of the antenna, cos²φ behind it (see `BackHalfModel`). */
export function backWeight(phiDeg: number): number {
  const c = Math.cos(phiDeg * RAD);
  // cos(±90°) is not exactly 0 in floating point: the sides count as front.
  return c < -1e-12 ? c * c : 0;
}

/**
 * The model's value from the existing model's three combinations in this direction: `o` = O(φ, θ) = combine(aH, aF),
 * `atPole` = combine(aH, P) for the pole on θ's side, `behind` = O(180°, θ) = combine(H(180°), aF); `aB` = V(180° − θ).
 */
export function backHalfFrom(m: BackHalfModel, b: number, q: number, thetaDeg: number, o: number, atPole: number, behind: number, aB: number): number {
  if (b === 0 && q === 0) return o;
  let r = o;
  if (q !== 0) {
    const pole = thetaDeg >= m.coneDeg ? m.nadir : m.zenith;
    r += q * (pole.level - atPole - b * pole.behind);
  }
  if (b !== 0) r += b * (aB + mismatchWeight(m.coneDeg, thetaDeg) * m.mismatch - behind);
  if (r > 0) return r;
  // r ≤ 0: stronger than the peak by a mismatch of the cuts, clipped; not a number (∞ − ∞): the existing model's value.
  return r === r ? 0 : o;
}

/**
 * The model's attenuation (dB ≥ 0) in direction (φ, θ) from its three readings, given the weights b(φ) and q(θ).
 * Exactly the existing model's value where both weights are 0 (the front hemisphere on the cone).
 */
export function backHalfAttWith(m: BackHalfModel, b: number, q: number, thetaDeg: number, aH: number, aF: number, aB: number): number {
  if (m.method === 'summation') {
    const o = aH + aF;
    if (b === 0 && q === 0) return o;
    const pole = thetaDeg >= m.coneDeg ? m.nadir : m.zenith;
    return backHalfFrom(m, b, q, thetaDeg, o, aH + pole.level, m.h180 + aF, aB);
  }
  // The powers of the two readings once, for the three combinations (O exactly as `combine` gives it).
  const pH = 10 ** (-aH / 10);
  const pF = 10 ** (-aF / 10);
  const o = combineWeighted(aH, aF, pH, pF);
  if (b === 0 && q === 0) return o;
  const pole = thetaDeg >= m.coneDeg ? m.nadir : m.zenith;
  const atPole = q === 0 ? 0 : combineWeighted(aH, pole.level, pH, pole.power);
  const behind = b === 0 ? 0 : combineWeighted(m.h180, aF, m.h180Power, pF);
  return backHalfFrom(m, b, q, thetaDeg, o, atPole, behind, aB);
}

/** The model's attenuation in direction (φ, θ) from its three readings (see `BackHalfModel`). */
export const backHalfAtt = (m: BackHalfModel, phiDeg: number, thetaDeg: number, aH: number, aF: number, aB: number): number =>
  backHalfAttWith(m, backWeight(phiDeg), poleWeight(m.coneDeg, thetaDeg), thetaDeg, aH, aF, aB);

/** The model of normalised 1° grids read with linear interpolation (`interp`), the cone where `v` has its 0 dB unless given. */
export function backHalfModelOf(h: Grid, v: Grid, method: Method3d, coneDeg = beamPeakElevation(v)): BackHalfModel {
  return backHalfModel(h[180], (t) => interp(v, t), (t) => interp(v, 180 - t), coneDeg, method);
}

function axis(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let a = from; a <= to; a += step) out.push(a);
  return out;
}

/** As `reconstruct3d`, with the back half of the vertical cut (whole-degree grid directions, read as `at` does). */
export function reconstructBack3d(h: Grid, v: Grid, method: Method3d, step = STEP_3D): Surface3d {
  const m = backHalfModelOf(h, v, method);
  const az = axis(-180, 180, step);
  const el = axis(-90, 90, step);
  const atten = el.map((e) => {
    const aF = at(v, e);
    const aB = v[mod360(Math.round(180 - e))];
    return az.map((a) => backHalfAtt(m, a, e, at(h, a), aF, aB));
  });
  return { az, el, atten };
}

/**
 * The model's linear power in every direction of the 1° grid of normalised grids `h`, `v` (no rotation): elevation
 * −90…90° row by row, azimuth 0…359° (index row·360 + azimuth), for `sampledRegionPowers`. The same values as
 * `backHalfAtt` with whole-degree readings, the combinations computed once per row or column where they can be, the
 * powers read from the table of `powerTable` (within 2e-6 of the exponential, as the rotated estimate of a tilted file).
 */
export function backHalfIntensity(h: Grid, v: Grid, method: Method3d): Float64Array {
  const m = backHalfModelOf(h, v, method);
  const { coneDeg, h180, mismatch, nadir, zenith } = m;
  const weighted = method === 'weighted';
  const comb = (a: number, c: number, pa: number, pc: number): number => (weighted ? combineWeighted(a, c, pa, pc) : a + c);
  const hPower = weighted ? h.map(power) : h;
  const back = h.map((_, a) => backWeight(a));
  // Per azimuth: combine(H(φ), P) at each pole, the terms of the pole correction that do not depend on θ.
  const poleTerm = (pole: BackHalfModel['nadir']) => {
    const p = power(pole.level);
    return h.map((aH, a) => pole.level - comb(aH, pole.level, hPower[a], p) - back[a] * pole.behind);
  };
  const belowTerm = poleTerm(nadir);
  const aboveTerm = poleTerm(zenith);
  const h180Power = power(h180);
  const out = new Float64Array(181 * 360);
  for (let row = 0, at = 0; row <= 180; row++) {
    const theta = row - 90;
    const aF = v[mod360(theta)];
    const pF = weighted ? power(aF) : 0;
    const q = poleWeight(coneDeg, theta);
    const poleRow = theta >= coneDeg ? belowTerm : aboveTerm;
    // b(φ)·[T(θ) − O(180°, θ)]: the bracket is the same for the whole row.
    const behindRow = v[mod360(180 - theta)] + mismatchWeight(coneDeg, theta) * mismatch - comb(h180, aF, h180Power, pF);
    for (let a = 0; a < 360; a++, at++) {
      const o = weighted ? combineWeighted(h[a], aF, hPower[a], pF) : h[a] + aF;
      const b = back[a];
      if (b === 0 && q === 0) {
        out[at] = power(o);
        continue;
      }
      let r = o;
      if (q !== 0) r += q * poleRow[a];
      if (b !== 0) r += b * behindRow;
      out[at] = power(r > 0 ? r : r === r ? 0 : o);
    }
  }
  return out;
}

/**
 * A 3D method as the numbers that depend on it are named: the method, with `+back` while the reconstruction reads the
 * back of the vertical cut. Exports and captions write it wherever they write the method ("[Summation + back of V cut]").
 */
export type MethodName = Method3d | 'summation+back' | 'weighted+back';

export const methodNameOf = (method: Method3d, backHalf: boolean): MethodName => (backHalf ? `${method}+back` : method);

const parts = (n: MethodName): [Method3d, boolean] => (n === 'summation+back' ? ['summation', true] : n === 'weighted+back' ? ['weighted', true] : [n, false]);

/** The combination method of a name. */
export const methodOfName = (n: MethodName): Method3d => parts(n)[0];

const FULL: Record<Method3d, string> = { summation: 'Summation', weighted: 'Weighted' };
const SHORT: Record<Method3d, string> = { summation: 'Sum.', weighted: 'Wtd.' };

/** The name in headers and lines: "Summation", "Weighted + back of V cut" (comma-free, so a CSV header needs no quoting). */
export function methodFull(n: MethodName): string {
  const [m, back] = parts(n);
  return back ? `${FULL[m]} + back of V cut` : FULL[m];
}

/** The short name of the on-screen table headers: "Sum.", "Wtd. + back". */
export function methodShort(n: MethodName): string {
  const [m, back] = parts(n);
  return back ? `${SHORT[m]} + back` : SHORT[m];
}

/** The name in a sentence: "summation method", "weighted method with the back of the vertical cut". */
export function methodWords(n: MethodName): string {
  const [m, back] = parts(n);
  return `${m} method${back ? ' with the back of the vertical cut' : ''}`;
}
