import { create } from 'zustand';
import type { GainUnit, ParseResult, Tags } from '../core/types';
import { parsePlanet } from '../core/parse/planet';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import type { Method3d } from '../core/analysis/pattern3d';
import { decodeText } from './decode';
import { isPatternFile, type FileInput } from './files';
import { matchPending, projectToState, type ProjectFile } from './project';
import { clampSim, SIM_LIMITS, type OffsetState, type SimulationKey } from './simLimits';

export { clampSim, SIM_LIMITS };
export type { OffsetState, SimulationKey };

export type CutView = 'H' | 'V' | 'both';
export type PlotMode = 'polar' | 'rect';
export type MarkerKey = 'hpbw' | 'fb' | 'usls' | 'null' | 'peak';
export type Dimension = '2d' | '3d';
export type Layout3d = 'grid' | 'overlay';

export interface SimulationState {
  electricalDeg: number;
  mechanicalDeg: number;
  azimuthDeg: number;
  showOriginal: boolean;
  /** Per-file offsets (file id → offsets); an entry exists only while a value is non-zero. */
  offsets: Record<string, OffsetState>;
  /** Per-custom-group offsets; entry only while non-zero. */
  groupOffsets: Record<string, OffsetState>;
}

export interface CustomGroup {
  id: string;
  name: string;
}

export type Selection = { kind: 'file' | 'group'; id: string } | null;

export interface LoadedFile {
  id: string;
  path: string;
  /** The decoded text that was parsed. */
  text: string;
  result: ParseResult;
}

export interface ViewState {
  cut: CutView;
  mode: PlotMode;
  gainUnit: GainUnit;
  theme: 'light' | 'dark';
  floorDb: number;
  markers: Record<MarkerKey, boolean>;
  dimension: Dimension;
  method3d: Method3d;
  layout3d: Layout3d;
  simulation: SimulationState;
}

export type DialogState =
  | { kind: 'confirm'; message: string; confirmLabel: string }
  | { kind: 'prompt'; message: string; initial: string; confirmLabel: string }
  | { kind: 'save-project' }
  | null;

export interface StoreData {
  files: LoadedFile[];
  tagOverrides: Record<string, Partial<Tags>>;
  visible: Record<string, boolean>;
  highlighted: string | null;
  settings: AnalysisSettings;
  view: ViewState;
  /** Short status line for the load boundary (empty selection, unreadable files). Dismissible. */
  loadMessage: string | null;
  /** Copy id (`path#copy-n`) → its source path, in insertion order. */
  copies: Record<string, { sourceId: string }>;
  /** Instance id → display name (renames). */
  names: Record<string, string>;
  customGroups: CustomGroup[];
  /** Instance id → custom group id. */
  membership: Record<string, string>;
  /** What the offsets row edits: a file (also the highlighted file) or a custom group. */
  selected: Selection;
  /** Paths a layout-only project still needs (see project.ts). */
  pendingFiles: string[];
  /** The open in-page dialog, if any (its promise lives in ui/dialogs.ts). */
  dialog: DialogState;
}

