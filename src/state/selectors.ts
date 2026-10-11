import type { Pattern, Tags } from '../core/types';
import type { TaggedPattern } from '../core/analysis/metrics';
import { groupKey, groupLabel, inferTags, isGeneratedLabel, UNGROUPED } from '../core/grouping';
import type { CustomGroup, LoadedFile } from './store';

export function effectiveTags(pattern: Pattern, override?: Partial<Tags>): Tags {
  return { ...inferTags(pattern), ...override };
}

/** All four tag keys, so applying it as an override replaces every inferred value. */
export function fullTags(t: Tags): Tags {
  return { polarization: t.polarization, tiltDeg: t.tiltDeg, port: t.port, array: t.array };
}

/** The copy number of a copy id (`path#copy-n`), or 0 for an original. */
export const copyNumber = (id: string): number => {
  const i = id.lastIndexOf('#copy-');
  return i < 0 ? 0 : Number(id.slice(i + 6));
};

/** Display name of an instance: its rename, else "<file> (copy n)" for a copy, else undefined (use the file name). */
export function instanceName(id: string, fileName: string, names: Record<string, string>): string | undefined {
  if (names[id]) return names[id];
  const n = copyNumber(id);
  return n ? `${fileName} (copy ${n})` : undefined;
}

// Instance patterns per parsed pattern, so the same copy/rename keeps the same object (tilt/grid caches).
const instanceCache = new WeakMap<Pattern, Map<string, Pattern>>();

function instancePattern(base: Pattern, id: string, displayName: string | undefined): Pattern {
  if (id === base.id && displayName === undefined) return base;
  let byKey = instanceCache.get(base);
  if (!byKey) {
    byKey = new Map();
    instanceCache.set(base, byKey);
  }
  const key = `${id}\u0000${displayName ?? ''}`;
  let p = byKey.get(key);
  if (!p) {
    p = { ...base, id, ...(displayName !== undefined ? { displayName } : {}) };
    byKey.set(key, p);
  }
  return p;
}

function copiesBySource(copies: Record<string, { sourceId: string }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [copyId, { sourceId }] of Object.entries(copies)) {
    const list = out.get(sourceId) ?? [];
    list.push(copyId);
    out.set(sourceId, list);
  }
  return out;
}

/** Every instance (originals in file order, each followed by its copies) with tags, names and scope. */
export function selectInstances(
  files: LoadedFile[],
  overrides: Record<string, Partial<Tags>>,
  copies: Record<string, { sourceId: string }> = {},
  names: Record<string, string> = {},
  membership: Record<string, string> = {},
): TaggedPattern[] {
  const bySource = copiesBySource(copies);
  const out: TaggedPattern[] = [];
  for (const f of files) {
    if (!f.result.ok) continue;
    const base = f.result.pattern;
    for (const id of [f.id, ...(bySource.get(f.id) ?? [])]) {
      const item: TaggedPattern = {
        pattern: instancePattern(base, id, instanceName(id, base.fileName, names)),
        tags: effectiveTags(base, overrides[id]),
      };
      if (membership[id]) item.scope = membership[id];
      if (copies[id]) item.copyOf = copies[id].sourceId;
      out.push(item);
    }
  }
  return out;
}

export function selectTagged(files: LoadedFile[], overrides: Record<string, Partial<Tags>>): TaggedPattern[] {
  return selectInstances(files, overrides);
}

/** Ids of all instances of successfully parsed files, in panel order. */
export function instanceIds(files: LoadedFile[], copies: Record<string, { sourceId: string }>): string[] {
  const bySource = copiesBySource(copies);
  return files.flatMap((f) => (f.result.ok ? [f.id, ...(bySource.get(f.id) ?? [])] : []));
}

export interface GroupView {
  key: string;
  label: string;
  tags: Tags;
  items: TaggedPattern[];
  customId?: string;
  /** The label was built by `core/grouping.ts` from fixed-vocabulary tag values, and the group has no user-given name (see `isGeneratedLabel`). Exports skip the formula guard for it. */
  generatedLabel?: true;
}

export function groupPatterns(tagged: TaggedPattern[]): GroupView[] {
  const groups = new Map<string, GroupView>();
  for (const item of tagged) {
    const key = groupKey(item.tags);
    let g = groups.get(key);
    if (!g) {
      g = { key, label: groupLabel(item.tags), tags: fullTags(item.tags), items: [], ...(isGeneratedLabel(item.tags) ? { generatedLabel: true as const } : {}) };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.items.sort(
      (a, b) => a.pattern.frequencyMHz - b.pattern.frequencyMHz || a.pattern.fileName.localeCompare(b.pattern.fileName),
    );
  }
  // Locale collation would put "-45" before "+45", so compare polarization by code point.
  return list.sort((a, b) => {
    if (a.key === UNGROUPED) return 1;
    if (b.key === UNGROUPED) return -1;
    const pa = a.tags.polarization ?? '~';
    const pb = b.tags.polarization ?? '~';
    if (pa !== pb) return pa < pb ? -1 : 1;
    const ta = a.tags.tiltDeg ?? Infinity;
    const tb = b.tags.tiltDeg ?? Infinity;
    if (ta !== tb) return ta - tb;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}

/** Custom groups first (their members only), then the automatic groups of everything else. */
export function buildPanelGroups(tagged: TaggedPattern[], customGroups: CustomGroup[]): GroupView[] {
  const known = new Set(customGroups.map((g) => g.id));
  const custom: GroupView[] = customGroups.map((g) => ({
    key: `custom:${g.id}`,
    label: g.name,
    tags: {},
    items: tagged.filter((i) => i.scope === g.id),
    customId: g.id,
  }));
  return [...custom, ...groupPatterns(tagged.filter((i) => !i.scope || !known.has(i.scope)))];
}

export interface ErrorEntry {
  id: string;
  path: string;
  error: string;
  line?: number;
}

export function selectErrors(files: LoadedFile[]): ErrorEntry[] {
  return files.flatMap((f) =>
    f.result.ok
      ? []
      : [{ id: f.id, path: f.path, error: f.result.error, ...(f.result.line !== undefined ? { line: f.result.line } : {}) }],
  );
}

export function selectWarnings(files: LoadedFile[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) if (f.result.ok && f.result.warnings.length) out.set(f.id, f.result.warnings.map((w) => w.message));
  return out;
}

/** Warnings for an instance: `warnings` is keyed by path, so a copy resolves to its source's warnings. */
export function warningsFor(
  id: string,
  warnings: Map<string, string[]>,
  copies: Record<string, { sourceId: string }>,
): string[] | undefined {
  return warnings.get(copies[id]?.sourceId ?? id);
}
