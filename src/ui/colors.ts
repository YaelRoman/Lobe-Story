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

/** Up to this many visible files each get their own palette colour; beyond it colours go by group (see `colorMapByGroup`). */
export const PER_FILE_COLOURS = PALETTE.length;
/** Largest lightness shift (towards white or black, as a fraction) between the files of one group. */
const SHADE_SPAN = 0.55;

/** `hex` mixed with white (t > 0) or black (t < 0) by |t|. */
export function shade(hex: string, t: number): string {
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  const channel = (i: number) => Math.round(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - k) + target * k);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Colours of the visible files. Up to ten, each file has its own palette colour (as `colorMap`). With more,
 * every group that has a visible file takes one palette colour (the same one the HPBW chart gives the group:
 * groups are counted in order) and its files differ by lightness, so seven files no longer share a colour.
 * `groups` lists each group's file ids in panel order; `visible` says which are shown.
 */
export function colorMapByGroup(groups: { ids: string[] }[], visible: Record<string, boolean>): Map<string, string> {
  const shown = groups.map((g) => g.ids.filter((id) => visible[id])).filter((ids) => ids.length > 0);
  const flat = shown.flat();
  if (flat.length <= PER_FILE_COLOURS) return colorMap(flat);
  const out = new Map<string, string>();
  shown.forEach((ids, k) => {
    const base = PALETTE[k % PALETTE.length];
    ids.forEach((id, i) => out.set(id, ids.length === 1 ? base : shade(base, -SHADE_SPAN / 2 + (SHADE_SPAN * i) / (ids.length - 1))));
  });
  return out;
}