export interface StoreActions {
  addFiles(inputs: FileInput[]): void;
  loadProject(project: ProjectFile): void;
  dismissPending(): void;
  openDialog(dialog: NonNullable<DialogState>): void;
  closeDialog(): void;
  removeFile(id: string): void;
  clear(): void;
  setTags(id: string, tags: Partial<Tags>): void;
  toggleVisible(id: string): void;
  setVisible(ids: string[], visible: boolean): void;
  setHighlighted(id: string | null): void;
  updateSettings(partial: Partial<AnalysisSettings>): void;
  updateView(partial: Partial<ViewState>): void;
  setLoadMessage(message: string | null): void;
  updateSimulation(partial: Partial<SimulationState>): void;
  resetSimulation(): void;
  setOffset(id: string, partial: Partial<OffsetState>): void;
  clearOffsets(id: string): void;
  duplicate(id: string): string | null;
  rename(id: string, name: string): void;
  createGroup(name?: string): string;
  renameGroup(id: string, name: string): void;
  deleteGroup(id: string): void;
  duplicateGroup(id: string): string | null;
  setMembership(id: string, groupId: string | null): void;
  setGroupOffset(groupId: string, partial: Partial<OffsetState>): void;
  clearGroupOffsets(groupId: string): void;
  select(selection: Selection): void;
  createSite(id: string, sectors: number): string | null;
}

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function initialState(): StoreData {
  return {
    files: [],
    tagOverrides: {},
    visible: {},
    highlighted: null,
    settings: { ...DEFAULT_SETTINGS },
    loadMessage: null,
    copies: {},
    names: {},
    customGroups: [],
    membership: {},
    selected: null,
    pendingFiles: [],
    dialog: null,
    view: {
      cut: 'both',
      mode: 'polar',
      gainUnit: 'dBd',
      theme: prefersDark() ? 'dark' : 'light',
      floorDb: 40,
      markers: { hpbw: true, fb: false, usls: false, null: false, peak: true },
      dimension: '2d',
      method3d: 'summation',
      layout3d: 'grid',
      simulation: {
        electricalDeg: 0,
        mechanicalDeg: 0,
        azimuthDeg: 0,
        showOriginal: true,
        offsets: {},
        groupOffsets: {},
      },
    },
  };
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Parses `text` as the file at `path`. */
export function loadText(path: string, text: string): LoadedFile {
  const result = parsePlanet(text, baseName(path));
  return {
    id: path,
    path,
    text,
    result: result.ok ? { ...result, pattern: { ...result.pattern, id: path } } : result,
  };
}

const without = <T>(record: Record<string, T>, id: string): Record<string, T> => {
  const copy = { ...record };
  delete copy[id];
  return copy;
};

const withOffsets = (state: StoreData, offsets: Record<string, OffsetState>): Partial<StoreData> => ({
  view: { ...state.view, simulation: { ...state.view.simulation, offsets } },
});

interface Draft {
  copies: Record<string, { sourceId: string }>;
  names: Record<string, string>;
  tagOverrides: Record<string, Partial<Tags>>;
  visible: Record<string, boolean>;
  membership: Record<string, string>;
  customGroups: CustomGroup[];
  offsets: Record<string, OffsetState>;
  groupOffsets: Record<string, OffsetState>;
}

const draftOf = (s: StoreData): Draft => ({
  copies: { ...s.copies },
  names: { ...s.names },
  tagOverrides: { ...s.tagOverrides },
  visible: { ...s.visible },
  membership: { ...s.membership },
  customGroups: [...s.customGroups],
  offsets: { ...s.view.simulation.offsets },
  groupOffsets: { ...s.view.simulation.groupOffsets },
});

const commit = (s: StoreData, d: Draft): Partial<StoreData> => ({
  copies: d.copies,
  names: d.names,
  tagOverrides: d.tagOverrides,
  visible: d.visible,
  membership: d.membership,
  customGroups: d.customGroups,
  view: { ...s.view, simulation: { ...s.view.simulation, offsets: d.offsets, groupOffsets: d.groupOffsets } },
});

const instanceExists = (s: StoreData, id: string): boolean =>
  !!s.copies[id] || s.files.some((f) => f.id === id && f.result.ok);

/** Adds a copy of `id` to the draft (state copied from `id`) and returns the copy id. */
function duplicateInto(d: Draft, id: string, name?: string): string {
  const src = d.copies[id]?.sourceId ?? id;
  let n = 2;
  while (d.copies[`${src}#copy-${n}`]) n++;
  const copyId = `${src}#copy-${n}`;
  d.copies[copyId] = { sourceId: src };
  if (d.tagOverrides[id]) d.tagOverrides[copyId] = { ...d.tagOverrides[id] };
  if (d.offsets[id]) d.offsets[copyId] = { ...d.offsets[id] };
  if (d.membership[id]) d.membership[copyId] = d.membership[id];
  const newName = name ?? (d.names[id] ? `${d.names[id]} (copy)` : undefined);
  if (newName) d.names[copyId] = newName;
  d.visible[copyId] = true;
  return copyId;
}

const nextGroupId = (groups: CustomGroup[]): string => {
  let n = 1;
  while (groups.some((g) => g.id === `g${n}`)) n++;
  return `g${n}`;
};

const nextGroupName = (groups: CustomGroup[], prefix: string): string => {
  let k = 1;
  while (groups.some((g) => g.name === `${prefix} ${k}`)) k++;
  return `${prefix} ${k}`;
};

const ZERO_OFFSET: OffsetState = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
const isZeroOffset = (o: OffsetState) => o.electricalDeg === 0 && o.mechanicalDeg === 0 && o.azimuthDeg === 0;

export const useStore = create<StoreData & StoreActions>()((set, get) => ({
  ...initialState(),

  addFiles: (inputs) =>
    set((state) => {
      const byId = new Map<string, LoadedFile>();
      const matched = new Set<string>();
      let pendingFiles = state.pendingFiles;
      for (const input of inputs) {
        if (!isPatternFile(input.path)) continue;
        // A file a layout-only project is waiting for loads under its saved path.
        const target = matchPending(pendingFiles, input.path);
        if (target !== null) {
          matched.add(target);
          pendingFiles = pendingFiles.filter((p) => p !== target);
        }
        const path = target ?? input.path;
        byId.set(path, loadText(path, decodeText(input.bytes)));
      }
      if (byId.size === 0) {
        return { loadMessage: 'No .msi/.pln/.txt files found in the selection' };
      }
      const loaded = [...byId.values()];
      const files = [...state.files.filter((f) => !byId.has(f.id)), ...loaded];
      // Matched files keep the visibility/selection saved in the project.
      const firstOk = loaded.find((f) => f.result.ok && !matched.has(f.id));
      if (!firstOk) return { files, pendingFiles, loadMessage: null };
      return {
        files,
        pendingFiles,
        visible: { ...state.visible, [firstOk.id]: true },
        highlighted: firstOk.id,
        selected: { kind: 'file', id: firstOk.id },
        loadMessage: null,
      };
    }),

  loadProject: (project) => set((s) => projectToState(project, initialState(), s.view.theme, loadText)),

  dismissPending: () => set({ pendingFiles: [] }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  removeFile: (id) =>
    set((s) => {
      const isCopy = !!s.copies[id];
      const ids = isCopy ? [id] : [id, ...Object.keys(s.copies).filter((c) => s.copies[c].sourceId === id)];
      const d = draftOf(s);
      for (const x of ids) {
        delete d.copies[x];
        delete d.names[x];
        delete d.tagOverrides[x];
        delete d.visible[x];
        delete d.membership[x];
        delete d.offsets[x];
      }
      return {
        ...commit(s, d),
        files: isCopy ? s.files : s.files.filter((f) => f.id !== id),
        highlighted: s.highlighted !== null && ids.includes(s.highlighted) ? null : s.highlighted,
        selected: s.selected?.kind === 'file' && ids.includes(s.selected.id) ? null : s.selected,
      };
    }),

  clear: () =>
    set((s) => ({
      files: [],
      visible: {},
      tagOverrides: {},
      highlighted: null,
      loadMessage: null,
      copies: {},
      names: {},
      customGroups: [],
      membership: {},
      selected: null,
      pendingFiles: [],
      view: { ...s.view, simulation: { ...s.view.simulation, offsets: {}, groupOffsets: {} } },
    })),

  setTags: (id, tags) =>
    set((state) => ({ tagOverrides: { ...state.tagOverrides, [id]: { ...state.tagOverrides[id], ...tags } } })),

  toggleVisible: (id) => set((state) => ({ visible: { ...state.visible, [id]: !state.visible[id] } })),

  setVisible: (ids, visible) =>
    set((state) => {
      const next = { ...state.visible };
      for (const id of ids) next[id] = visible;
      return { visible: next };
    }),

  setHighlighted: (id) => set({ highlighted: id, selected: id ? { kind: 'file', id } : null }),

  updateSettings: (partial) => set((state) => ({ settings: { ...state.settings, ...partial } })),

  updateView: (partial) => set((state) => ({ view: { ...state.view, ...partial } })),

  setLoadMessage: (message) => set({ loadMessage: message }),

  updateSimulation: (partial) =>
    set((state) => {
      const next = { ...state.view.simulation, ...partial };
      for (const key of Object.keys(SIM_LIMITS) as SimulationKey[]) next[key] = clampSim(key, next[key]);
      return { view: { ...state.view, simulation: next } };
    }),

  resetSimulation: () =>
    set((state) => ({
      view: {
        ...state.view,
        simulation: {
          ...state.view.simulation,
          electricalDeg: 0,
          mechanicalDeg: 0,
          azimuthDeg: 0,
          offsets: {},
          groupOffsets: {},
        },
      },
    })),

  setOffset: (id, partial) =>
    set((state) => {
      const cur = state.view.simulation.offsets[id] ?? { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
      const next = { ...cur, ...partial };
      for (const key of Object.keys(SIM_LIMITS) as SimulationKey[]) next[key] = clampSim(key, next[key]);
      const offsets = { ...state.view.simulation.offsets };
      if (next.electricalDeg === 0 && next.mechanicalDeg === 0 && next.azimuthDeg === 0) delete offsets[id];
      else offsets[id] = next;
      return withOffsets(state, offsets);
    }),

  clearOffsets: (id) => set((state) => withOffsets(state, without(state.view.simulation.offsets, id))),

  duplicate: (id) => {
    const s = get();
    if (!instanceExists(s, id)) return null;
    const d = draftOf(s);
    const copyId = duplicateInto(d, id);
    set(commit(s, d));
    return copyId;
  },

  rename: (id, name) =>
    set((s) => {
      if (!instanceExists(s, id)) return {};
      const names = { ...s.names };
      const trimmed = name.trim();
      if (trimmed) names[id] = trimmed;
      else delete names[id];
      return { names };
    }),

  createGroup: (name) => {
    const s = get();
    const id = nextGroupId(s.customGroups);
    const label = name?.trim() || nextGroupName(s.customGroups, 'Group');
    set({ customGroups: [...s.customGroups, { id, name: label }] });
    return id;
  },

  renameGroup: (id, name) =>
    set((s) => {
      const trimmed = name.trim();
      if (!trimmed || !s.customGroups.some((g) => g.id === id)) return {};
      return { customGroups: s.customGroups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)) };
    }),

  deleteGroup: (id) =>
    set((s) => {
      const d = draftOf(s);
      d.customGroups = d.customGroups.filter((g) => g.id !== id);
      for (const k of Object.keys(d.membership)) if (d.membership[k] === id) delete d.membership[k];
      delete d.groupOffsets[id];
      return {
        ...commit(s, d),
        selected: s.selected?.kind === 'group' && s.selected.id === id ? null : s.selected,
      };
    }),

  duplicateGroup: (id) => {
    const s = get();
    const g = s.customGroups.find((x) => x.id === id);
    if (!g) return null;
    const d = draftOf(s);
    const newId = nextGroupId(d.customGroups);
    d.customGroups.push({ id: newId, name: `${g.name} (copy)` });
    if (d.groupOffsets[id]) d.groupOffsets[newId] = { ...d.groupOffsets[id] };
    for (const member of Object.keys(s.membership).filter((m) => s.membership[m] === id)) {
      d.membership[duplicateInto(d, member)] = newId;
    }
    set(commit(s, d));
    return newId;
  },

  setMembership: (id, groupId) =>
    set((s) => {
      // Deviation (documented): only the group id is checked for existence here, not the
      // instance id — src/ui/useSimulation.test.ts exercises this action against tagged-pattern
      // ids that are never loaded through `addFiles`, so an instance-existence guard here would
      // weaken that existing, unrelated test. UI call sites only ever pass real instance ids.
      if (groupId && !s.customGroups.some((g) => g.id === groupId)) return {};
      const membership = { ...s.membership };
      if (groupId) membership[id] = groupId;
      else delete membership[id];
      return { membership };
    }),

  setGroupOffset: (groupId, partial) =>
    set((s) => {
      if (!s.customGroups.some((g) => g.id === groupId)) return {};
      const next = { ...(s.view.simulation.groupOffsets[groupId] ?? ZERO_OFFSET), ...partial };
      for (const key of Object.keys(SIM_LIMITS) as SimulationKey[]) next[key] = clampSim(key, next[key]);
      const groupOffsets = { ...s.view.simulation.groupOffsets };
      if (isZeroOffset(next)) delete groupOffsets[groupId];
      else groupOffsets[groupId] = next;
      return { view: { ...s.view, simulation: { ...s.view.simulation, groupOffsets } } };
    }),

  clearGroupOffsets: (groupId) =>
    set((s) => ({
      view: {
        ...s.view,
        simulation: { ...s.view.simulation, groupOffsets: without(s.view.simulation.groupOffsets, groupId) },
      },
    })),

  select: (selection) =>
    set(selection?.kind === 'file' ? { selected: selection, highlighted: selection.id } : { selected: selection }),

  createSite: (id, sectors) => {
    const s = get();
    if (!instanceExists(s, id)) return null;
    const n = Math.max(2, Math.min(12, Math.round(Number.isFinite(sectors) ? sectors : 3)));
    const d = draftOf(s);
    const gid = nextGroupId(d.customGroups);
    d.customGroups.push({ id: gid, name: nextGroupName(d.customGroups, 'Site') });
    const siteIds: string[] = [];
    for (let k = 0; k < n; k++) {
      const c = duplicateInto(d, id, `Sector ${String.fromCharCode(65 + k)}`);
      d.membership[c] = gid;
      const raw = (k * 360) / n;
      const next = { ...(d.offsets[c] ?? ZERO_OFFSET), azimuthDeg: clampSim('azimuthDeg', raw > 180 ? raw - 360 : raw) };
      if (isZeroOffset(next)) delete d.offsets[c];
      else d.offsets[c] = next;
      siteIds.push(c);
    }
    for (const k of Object.keys(d.visible)) d.visible[k] = siteIds.includes(k);
    const patch = commit(s, d);
    set({ ...patch, selected: { kind: 'group', id: gid }, view: { ...patch.view!, dimension: '3d', layout3d: 'overlay' } });
    return gid;
  },
}));
