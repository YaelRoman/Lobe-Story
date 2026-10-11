import type { GainUnit, Pattern } from './types';

export const DBI_OVER_DBD = 2.15;

export function convertGain(gain: Pattern['gain'], unit: GainUnit): number | null {
  if (!gain) return null;
  if (gain.unit === unit) return gain.value;
  return unit === 'dBi' ? gain.value + DBI_OVER_DBD : gain.value - DBI_OVER_DBD;
}
