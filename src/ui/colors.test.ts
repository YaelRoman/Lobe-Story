import { describe, expect, it } from 'vitest';
import {
  colorMap,
  colorMapByGroup,
  contrastRatio,
  groupColour,
  groupLook,
  groupStyle,
  ladder,
  LADDER_LEVELS,
  LADDER_MIN_STEP,
  luminance,
  PALETTE,
  PER_FILE_COLOURS,
  shade,
  styleMapByGroup,
  swatchBackground,
} from './colors';
import { FIGURE_THEMES } from './figureTheme';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const all = (groups: { ids: string[] }[]) => Object.fromEntries(groups.flatMap((g) => g.ids).map((id) => [id, true]));

describe('shade', () => {
  it('mixes towards white or black and keeps the colour at 0', () => {
    expect(shade('#102030', 0)).toBe('#102030');
    expect(shade('#000000', 1)).toBe('#ffffff');
    expect(shade('#ffffff', -1)).toBe('#000000');
    expect(shade('#808080', 0.5)).toBe('#c0c0c0');
  });
});

describe('ladder', () => {
  const BGS = [FIGURE_THEMES.light.bg, FIGURE_THEMES.dark.bg];

  it.each(PALETTE)('keeps every shade of %s readable (3:1) against both plot backgrounds', (base) => {
    for (let n = 1; n <= 16; n++)
      for (const c of ladder(base, n)) for (const bg of BGS) expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(3);
  });

  it.each(PALETTE)('gives the files of %s distinguishable steps, and cycles when a group has more files than steps', (base) => {
    const lv = (c: string) => luminance(c) + 0.05;
    const big = ladder(base, 16);
    const levels = new Set(big).size;
    expect(levels).toBe(LADDER_LEVELS);
    const sorted = [...new Set(big)].sort((a, b) => lv(a) - lv(b));
    for (let i = 1; i < sorted.length; i++) expect(lv(sorted[i]) / lv(sorted[i - 1])).toBeGreaterThanOrEqual(LADDER_MIN_STEP - 0.005);
    big.forEach((c, i) => expect(c).toBe(big[i % LADDER_LEVELS]));
    // Up to the number of steps every file has its own shade.
    for (let n = 1; n <= LADDER_LEVELS; n++) expect(new Set(ladder(base, n)).size).toBe(n);
  });

  it('keeps the hue: the shades are mixes of the group colour with white or black', () => {
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const c of ladder(PALETTE[0], 5)) {
      const [r, g, b] = rgb(c);
      // #4e79a7 is a blue: red lowest, blue highest, whatever the shade.
      expect(r).toBeLessThan(g);
      expect(g).toBeLessThan(b);
    }
  });

  it('a group of one file is its group colour, moved into the readable band when the palette colour is outside it', () => {
    expect(ladder(PALETTE[0], 1)).toEqual([groupColour(0)]);
    expect(groupColour(0)).toBe(PALETTE[0]);
    expect(groupColour(5)).not.toBe(PALETTE[5]); // the yellow is too light for a white background
    expect(contrastRatio(groupColour(5), FIGURE_THEMES.light.bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('colorMapByGroup', () => {
  it('colours each file on its own, as colorMap, up to ten visible files', () => {
    const groups = [{ ids: ids('a', 6) }, { ids: ids('b', 4) }];
    expect(colorMapByGroup(groups, all(groups))).toEqual(colorMap([...groups[0].ids, ...groups[1].ids]));
  });

  it('colours by group above ten: the files of a group are shades of its hue, in the ladder order', () => {
    const groups = [{ ids: ids('a', 7) }, { ids: ids('b', 7) }, { ids: ['c0'] }];
    const m = colorMapByGroup(groups, all(groups));
    expect(m.size).toBe(15);
    expect(m.get('c0')).toBe(groupColour(2));
    expect(ids('a', 7).map((id) => m.get(id))).toEqual(ladder(groupColour(0), 7));
    expect(m.get('a0')).not.toBe(m.get('a1'));
    expect(m.get('a0')).not.toBe(m.get('b0'));
  });

  it('counts only groups that have a visible file, like the beamwidth chart', () => {
    const groups = [{ ids: ids('a', 12) }, { ids: ids('b', 3) }];
    const visible = all(groups);
    for (const id of groups[0].ids) visible[id] = false;
    // 3 visible files: per-file colours again
    expect(colorMapByGroup(groups, visible).get('b0')).toBe(PALETTE[0]);
    expect(PER_FILE_COLOURS).toBe(10);
    // Past ten visible files the first visible group is group 0 and each group's files differ.
    const wide = [{ ids: ['g0'] }, ...Array.from({ length: 11 }, (_, k) => ({ ids: [`h${k}`, `h${k}b`] }))];
    const m = colorMapByGroup(wide, all(wide));
    expect(m.get('g0')).toBe(groupColour(0));
    expect(new Set([m.get('h0'), m.get('h0b')]).size).toBe(2);
  });
});

describe('styleMapByGroup', () => {
  it('every file is solid with the plain marker up to ten files and for the first ten groups', () => {
    const groups = [{ ids: ids('a', 3) }, { ids: ids('b', 3) }];
    for (const s of styleMapByGroup(groups, all(groups)).values()) expect(s).toMatchObject({ dash: 'solid', symbol: 'circle' });
    const wide = Array.from({ length: 10 }, (_, k) => ({ ids: [`g${k}a`, `g${k}b`] }));
    for (const s of styleMapByGroup(wide, all(wide)).values()) expect(s.dash).toBe('solid');
  });

  it('past the palette length the hue repeats with another line pattern and marker per cycle', () => {
    const wide = Array.from({ length: 23 }, (_, k) => ({ ids: [`g${k}a`, `g${k}b`] }));
    const m = styleMapByGroup(wide, all(wide));
    expect(m.get('g0a')!.color).toBe(m.get('g10a')!.color);
    expect(m.get('g0a')!.dash).toBe('solid');
    expect(m.get('g10a')!.dash).not.toBe('solid');
    expect(m.get('g20a')!.dash).not.toBe(m.get('g10a')!.dash);
    expect(m.get('g10a')!.symbol).not.toBe(m.get('g0a')!.symbol);
    expect(groupStyle(10)).toEqual({ dash: m.get('g10a')!.dash, symbol: m.get('g10a')!.symbol });
    expect(new Set(wide.slice(0, 11).map((g) => `${m.get(g.ids[0])!.color}|${m.get(g.ids[0])!.dash}`)).size).toBe(11);
  });

  it('the beamwidth chart takes the same group colour and marker as the files', () => {
    expect(groupLook(2, false)).toEqual({ color: PALETTE[2], symbol: 'circle' });
    const wide = Array.from({ length: 12 }, (_, k) => ({ ids: [`g${k}a`, `g${k}b`] }));
    const m = styleMapByGroup(wide, all(wide));
    for (const k of [0, 5, 11]) {
      expect(groupLook(k, true).color).toBe(groupColour(k));
      expect(m.get(`g${k}a`)!.symbol).toBe(groupLook(k, true).symbol);
    }
  });

  it('has a swatch pattern for every dash', () => {
    expect(swatchBackground('#123456', 'solid')).toBe('#123456');
    for (const dash of ['dot', 'dashdot', 'longdash'] as const) expect(swatchBackground('#123456', dash)).toContain('repeating-linear-gradient');
    expect(new Set(['solid', 'dot', 'dashdot', 'longdash'].map((d) => swatchBackground('#123456', d as 'solid'))).size).toBe(4);
  });
});
