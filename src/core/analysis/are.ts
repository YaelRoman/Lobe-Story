import type { MetricResult } from '../types';
import { beamwidth } from './beamwidth';
import { mod360, type Grid } from './grid';
import { combineWeighted, type Method3d } from './pattern3d';

/**
 * Angular region efficiency (NGMN BASTA V13, 7.2.4), beam Type A (macro base-station beam) only, as an
 * ESTIMATE from the two co-polar cuts. It is not a BASTA-compliant value: the standard integrates the
 * measured radiation intensity over the full sphere, and a Planet file has two cuts and no cross-polar data.
 *
 * Intensity over the sphere: the app's own two-cut 3D reconstruction (`pattern3d`, the one the 3D view and
 * the tilt simulation use), with the selected method, so the numbers describe the surface the 3D view shows:
 * I(az, el) = combine(H(az), V(el)) for elevations −90…90°, where only the front half of the elevation cut
 * is used and the azimuth cut supplies the back. With "Summation" this is the separable product of the two
 * cuts in linear power, and the sphere integral is the product of two 1D integrals.
 *
 * Integration: linear power, sampled on the app's 1° grid, taken as linear between samples in both angles,
 * with the exact solid-angle weight cos(elevation) (the document's sin θ, θ measured from the zenith). Region
 * boundaries at non-integer angles cut the 1° cells where they fall: nothing is snapped to a whole degree,
 * and the sum over the regions does not depend on where the boundaries are.
 *
 * Known weakness: straight up and straight down every azimuth is the same direction, and the true level there is
 * the elevation cut's alone. "Summation" still multiplies it by H(az), so near the poles it understates the power
 * by up to the azimuth average of H; "Weighted" tends to the elevation cut there. The lower region (and the cap of
 * the upper region) is therefore the least reliable of the estimates, and too low with "Summation".
 *
 * Tilt simulation. An electrical tilt moves the elevation cut and leaves the pattern the product of its two
 * cuts, so the tilted cuts are integrated as above. A mechanical tilt rotates the whole pattern, and a rotated
 * pattern is NOT the reconstruction of its own two cuts (off boresight the beam is tilted less). For a
 * mechanically tilted file the intensity is therefore the rotated reconstruction itself, sampled on the same
 * 1° grid of ground-frame directions (`sampledRegionPowers`; the rotation is `tilt.ts`'s, the one behind the
 * tilted 3D view and the simulated cuts); only the region bounds come from the tilted cuts.
 */

const RAD = Math.PI / 180;

/** Type A: the lower region starts 75° below the horizon (θ3 = 165° from the zenith) and ends at the nadir. */
export const LOWER_REGION_START_DEG = 75;

/** Type A applies to these half-power beamwidths (Table 7-1). */
export const TYPE_A_V_HPBW: readonly [number, number] = [0.5, 25];
export const TYPE_A_H_HPBW: readonly [number, number] = [50, 130];

/**
 * The regions of the sphere in the app's angles: elevation from the horizon, positive below; azimuth from
 * boresight. Upper region: zenith (−90°) to `upperEndDeg`, all azimuths. Service region: `serviceStartDeg` to
 * `serviceEndDeg`, azimuth within ±`sectorEdgeDeg`. Interference region: `upperEndDeg` to `serviceEndDeg`,
 * all azimuths, without the service region. Lower region: `serviceEndDeg` to the nadir (+90°), all azimuths.
 */
export interface AngularRegions {
  upperEndDeg: number;
  serviceStartDeg: number;
  serviceEndDeg: number;
  sectorEdgeDeg: number;
}

/**
 * Table 7-1, Type A, converted from the polar angle θ (from the zenith) to elevation = θ − 90°:
 * θ1 = min(90°, θpeak − HPBW) → the upper region ends at min(0°, peak − HPBW);
 * θ2 = θpeak − HPBW/2 → the service region starts half a beamwidth above the peak;
 * θ3 = 165° → it ends 75° below the horizon; φ1, φ2 = nominal direction ∓ half the nominal sector.
 */
export function typeARegions(peakElevationDeg: number, vHpbwDeg: number, sectorEdgeDeg: number): AngularRegions {
  return {
    upperEndDeg: Math.max(-90, Math.min(0, peakElevationDeg - vHpbwDeg)),
    serviceStartDeg: Math.max(-90, peakElevationDeg - vHpbwDeg / 2),
    serviceEndDeg: LOWER_REGION_START_DEG,
    sectorEdgeDeg,
  };
}

export const DB_TO_NEPER = Math.LN10 / 10;

/** Linear power of a level in dB below the peak; a level that is not a number (or not finite) carries no power. */
export const linearPower = (att: number): number => {
  const p = Math.exp(-att * DB_TO_NEPER);
  return Number.isFinite(p) ? p : 0;
};
const power = linearPower;

