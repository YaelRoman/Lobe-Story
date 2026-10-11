import { describe, expect, it } from 'vitest';
import { colorMap, colorMapByGroup, PALETTE, PER_FILE_COLOURS, shade } from './colors';

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

describe('colorMapByGroup', () => {
  it('colours each file on its own, as colorMap, up to ten visible files', () => {
    const groups = [{ ids: ids('a', 6) }, { ids: ids('b', 4) }];
    expect(colorMapByGroup(groups, all(groups))).toEqual(colorMap([...groups[0].ids, ...groups[1].ids]));
  });

  it('colours by group above ten, so files of one group differ by lightness and share the group hue order', () => {
    const groups = [{ ids: ids('a', 7) }, { ids: ids('b', 7) }, { ids: ['c0'] }];
    const m = colorMapByGroup(groups, all(groups));
    expect(m.size).toBe(15);
    expect(new Set(m.values()).size).toBe(15);
    expect(m.get('c0')).toBe(PALETTE[2]);
    expect(m.get('a3')).toBe(PALETTE[0]); // the middle file of an odd-sized group keeps the base colour
    expect(m.get('a0')).not.toBe(m.get('a6'));
  });

  it('counts only groups that have a visible file, like the HPBW chart', () => {
    const groups = [{ ids: ids('a', 12) }, { ids: ids('b', 3) }];
    const visible = all(groups);
    for (const id of groups[0].ids) visible[id] = false;
    // 3 visible files: per-file colours again
    expect(colorMapByGroup(groups, visible).get('b0')).toBe(PALETTE[0]);
    expect(PER_FILE_COLOURS).toBe(10);
    // Past ten visible files the first group's colour is its palette colour and each group's files differ.
    const wide = [{ ids: ['g0'] }, ...Array.from({ length: 11 }, (_, k) => ({ ids: [`h${k}`, `h${k}b`] }))];
    const m = colorMapByGroup(wide, all(wide));
    expect(m.get('g0')).toBe(PALETTE[0]);
    expect(new Set([m.get('h0'), m.get('h0b')]).size).toBe(2);
  });
});
