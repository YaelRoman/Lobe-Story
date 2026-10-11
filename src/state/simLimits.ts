export interface OffsetState {
  electricalDeg: number;
  mechanicalDeg: number;
  azimuthDeg: number;
}

export type SimulationKey = 'electricalDeg' | 'mechanicalDeg' | 'azimuthDeg';

export const SIM_LIMITS: Record<SimulationKey, { min: number; max: number; step: number }> = {
  electricalDeg: { min: -10, max: 15, step: 0.5 },
  mechanicalDeg: { min: -10, max: 15, step: 0.5 },
  azimuthDeg: { min: -180, max: 180, step: 1 },
};

/** Clamp to the slider range and round to its step; −0 and NaN become 0. */
export function clampSim(key: SimulationKey, n: number): number {
  if (Number.isNaN(n)) return 0;
  const { min, max, step } = SIM_LIMITS[key];
  const rounded = Math.round(Math.min(max, Math.max(min, n)) / step) * step;
  return rounded === 0 ? 0 : rounded;
}
