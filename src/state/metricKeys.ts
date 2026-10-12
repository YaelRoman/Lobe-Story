/** The keys of the metric columns of the table (also what the frequency chart can plot); the table adds label, unit and group. */
export const METRIC_KEYS = [
  'hHpbw', 'vHpbw', 'hBw10', 'vBw10', 'squint', 'hPeak', 'tilt', 'vPeak', 'tiltError',
  'fb180', 'fbWindow', 'firstUsls', 'usls', 'uslsHorizon', 'uslsMax', 'nullFill', 'firstLsls', 'hSls',
  'tracking', 'spr', 'air', 'rollOff', 'du16', 'du64', 'du256',
  'dH', 'dV', 'dFb',
  'areSector', 'areSpatial', 'areLower',
] as const;

export type MetricColumn = (typeof METRIC_KEYS)[number];

/**
 * The key of the Horizon level column: not one of the metric columns, because it exists only while the simulated
 * horizontal cut is the one at the horizon (the table, the exports and the frequency chart's menu add it then).
 */
export const HORIZON_LEVEL_KEY = 'hLevel';

/** A column the table can show or the frequency chart can plot: a metric column or the Horizon level. */
export type TableColumn = MetricColumn | typeof HORIZON_LEVEL_KEY;
