import { describe, expect, it } from 'vitest';
import type { GroupView } from '../state/selectors';
import type { Pattern } from '../core/types';
import { filterGroups, filterPending, filterTerms, groupToggleLabel, highlightHiddenByFilter, matchesTerms } from './panelFilter';

const item = (id: string, frequencyMHz: number, displayName?: string) =>
  ({ pattern: { id, fileName: `${id}.msi`, frequencyMHz, ...(displayName ? { displayName } : {}) } as Pattern, tags: {} });
const group = (key: string, label: string, items: ReturnType<typeof item>[], customId?: string): GroupView =>
  ({ key, label, tags: {}, items, ...(customId ? { customId } : {}) });

const groups = [
  group('custom:g1', 'Mine', [], 'g1'),
  group('p', '+45 / 2°', [item('a_1710', 1710), item('a_1795', 1795, 'Lower sector')]),
  group('m', '-45 / 2°', [item('b_1710', 1710)]),
];

describe('filterTerms', () => {
  it('lower-cases and splits on blanks', () => {
    expect(filterTerms('  1710   P45 ')).toEqual(['1710', 'p45']);
    expect(filterTerms('   ')).toEqual([]);
  });
});

describe('matchesTerms', () => {
  it('looks at the file name, the display name, the group label and the frequency', () => {
    const i = groups[1].items[1];
    expect(matchesTerms(['a_1795'], i, '+45')).toBe(true);
    expect(matchesTerms(['lower'], i, '+45')).toBe(true);
    expect(matchesTerms(['+45'], i, '+45')).toBe(true);
    expect(matchesTerms(['1795', 'mhz'], i, '+45')).toBe(true);
    expect(matchesTerms(['1795', 'zzz'], i, '+45')).toBe(false);
  });
});

describe('filterGroups', () => {
  it('returns the same groups for a blank filter', () => {
    const r = filterGroups(groups, '  ');
    expect(r.groups).toBe(groups);
    expect(r.matchIds).toEqual(r.allIds);
    expect(r.allIds).toEqual(['a_1710', 'a_1795', 'b_1710']);
  });
  it('keeps the matching files, drops automatic groups without a match and keeps custom groups', () => {
    const r = filterGroups(groups, '1710');
    expect(r.matchIds).toEqual(['a_1710', 'b_1710']);
    expect(r.groups.map((g) => g.key)).toEqual(['custom:g1', 'p', 'm']);
    expect(r.groups[1].items).toHaveLength(1);
    const only = filterGroups(groups, '-45');
    expect(only.groups.map((g) => g.key)).toEqual(['custom:g1', 'm']);
    expect(only.allIds).toHaveLength(3);
  });
  it('finds nothing for an unknown word', () => {
    expect(filterGroups(groups, 'zzz').matchIds).toEqual([]);
  });
});

describe('highlightHiddenByFilter', () => {
  it('is true only while a filter is active, a file is highlighted and the filter leaves it out', () => {
    expect(highlightHiddenByFilter(groups, 'a_1795', 'a_1710')).toBe(true);
    expect(highlightHiddenByFilter(groups, 'a_1795', 'a_1795')).toBe(false);
    expect(highlightHiddenByFilter(groups, '', 'a_1710')).toBe(false);
    expect(highlightHiddenByFilter(groups, '   ', 'a_1710')).toBe(false);
    expect(highlightHiddenByFilter(groups, 'a_1795', null)).toBe(false);
  });
  it('is false for a highlight that is no file of the panel at all', () => {
    expect(highlightHiddenByFilter(groups, 'a_1795', 'gone')).toBe(false);
  });
  it('is true when nothing matches at all', () => {
    expect(highlightHiddenByFilter(groups, 'zzz', 'a_1710')).toBe(true);
  });
});

describe('groupToggleLabel', () => {
  it('names the group, and says it acts on the matching files while a filter is active', () => {
    expect(groupToggleLabel('+45 / 2°', 3, false)).toBe('Show all in +45 / 2°');
    expect(groupToggleLabel('+45 / 2°', 3, true)).toBe('Show the 3 matching files in +45 / 2°');
    expect(groupToggleLabel('+45 / 2°', 1, true)).toBe('Show the 1 matching file in +45 / 2°');
  });
});

describe('filterPending', () => {
  it('is true while the typed text is ahead of the filter that is applied', () => {
    expect(filterPending('171', '17')).toBe(true);
    expect(filterPending('17', '17')).toBe(false);
    expect(filterPending('', '')).toBe(false);
  });
});
