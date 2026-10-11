import { type AnalysisSettings } from './metrics';

export interface SettingLimit {
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

/** The accepted range of every analysis setting; the settings panel and the project loader both read it. */
export const SETTING_LIMITS: Record<keyof AnalysisSettings, SettingLimit> = {
  levelDb: { min: 0.5, max: 20, step: 0.5 },
  fbWindowDeg: { min: 1, max: 180, step: 1 },
  uslsRangeDeg: { min: 1, max: 90, step: 1 },
  sectorEdgeDeg: { min: 1, max: 179, step: 1 },
  siteSectors: { min: 2, max: 12, step: 1, integer: true },
  lobeLimitFactor: { min: 1, max: 10, step: 0.01 },
};

/** Range of the plot floor (dB below the peak), a view setting. */
export const FLOOR_LIMITS = { min: 10, max: 80, step: 1 };

/** `value` when it is a finite number inside the key's range (and an integer if required), else null (reject, keep the previous value). */
export function clampSetting(key: keyof AnalysisSettings, value: number): number | null {
  const l = SETTING_LIMITS[key];
  if (!Number.isFinite(value) || value < l.min || value > l.max) return null;
  if (l.integer && !Number.isInteger(value)) return null;
  return value;
}

/** The plot floor inside its range and at least `levelDb + 1` (the level ring must stay visible), or null when `value` is outside the range. */
export function clampFloor(value: number, levelDb: number): number | null {
  if (!Number.isFinite(value) || value < FLOOR_LIMITS.min || value > FLOOR_LIMITS.max) return null;
  return Math.max(value, levelDb + 1);
}
