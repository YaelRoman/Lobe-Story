import type { GainUnit, Pattern } from './types';

export const DBI_OVER_DBD = 2.15;

/** Declared gains outside this range (dBi) are far from any real antenna and are flagged when a file is read. */
export const PLAUSIBLE_GAIN_DBI = { min: -10, max: 40 } as const;

/** A frequency the band statistics and the frequency chart can place: finite and above 0 MHz. */
export const hasUsableFrequency = (frequencyMHz: number): boolean => Number.isFinite(frequencyMHz) && frequencyMHz > 0;

export function convertGain(gain: Pattern['gain'], unit: GainUnit): number | null {
  if (!gain) return null;
  if (gain.unit === unit) return gain.value;
  return unit === 'dBi' ? gain.value + DBI_OVER_DBD : gain.value - DBI_OVER_DBD;
}
