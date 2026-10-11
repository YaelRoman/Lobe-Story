import { describe, expect, it } from 'vitest';
import type { GroupView } from '../state/selectors';
import type { Pattern } from '../core/types';
import { filterGroups, filterTerms, matchesTerms } from './panelFilter';

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
