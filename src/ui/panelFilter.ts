import type { GroupView } from '../state/selectors';
import { nameOf } from '../core/names';
import type { TaggedPattern } from '../core/analysis/metrics';

/** The words of a filter text: lower case, split on blanks. Empty for a blank filter. */
export const filterTerms = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/** The text a filter looks through for one file: its file name, display name, group label and frequency. */
function haystack(item: TaggedPattern, groupLabel: string): string {
  const p = item.pattern;
  return `${p.fileName}\n${nameOf(p)}\n${groupLabel}\n${p.frequencyMHz} MHz`.toLowerCase();
}

/** Whether a file matches: every word of the filter occurs somewhere in its text (so "1710 p45" works across fields). */
export const matchesTerms = (terms: string[], item: TaggedPattern, groupLabel: string): boolean => {
  if (terms.length === 0) return true;
  const text = haystack(item, groupLabel);
  return terms.every((t) => text.includes(t));
};

export interface FilteredPanel {
  /** The groups to list: only matching files; an automatic group with none is left out, a custom group stays (it is a drop target). */
  groups: GroupView[];
  /** Ids of the matching files, in panel order. */
  matchIds: string[];
  /** Ids of every file, in panel order. */
  allIds: string[];
}

/** The panel groups reduced to the files matching `query` (all of them for a blank filter). Groups keep their identity when nothing is dropped. */
export function filterGroups(groups: GroupView[], query: string): FilteredPanel {
  const terms = filterTerms(query);
  const allIds = groups.flatMap((g) => g.items.map((i) => i.pattern.id));
  if (terms.length === 0) return { groups, matchIds: allIds, allIds };
  const shown = groups
    .map((g) => {
      const items = g.items.filter((i) => matchesTerms(terms, i, g.label));
      return items.length === g.items.length ? g : { ...g, items };
    })
    .filter((g) => g.items.length > 0 || g.customId !== undefined);
  return { groups: shown, matchIds: shown.flatMap((g) => g.items.map((i) => i.pattern.id)), allIds };
}
