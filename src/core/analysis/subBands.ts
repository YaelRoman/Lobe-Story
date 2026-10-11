import type { TaggedPattern } from './metrics';

/** A frequency range over which band statistics are collected. */
export interface SubBand {
  name: string;
  minMHz: number;
  maxMHz: number;
}

export const AUTO_GAP_MHZ = 100;
export const SUB_BAND_TOLERANCE_MHZ = 0.5;
export const MAX_SUB_BANDS = 12;
export const MAX_FREQUENCY_MHZ = 100000;
export const SUB_BAND_NAME_MAX = 40;

const num = (f: number): string => String(Math.round(f * 10) / 10);

export function subBandName(minMHz: number, maxMHz: number): string {
  return minMHz === maxMHz ? `${num(minMHz)} MHz` : `${num(minMHz)}–${num(maxMHz)} MHz`;
}

/** One sub-band per cluster of distinct frequencies whose neighbours are at most `gapMHz` apart. */
export function autoSubBands(frequenciesMHz: readonly number[], gapMHz: number = AUTO_GAP_MHZ): SubBand[] {
  const f = [...new Set(frequenciesMHz.filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
  const out: SubBand[] = [];
  let start = 0;
  for (let i = 1; i <= f.length; i++) {
    if (i === f.length || f[i] - f[i - 1] > gapMHz) {
      out.push({ name: subBandName(f[start], f[i - 1]), minMHz: f[start], maxMHz: f[i - 1] });
      start = i;
    }
  }
  return out;
}

export function inSubBand(frequencyMHz: number, b: SubBand): boolean {
  return frequencyMHz >= b.minMHz - SUB_BAND_TOLERANCE_MHZ && frequencyMHz <= b.maxMHz + SUB_BAND_TOLERANCE_MHZ;
}

const validFreq = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_FREQUENCY_MHZ;

/** Cleans sub-bands read from a project file. */
export function sanitizeSubBands(raw: unknown): SubBand[] {
  if (!Array.isArray(raw)) return [];
  const out: SubBand[] = [];
  for (const e of raw) {
    if (out.length >= MAX_SUB_BANDS) break;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) continue;
    const { name, minMHz, maxMHz } = e as Record<string, unknown>;
    if (!validFreq(minMHz) || !validFreq(maxMHz)) continue;
    const lo = Math.min(minMHz, maxMHz);
    const hi = Math.max(minMHz, maxMHz);
    const trimmed = typeof name === 'string' ? name.trim().slice(0, SUB_BAND_NAME_MAX) : '';
    out.push({ name: trimmed || subBandName(lo, hi), minMHz: lo, maxMHz: hi });
  }
  return out;
}

const RANGES: [number, number][] = [
  [617, 698], [698, 803], [791, 862], [814, 894], [880, 960], [1427, 1518], [1710, 1780], [1710, 1880],
  [1850, 1990], [1920, 2020], [1920, 2170], [2110, 2200], [2300, 2400], [2496, 2593], [2570, 2620],
  [2593, 2690], [3300, 3400], [3400, 3500], [3500, 3600], [3600, 3700], [3700, 3800], [3800, 3900],
  [3900, 4000], [4000, 4100], [4100, 4200],
];

// Ranges from BASTA V13 Table 11-8 (lowest-portion start to highest-portion stop) and the three Annex C example sub-bands.
export const SUB_BAND_PRESETS: SubBand[] = RANGES.map(([minMHz, maxMHz]) => ({
  name: subBandName(minMHz, maxMHz),
  minMHz,
  maxMHz,
}));

/** The instances that make up one antenna: same custom group and array tag. */
export interface BandDataset {
  key: string;
  label: string;
  items: TaggedPattern[];
}

export function buildDatasets(
  tagged: readonly TaggedPattern[],
  groups: readonly { id: string; name: string }[],
): BandDataset[] {
  const groupIndex = new Map(groups.map((g, i) => [g.id, i]));
  const map = new Map<string, { scope: string; array: string; items: TaggedPattern[] }>();
  for (const item of tagged) {
    const f = item.pattern.frequencyMHz;
    if (item.copyOf || !Number.isFinite(f) || f <= 0) continue;
    const scope = item.scope !== undefined && groupIndex.has(item.scope) ? item.scope : '';
    const array = (item.tags.array ?? '').trim();
    const key = `${scope}\u0000${array}`;
    const d = map.get(key) ?? { scope, array, items: [] };
    d.items.push(item);
    map.set(key, d);
  }
  const rank = (s: string) => (s ? groupIndex.get(s)! : Infinity);
  const sorted = [...map.entries()].sort(([, a], [, b]) => {
    if (a.scope !== b.scope) return rank(a.scope) - rank(b.scope);
    if (a.array === b.array) return 0;
    if (!a.array) return 1;
    if (!b.array) return -1;
    return a.array.localeCompare(b.array, undefined, { numeric: true });
  });
  const fallback = sorted.length === 1 ? 'All files' : 'No array tag';
  return sorted.map(([key, d]) => {
    const groupName = groups.find((g) => g.id === d.scope)?.name;
    const label = [groupName, d.array && `Array ${d.array}`].filter(Boolean).join(' · ');
    return { key, label: label || fallback, items: d.items };
  });
}

/** The columns for a dataset: the user's sub-bands when there are any, else the automatic ones. */
export function subBandsFor(items: readonly TaggedPattern[], user: readonly SubBand[]): SubBand[] {
  return user.length ? [...user] : autoSubBands(items.map((i) => i.pattern.frequencyMHz));
}