/**
 * Weights w[i] such that Σ w[i]·f[i] is the integral over [lo, hi] (degrees, lo ≤ hi, at most one turn) of the
 * function that is linear between the 360 samples f[i] at whole degrees. In degrees.
 */
function arcWeights(lo: number, hi: number): number[] {
  const w = new Array<number>(360).fill(0);
  for (let cell = Math.floor(lo); cell < hi; cell++) {
    const t0 = Math.max(lo, cell) - cell;
    const t1 = Math.min(hi, cell + 1) - cell;
    if (t1 <= t0) continue;
    const mid = (t0 + t1) / 2;
    w[mod360(cell)] += (t1 - t0) * (1 - mid);
    w[mod360(cell + 1)] += (t1 - t0) * mid;
  }
  return w;
}

/**
 * ∫ R(el)·cos(el) d el over [lo, hi] (degrees within −90…90; result in radians), R linear between the rows
 * `rows[el + 90]` at whole degrees. Exact for that R: ∫ R cos = R sin + R′ cos.
 */
function elevationIntegral(rows: number[], lo: number, hi: number): number {
  let sum = 0;
  for (let cell = Math.floor(lo); cell < hi; cell++) {
    const x0 = Math.max(lo, cell);
    const x1 = Math.min(hi, cell + 1);
    if (x1 <= x0) continue;
    const r0 = rows[cell + 90];
    const slope = rows[cell + 91] - r0; // per degree
    const at = (x: number) => r0 + slope * (x - cell);
    sum += at(x1) * Math.sin(x1 * RAD) - at(x0) * Math.sin(x0 * RAD) + (slope / RAD) * (Math.cos(x1 * RAD) - Math.cos(x0 * RAD));
  }
  return sum;
}

export interface RegionPowers {
  upper: number;
  interference: number;
  service: number;
  lower: number;
}

/** Azimuth integrals of each elevation row (whole degrees −90…90, index = elevation + 90): full circle and sector. */
interface Rows {
  full: number[];
  sector: number[];
}

const sectorArc = (regions: AngularRegions): number[] => {
  const edge = Math.min(180, Math.max(0, regions.sectorEdgeDeg));
  return arcWeights(-edge, edge);
};

function powersFromRows({ full, sector }: Rows, regions: AngularRegions): RegionPowers {
  const end = Math.min(90, Math.max(-90, regions.serviceEndDeg));
  const upperEnd = Math.min(end, Math.max(-90, regions.upperEndDeg));
  const serviceStart = Math.min(end, Math.max(upperEnd, regions.serviceStartDeg));
  const service = elevationIntegral(sector, serviceStart, end);
  return {
    upper: elevationIntegral(full, -90, upperEnd),
    interference: elevationIntegral(full, upperEnd, end) - service,
    service,
    lower: elevationIntegral(full, end, 90),
  };
}

/**
 * The power in each region: ∫∫ I(az, el)·cos(el) d el d az (radians; an isotropic pattern gives the regions'
 * solid angles, 4π in all). `h` and `v` are normalised 1° grids (dB below peak).
 */
export function regionPowers(h: Grid, v: Grid, regions: AngularRegions, method: Method3d): RegionPowers {
  const sectorWeights = sectorArc(regions);
  const hPower = h.map(power);
  const full = new Array<number>(181);
  const sector = new Array<number>(181);
  if (method === 'summation') {
    // Separable: I = H(az)·V(el), so each row is the elevation power times the azimuth integrals.
    let hFull = 0;
    let hSector = 0;
    for (let a = 0; a < 360; a++) {
      hFull += hPower[a];
      hSector += sectorWeights[a] * hPower[a];
    }
    for (let k = 0; k <= 180; k++) {
      const vp = power(v[mod360(k - 90)]);
      full[k] = vp * hFull * RAD;
      sector[k] = vp * hSector * RAD;
    }
  } else {
    for (let k = 0; k <= 180; k++) {
      const aV = v[mod360(k - 90)];
      const vp = power(aV);
      let f = 0;
      let s = 0;
      for (let a = 0; a < 360; a++) {
        const p = power(combineWeighted(h[a], aV, hPower[a], vp));
        f += p;
        s += sectorWeights[a] * p;
      }
      full[k] = f * RAD;
      sector[k] = s * RAD;
    }
  }
  return powersFromRows({ full, sector }, regions);
}

/** Rows of the 1° ground-frame grid: elevations −90…90°, 360 azimuths each (see `sampledRegionPowers`). */
export const SPHERE_ROWS = 181;

/**
 * The power in each region of an intensity that is not the product of two cuts (a rotated pattern): `intensity`
 * holds the linear power at azimuth `az` (0…359) and elevation `row − 90` (row 0…180) of the ground frame at
 * index `row·360 + az`. The same grid, weights and boundary handling as `regionPowers`.
 */
