/** The keys of the metric columns of the table (also what the frequency chart can plot); the table adds label, unit and group. */
export const METRIC_KEYS = [
  'hHpbw', 'vHpbw', 'hBw10', 'vBw10', 'squint', 'hPeak', 'tilt', 'vPeak', 'tiltError',
  'fb180', 'fbWindow', 'firstUsls', 'usls', 'uslsHorizon', 'uslsMax', 'nullFill', 'firstLsls', 'hSls',
  'tracking', 'spr', 'air', 'rollOff', 'du16', 'du64', 'du256',
  'dH', 'dV', 'dFb',
] as const;

export type MetricColumn = (typeof METRIC_KEYS)[number];
