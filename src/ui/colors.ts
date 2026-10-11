export const PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
];

export function colorMap(ids: string[]): Map<string, string> {
  return new Map(ids.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
}

/** Up to this many visible files each get their own palette colour; beyond it colours go by group (see `styleMapByGroup`). */
export const PER_FILE_COLOURS = PALETTE.length;

/** `hex` mixed with white (t > 0) or black (t < 0) by |t|. */
export function shade(hex: string, t: number): string {
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  const channel = (i: number) => Math.round(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - k) + target * k);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#rrggbb` colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// The plot backgrounds are white (light theme) and #0d1117 (dark). A line needs 3:1 against both (graphical objects,
// WCAG 1.4.11): against white that caps the luminance at 0.30, against the dark one it floors it at 0.116. The band
// below keeps a small margin inside both limits; no shade is ever mixed outside it.
const BAND_MIN = 0.13;
const BAND_MAX = 0.29;
/** Smallest ratio of (luminance + 0.05) between two neighbouring shades of a group that still reads as different lines. */
export const LADDER_MIN_STEP = 1.15;
/** Widest step used when a group has few files, so two files differ clearly. */
const LADDER_MAX_STEP = 1.35;
/** How many different shades fit in the band at the minimum step. A larger group cycles through them again. */
export const LADDER_LEVELS = Math.floor(Math.log((BAND_MAX + 0.05) / (BAND_MIN + 0.05)) / Math.log(LADDER_MIN_STEP)) + 1;

/** `hex` mixed with white or black (hue kept) until its luminance is `target`; `hex` itself when it already is. */
function atLuminance(hex: string, target: number): string {
  const l0 = luminance(hex);
  if (Math.abs(l0 - target) < 1e-4) return hex;
  let lo = 0;
  let hi = 1;
  const sign = target > l0 ? 1 : -1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const l = luminance(shade(hex, sign * mid));
    if ((sign > 0 && l < target) || (sign < 0 && l > target)) lo = mid;
    else hi = mid;
  }
  return shade(hex, sign * hi);
}

/** The palette colour of group `k` (groups are counted in order, the palette repeats), moved into the readable band when it is outside it. */
export function groupColour(k: number): string {
  const base = PALETTE[k % PALETTE.length];
  return atLuminance(base, Math.min(BAND_MAX, Math.max(BAND_MIN, luminance(base))));
}

/**
 * The colours of `n` files of one group whose colour is `base`: shades of its hue that differ in lightness by at
 * least `LADDER_MIN_STEP`, all inside the readable band. A group with more files than `LADDER_LEVELS` repeats the
 * shades in order (a smaller step would make neighbours indistinguishable, a wider band would lose contrast).
 */
export function ladder(base: string, n: number): string[] {
  const centre = Math.min(BAND_MAX, Math.max(BAND_MIN, luminance(base)));
  const m = Math.min(n, LADDER_LEVELS);
  if (m <= 1) return Array.from({ length: n }, () => atLuminance(base, centre));
  const uLo = Math.log(BAND_MIN + 0.05);
  const uHi = Math.log(BAND_MAX + 0.05);
  const step = Math.min(Math.log(LADDER_MAX_STEP), (uHi - uLo) / (m - 1));
  const start = Math.min(uHi - (m - 1) * step, Math.max(uLo, Math.log(centre + 0.05) - ((m - 1) * step) / 2));
  const levels = Array.from({ length: m }, (_, j) => atLuminance(base, Math.exp(start + j * step) - 0.05));
  return Array.from({ length: n }, (_, i) => levels[i % m]);
}

export type LineDash = 'solid' | 'dot' | 'dashdot' | 'longdash';
/** The line pattern and marker of the groups of one palette cycle: the first ten groups are solid, the next ten dotted, and so on. */
const CYCLE_DASHES: LineDash[] = ['solid', 'dot', 'dashdot', 'longdash'];
const CYCLE_SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up'];

/** What tells group `k` from the group that has the same hue (`k` ten places apart): the line pattern and the beamwidth chart's marker. */
export function groupStyle(k: number): { dash: LineDash; symbol: string } {
  const cycle = Math.floor(k / PALETTE.length) % CYCLE_DASHES.length;
  return { dash: CYCLE_DASHES[cycle], symbol: CYCLE_SYMBOLS[cycle] };
}

/** A CSS background for a colour swatch that shows the line pattern (a plain colour for solid). */
export function swatchBackground(color: string, dash: LineDash): string {
  const stripes = (on: number, off: number) => `repeating-linear-gradient(90deg, ${color} 0 ${on}px, transparent ${on}px ${on + off}px)`;
  switch (dash) {
    case 'dot':
      return stripes(2, 2);
    case 'dashdot':
      return `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 6px, ${color} 6px 8px, transparent 8px 10px)`;
    case 'longdash':
      return stripes(5, 2);
    default:
      return color;
  }
}

/** The colour and beamwidth-chart marker of the `k`-th group with a visible file; `byGroup` is whether the files are coloured by group (more than ten visible). */
export function groupLook(k: number, byGroup: boolean): { color: string; symbol: string } {
  return byGroup ? { color: groupColour(k), symbol: groupStyle(k).symbol } : { color: PALETTE[k % PALETTE.length], symbol: 'circle' };
}

export interface FileStyle {
  color: string;
  dash: LineDash;
  /** The beamwidth chart's marker for the file's group. */
  symbol: string;
}

/**
 * Colours and line patterns of the visible files. Up to ten, each file has its own palette colour (as `colorMap`).
 * With more, every group that has a visible file takes one palette colour (the same one the beamwidth chart gives
 * the group: groups are counted in order) and its files are the shades of `ladder`; with more than ten such groups
 * the hue repeats and the line pattern tells the cycles apart. `groups` lists each group's file ids in panel
 * order; `visible` says which are shown.
 */
export function styleMapByGroup(groups: { ids: string[] }[], visible: Record<string, boolean>): Map<string, FileStyle> {
  const shown = groups.map((g) => g.ids.filter((id) => visible[id])).filter((ids) => ids.length > 0);
  const flat = shown.flat();
  if (flat.length <= PER_FILE_COLOURS) return new Map(flat.map((id, i) => [id, { color: PALETTE[i % PALETTE.length], dash: 'solid', symbol: 'circle' }]));
  const out = new Map<string, FileStyle>();
  shown.forEach((ids, k) => {
    const { dash, symbol } = groupStyle(k);
    ladder(groupColour(k), ids.length).forEach((color, i) => out.set(ids[i], { color, dash, symbol }));
  });
  return out;
}

/** The colours of `styleMapByGroup`. */
export function colorMapByGroup(groups: { ids: string[] }[], visible: Record<string, boolean>): Map<string, string> {
  return new Map([...styleMapByGroup(groups, visible)].map(([id, s]) => [id, s.color]));
}