export function sampledRegionPowers(intensity: ArrayLike<number>, regions: AngularRegions): RegionPowers {
  const sectorWeights = sectorArc(regions);
  const full = new Array<number>(SPHERE_ROWS);
  const sector = new Array<number>(SPHERE_ROWS);
  for (let k = 0, at = 0; k < SPHERE_ROWS; k++) {
    let f = 0;
    let s = 0;
    for (let a = 0; a < 360; a++, at++) {
      const p = intensity[at];
      f += p;
      s += sectorWeights[a] * p;
    }
    full[k] = f * RAD;
    sector[k] = s * RAD;
  }
  return powersFromRows({ full, sector }, regions);
}

export interface AngularRegionEfficiency {
  /** Sector efficiency: service region ÷ whole sphere, percent. */
  sector: MetricResult;
  /** Spatial efficiency: service region ÷ (service + interference regions), percent. */
  spatial: MetricResult;
  /** Lower region ratio: lower region ÷ whole sphere, percent. */
  lower: MetricResult;
  /** The regions the values were integrated over (the cut plots shade them); absent when there are no values. */
  regions?: AngularRegions;
}

export const noAngularRegions = (reason: string): AngularRegionEfficiency => {
  const m: MetricResult = { value: null, reason };
  return { sector: m, spatial: m, lower: m };
};

/** A value outside lo…hi with one decimal, or with as many more as it takes not to print the limit itself ("25.04", not "25.0"). */
function outsideText(value: number, lo: number, hi: number): string {
  for (let decimals = 1; decimals <= 6; decimals++) {
    const text = value.toFixed(decimals);
    if (Number(text) < lo || Number(text) > hi) return text;
  }
  return String(value);
}

const outside = (name: string, value: number, [lo, hi]: readonly [number, number]): string | null =>
  value < lo || value > hi ? `Not a Type A (macro) beam: ${name} ${outsideText(value, lo, hi)}° is outside ${lo}–${hi}°` : null;

/**
 * The Type A regions of a beam from its two cuts: θpeak and the vertical HPBW from the elevation cut (3 dB,
 * whatever the beamwidth-level setting), nominal direction azimuth 0°, nominal sector ±`sectorEdgeDeg`. A reason
 * instead when a beamwidth is undefined or outside the Type A ranges, or the elevation peak is behind the antenna.
 */
export function typeABeam(h: Grid, v: Grid, sectorEdgeDeg: number): { regions: AngularRegions } | { reason: string } {
  const hBeam = beamwidth(h, 3);
  const vBeam = beamwidth(v, 3);
  if (hBeam.hpbw.value === null) return { reason: `H-HPBW is not defined: ${hBeam.hpbw.reason ?? 'no 3 dB points'}` };
  if (vBeam.hpbw.value === null) return { reason: `V-HPBW is not defined: ${vBeam.hpbw.reason ?? 'no 3 dB points'}` };
  const reason = outside('V-HPBW', vBeam.hpbw.value, TYPE_A_V_HPBW) ?? outside('H-HPBW', hBeam.hpbw.value, TYPE_A_H_HPBW);
  if (reason) return { reason };
  const peak = vBeam.peakAngle;
  if (Math.abs(peak) > 90) return { reason: 'The elevation peak is behind the antenna' };
  const regions = typeARegions(peak, vBeam.hpbw.value, sectorEdgeDeg);
  if (regions.serviceStartDeg >= regions.serviceEndDeg) return { reason: 'The elevation peak is below the Type A service region' };
  return { regions };
}

/** The three ratios of the region powers, in percent. */
export function efficiencyOf(p: RegionPowers): AngularRegionEfficiency {
  const total = p.upper + p.interference + p.service + p.lower;
  if (!(total > 0)) return noAngularRegions('The pattern has no power');
  return {
    sector: { value: (100 * p.service) / total },
    spatial: { value: (100 * p.service) / (p.service + p.interference) },
    lower: { value: (100 * p.lower) / total },
  };
}

/**
 * The three Type A angular-region values of one file, estimated from its two cuts (see the file comment and
 * `typeABeam`). No number when a beamwidth is undefined or outside the Type A ranges, or when the elevation peak
 * is behind the antenna.
 */
export function angularRegionEfficiency(h: Grid, v: Grid, sectorEdgeDeg: number, method: Method3d): AngularRegionEfficiency {
  const beam = typeABeam(h, v, sectorEdgeDeg);
  if ('reason' in beam) return noAngularRegions(beam.reason);
  return withRegions(efficiencyOf(regionPowers(h, v, beam.regions, method)), beam.regions);
}

/** The values with the regions they were integrated over (none when there is no value). */
export const withRegions = (e: AngularRegionEfficiency, regions: AngularRegions): AngularRegionEfficiency =>
  e.sector.value === null ? e : { ...e, regions };
