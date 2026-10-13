import { create } from 'zustand';
import type { GainUnit, ParseResult, Tags } from '../core/types';
import { parsePlanet } from '../core/parse/planet';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import type { Method3d } from '../core/analysis/pattern3d';
import type { HCutMode } from '../core/analysis/tilt';
import type { SubBand } from '../core/analysis/subBands';
import { clampFloor } from '../core/analysis/settingLimits';
import { decodeText } from './decode';
import { isPatternFile, type FileInput } from './files';
import { chromeOf, openedMessage, projectToState, type ProjectFile } from './project';
import { isCleanLoad, loadSummary, planLoad, type PendingFile } from './duplicates';
import { changesSession, markOf, takeSnapshot, type SavedMark, type UndoEntry } from './undo';
import { uniqueGroupName } from './groupNames';
import type { TableColumn } from './metricKeys';
import { clampSim, SIM_LIMITS, type OffsetState, type SimulationKey } from './simLimits';

export { clampSim, SIM_LIMITS };
export type { OffsetState, SimulationKey };

export type CutView = 'H' | 'V' | 'both';
export type PlotMode = 'polar' | 'rect';
export type MarkerKey = 'hpbw' | 'fb' | 'usls' | 'null' | 'peak' | 'sector';
export type Dimension = '2d' | '3d';
export type Layout3d = 'grid' | 'overlay';

export interface SimulationState {
  electricalDeg: number;
  mechanicalDeg: number;
  azimuthDeg: number;
  showOriginal: boolean;
  /** Which horizontal cut a tilted file shows: through the tilted beam peak (the default), or at the horizon. */
  hCut: HCutMode;
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

export type ColumnGroupKey = 'beam' | 'fb' | 'sidelobes' | 'sector' | 'declared' | 'are';
export const DEFAULT_TABLE_GROUPS: Record<ColumnGroupKey, boolean> =
  { beam: true, fb: true, sidelobes: true, sector: true, declared: false, are: false };

export interface CollapsedBars {
  simBar: boolean;
  markers: boolean;
}

/** Phone-width screens start with the marker options folded so the plots come first. */
function narrowScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
}

export interface ViewState {
  cut: CutView;
  mode: PlotMode;
  gainUnit: GainUnit;
  theme: 'light' | 'dark';
  floorDb: number;
  markers: Record<MarkerKey, boolean>;
  tableGroups: Record<ColumnGroupKey, boolean>;
  /** User-defined band-statistics sub-bands; empty = automatic. */
  subBands: SubBand[];
  dimension: Dimension;
  method3d: Method3d;
  layout3d: Layout3d;
  /** Secondary controls folded to one line. */
  collapsed: CollapsedBars;
  /** The 2D difference view: the metrics table shows each value as the difference from the reference file (saved with the project; inactive while no reference is set). */
  deltaVsReference: boolean;
  /** The metric the frequency chart plots (a display preference, like the theme: not saved in projects). */
  freqMetric: TableColumn;
  /** The metrics table (and its Copy table and CSV) lists only the ticked files and the reference (a display preference: not saved in projects). */
  tableTickedOnly: boolean;
  simulation: SimulationState;
}

export type DialogState =
  | { kind: 'confirm'; message: string; confirmLabel: string }
  | { kind: 'prompt'; message: string; initial: string; confirmLabel: string; hint?: string }
  | { kind: 'save-project' }
  | { kind: 'choice'; message: string; choices: { value: string; label: string }[] }
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
  /** 'info' for a load where every file simply loaded (the line goes away by itself), else 'warn'. */
  loadTone: 'info' | 'warn';
  /** How many files failed to parse in the load `loadMessage` describes (drives its "Show" button). */
  loadFailed: number;
  /** Counts every status message, so an identical one is still a change (re-announced, fade timer restarted). */
  loadSeq: number;
  /** A transient line about a copy ("Copied 65.0"). Separate from the load status so a copy never costs a standing warning. Not part of undo, saved projects or the unsaved-work check. */
  copyNote: string | null;
  /** Counts every copy note, so an identical one is re-announced and restarts the fade. */
  copySeq: number;
  /** The last destructive action's snapshot: offered in a toast for a short time, then available to Ctrl/Cmd+Z until a later edit withdraws it. */
  undo: UndoEntry | null;
  /** The saveable state as of the last Save project / Open project; null = never saved. See undo.ts `isDirty`. */
  saved: SavedMark | null;
  /** Copy id (`path#copy-n`) → its source path, in insertion order. */
  copies: Record<string, { sourceId: string }>;
  /** Instance id → display name (renames). */
  names: Record<string, string>;
  customGroups: CustomGroup[];
  /** Instance id → custom group id. */
  membership: Record<string, string>;
  /** The instance id pinned as the reference file (session data, saved in projects); null = none. */
  reference: string | null;
  /** What the offsets row edits: a file (also the highlighted file) or a custom group. */
  selected: Selection;
  /** Files a layout-only project still needs (see project.ts and duplicates.ts `planLoad`). */
  pendingFiles: PendingFile[];
  /** The open in-page dialog, if any (its promise lives in ui/dialogs.ts). */
  dialog: DialogState;
}

export interface AddFilesOptions {
  /** Files the browser failed to read before they reached the store. */
  unreadable?: number;
  /** Keep the undo offered by the project that was just opened (its pattern files arrive right after). */
  keepUndo?: boolean;
  /**
   * Name of the project that was opened together with this selection: the status line then starts with
   * "Opened the project <name>", and pattern files that the project already held (skipped) are not reported as a problem.
   */
  openedProject?: string;
  /** Something else the status line should say about this selection (e.g. project files left unopened). */
  note?: string;
  /** The note is a plain information, not a problem: the line keeps the calm tone and fades out by itself. */
  noteIsInfo?: boolean;
}

export interface StoreActions {
  addFiles(inputs: FileInput[], options?: AddFilesOptions): void;
  undoLast(): void;
  /** Remove the offer and its snapshot (the toast's ✕). */
  dismissUndo(): void;
  /** The toast fades; the snapshot stays for Ctrl/Cmd+Z. */
  fadeUndo(): void;
  markSaved(): void;
  /** Replaces the session with a project; with `name` (the project file's name) the status line says it was opened. */
  loadProject(project: ProjectFile, name?: string): void;
  dismissPending(): void;
  openDialog(dialog: NonNullable<DialogState>): void;
  closeDialog(): void;
  removeFile(id: string): void;
  clear(): void;
  setTags(id: string, tags: Partial<Tags>): void;
  toggleVisible(id: string): void;
  setVisible(ids: string[], visible: boolean): void;
  /**
   * Ticks exactly `ids` and unticks every other file in one step (Show all / none / only the matches), and offers
   * an undo labelled `label`. Nothing changes, and nothing is offered, when the ticks already are exactly these.
   */
  setVisibleOnly(ids: string[], label: string): void;
  setHighlighted(id: string | null): void;
  updateSettings(partial: Partial<AnalysisSettings>): void;
  updateView(partial: Partial<ViewState>): void;
  /** Back to automatic sub-bands: the user's are dropped, and an undo is offered (they are typed work). Nothing changes when there are none. */
  dropSubBands(): void;
  setLoadMessage(message: string | null, tone?: 'info' | 'warn'): void;
  /** Shows a transient copy line (it fades by itself after COPY_NOTE_MS); the load status is left alone. */
  setCopyNote(message: string | null): void;
  updateSimulation(partial: Partial<SimulationState>): void;
  resetSimulation(scope?: 'sliders' | 'all'): void;
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
  /** Pins file `id` as the reference (null clears it, and with it the difference view); an unknown id changes nothing. */
  setReference(id: string | null): void;
  select(selection: Selection): void;
  /**
   * A click on a file in the panel or the table: ticks it and highlights it; clicking the highlighted,
   * ticked file again clears the highlight.
   */
  pickFile(id: string): void;
  /** Clears the highlight and the selection (Esc). */
  clearHighlight(): void;
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
    loadTone: 'info',
    loadFailed: 0,
    loadSeq: 0,
    copyNote: null,
    copySeq: 0,
    undo: null,
    saved: null,
    copies: {},
    names: {},
    customGroups: [],
    membership: {},
    selected: null,
    reference: null,
    pendingFiles: [],
    dialog: null,
    view: {
      cut: 'both',
      mode: 'polar',
      gainUnit: 'dBd',
      theme: prefersDark() ? 'dark' : 'light',
      floorDb: 40,
      markers: { hpbw: true, fb: false, usls: false, null: false, peak: true, sector: false },
      tableGroups: { ...DEFAULT_TABLE_GROUPS },
      subBands: [],
      dimension: '2d',
      method3d: 'summation',
      layout3d: 'grid',
      // The simulation bar starts folded everywhere (its one-line summary says what is set); it opens by itself with a project whose simulation is active.
      collapsed: { simBar: true, markers: narrowScreen() },
      freqMetric: 'hHpbw',
      tableTickedOnly: false,
      deltaVsReference: false,
      simulation: {
        electricalDeg: 0,
        mechanicalDeg: 0,
        azimuthDeg: 0,
        showOriginal: true,
        hCut: 'beam',
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

/** `file` as the entry `id` at `path` (a pending match or a duplicate's number moved it). */
function placedAs(file: LoadedFile, id: string, path: string): LoadedFile {
  if (file.id === id && file.path === path) return file;
  const r = file.result;
  return {
    id,
    path,
    text: file.text,
    result: r.ok ? { ...r, pattern: { ...r.pattern, id, fileName: baseName(path) } } : r,
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

/** How long a copy line stays. */
export const COPY_NOTE_MS = 6_000;
let copyTimer: ReturnType<typeof setTimeout> | undefined;

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

let undoSeq = 0;
/** The `undo` field for an action about to change `s`: its snapshot, labelled for the toast. */
const undoEntry = (s: StoreData, label: string, name?: string): { undo: UndoEntry } => ({
  undo: { id: ++undoSeq, label, ...(name ? { name } : {}), snapshot: takeSnapshot(s), shown: true },
});

/** Whether every value of `partial` is already what `current` holds (an update that changes nothing). */
const sameValues = <T extends object>(current: T, partial: Partial<T>): boolean =>
  (Object.keys(partial) as (keyof T)[]).every((k) => Object.is(current[k], partial[k]));

const ZERO_OFFSET: OffsetState = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
const isZeroOffset = (o: OffsetState) => o.electricalDeg === 0 && o.mechanicalDeg === 0 && o.azimuthDeg === 0;

type State = StoreData & StoreActions;

let sessionSwaps = 0;
/**
 * How many times a whole session was put on screen (project opened, undo applied, session cleared). Those bring their own
 * settings and view; a subscriber that sees this number change knows the change was not the user's own.
 */
export const sessionSwapCount = (): number => sessionSwaps;

let fileSetSwaps = 0;
/**
 * How many times the set of loaded files was replaced as a whole (project opened, session cleared, an undo that brings
 * other files back). Display-only state of the file list (filter text, folded groups) is reset on these, not on an undo
 * that only restores names, tags or visibility.
 */
export const fileSetSwapCount = (): number => fileSetSwaps;
const sameFileSet = (a: StoreData, b: Pick<StoreData, 'files' | 'pendingFiles' | 'copies'>): boolean => {
  const key = (x: Pick<StoreData, 'files' | 'pendingFiles' | 'copies'>) =>
    JSON.stringify([x.files.map((f) => f.id), x.pendingFiles.map((p) => p.path), Object.keys(x.copies)]);
  return key(a) === key(b);
};
type Update = State | Partial<State>;

export const useStore = create<State>()((rawSet, get) => {
  /**
   * Every action updates the store through here. An undo that is on offer restores a snapshot of
   * the whole session, so any later change to session data or to the view would be thrown away by
   * it: such a change withdraws the offer, unless the action sets `undo` itself.
   */
  const set = (update: Update | ((state: State) => Update)): void =>
    rawSet((state) => {
      const patch = typeof update === 'function' ? update(state) : update;
      if (patch === state || !state.undo || 'undo' in patch || !changesSession(state, patch)) return patch;
      return { ...patch, undo: null };
    });

  return {
  ...initialState(),

  addFiles: (inputs, options = {}) =>
    set((state) => {
      const unreadable = options.unreadable ?? 0;
      const note = options.note ? [options.note] : [];
      const parsed = inputs
        .filter((input) => isPatternFile(input.path))
        .map((input) => loadText(input.path, decodeText(input.bytes)));
      if (parsed.length === 0) {
        const nothing = unreadable > 0 ? `Could not read ${unreadable} file(s)` : 'No .msi/.pln/.txt files found in the selection';
        return {
          loadFailed: 0,
          loadTone: 'warn',
          loadMessage: note.length > 0 && unreadable === 0 ? note[0] : [nothing, ...note].join(' · '),
        };
      }
      const plan = planLoad(
        state.files.map((f) => ({ id: f.id, path: f.path, text: f.text, ok: f.result.ok })),
        state.pendingFiles,
        parsed.map((f) => ({ path: f.path, text: f.text, ok: f.result.ok })),
      );
      const counts = { ...plan.counts, unreadable };
      // Files the opened project already held are not a finding: the project opening is the news.
      const onlyHeld =
        options.openedProject !== undefined && counts.skipped > 0 && counts.loaded === 0 && counts.failed === 0 && counts.unreadable === 0 && counts.renamed === 0;
      const summary = onlyHeld ? [] : [loadSummary(counts)];
      const filesAfter = state.files.length + plan.add.filter((a) => a.replaces === undefined).length;
      const report: Partial<StoreData> = {
        loadFailed: counts.failed,
        loadTone: (onlyHeld || isCleanLoad(counts)) && (note.length === 0 || options.noteIsInfo) ? 'info' : 'warn',
        loadMessage: [...(options.openedProject !== undefined ? [openedMessage(options.openedProject, filesAfter, plan.pending.length)] : []), ...summary, ...note].join(' · '),
      };
      if (plan.add.length === 0) return report;

      const files = [...state.files];
      const added: LoadedFile[] = [];
      const matched = new Set<string>();
      for (const a of plan.add) {
        const file = placedAs(parsed[a.index], a.id, a.path);
        const at = a.replaces === undefined ? -1 : files.findIndex((f) => f.id === a.replaces);
        if (at >= 0) files[at] = file;
        else files.push(file);
        added.push(file);
        if (a.matched) matched.add(a.id);
      }
      const next: Partial<StoreData> = { ...report, files };
      if (plan.pending.length !== state.pendingFiles.length) next.pendingFiles = plan.pending;
      if (options.keepUndo) next.undo = state.undo;
      // Matched files keep the visibility/selection saved in the project.
      const firstOk = added.find((f) => f.result.ok && !matched.has(f.id));
      if (!firstOk) return next;
      return {
        ...next,
        visible: { ...state.visible, [firstOk.id]: true },
        highlighted: firstOk.id,
        selected: { kind: 'file', id: firstOk.id },
      };
    }),

  undoLast: () =>
    set((s) => {
      if (!s.undo) return s;
      sessionSwaps++;
      const { snapshot } = s.undo;
      if (!sameFileSet(s, snapshot)) fileSetSwaps++;
      // The theme and the fold state are display preferences, not part of the session being restored.
      return { ...snapshot, view: { ...snapshot.view, ...chromeOf(s.view) }, undo: null, loadMessage: null, loadFailed: 0 };
    }),

  dismissUndo: () => set({ undo: null }),

  fadeUndo: () => set((s) => (s.undo?.shown ? { undo: { ...s.undo, shown: false } } : s)),

  markSaved: () => set((s) => ({ saved: markOf(s) })),

  loadProject: (project, name) =>
    set((s) => {
      sessionSwaps++;
      fileSetSwaps++;
      const next = projectToState(project, initialState(), chromeOf(s.view), loadText);
      const hadSession = s.files.length > 0 || s.pendingFiles.length > 0;
      const opened = name === undefined ? null : openedMessage(name, next.files?.length ?? 0, next.pendingFiles?.length ?? 0);
      const message = [opened, next.loadMessage].filter(Boolean).join(' · ');
      return {
        ...next,
        saved: markOf({ ...s, ...next }),
        loadFailed: 0,
        loadMessage: message || null,
        ...(message ? { loadTone: 'info' as const, loadSeq: s.loadSeq + 1 } : {}),
        ...(hadSession ? undoEntry(s, 'Replaced the session with the project') : { undo: null }),
      };
    }),

  // What the project was still waiting for goes with the waiting list: copies of those files, their per-file state,
  // and a reference to any of them (the difference view goes with the reference). So does the state kept under the
  // pending paths themselves (names, tags, ticks, membership, offsets): it must not be saved into the next project,
  // and a file loaded later under such a path starts from the defaults.
  dismissPending: () =>
    set((s) => {
      if (s.pendingFiles.length === 0) return s;
      const loaded = (id: string) => s.files.some((f) => f.id === id && f.result.ok);
      const orphans = Object.keys(s.copies).filter((c) => !loaded(s.copies[c].sourceId));
      const refGone = s.reference !== null && !loaded(s.reference) && !(s.copies[s.reference] && !orphans.includes(s.reference));
      const stalePaths = s.pendingFiles.map((p) => p.path).filter((p) => !s.files.some((f) => f.id === p));
      const gone = [...new Set([...orphans, ...stalePaths])];
      const hasState = (x: string) =>
        x in s.names || x in s.tagOverrides || x in s.visible || x in s.membership || x in s.view.simulation.offsets;
      if (!gone.some(hasState) && orphans.length === 0 && !refGone) return { pendingFiles: [] };
      const d = draftOf(s);
      for (const x of gone) {
        delete d.copies[x];
        delete d.names[x];
        delete d.tagOverrides[x];
        delete d.visible[x];
        delete d.membership[x];
        delete d.offsets[x];
      }
      const next = commit(s, d);
      return {
        ...next,
        pendingFiles: [],
        highlighted: s.highlighted !== null && gone.includes(s.highlighted) ? null : s.highlighted,
        selected: s.selected?.kind === 'file' && gone.includes(s.selected.id) ? null : s.selected,
        ...(refGone ? { reference: null, view: { ...next.view!, deltaVsReference: false } } : {}),
      };
    }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  removeFile: (id) =>
    set((s) => {
      const file = s.files.find((f) => f.id === id);
      if (!s.copies[id] && !file) return s;
      const isCopy = !!s.copies[id];
      const ids = isCopy ? [id] : [id, ...Object.keys(s.copies).filter((c) => s.copies[c].sourceId === id)];
      const removedName = s.names[id] ?? baseName(file?.path ?? id);
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
        ...(s.reference !== null && ids.includes(s.reference) ? { reference: null, view: { ...commit(s, d).view!, deltaVsReference: false } } : {}),
        selected: s.selected?.kind === 'file' && ids.includes(s.selected.id) ? null : s.selected,
        // The status line may be about the file that just went: do not leave a stale count behind.
        ...(isCopy ? {} : { loadMessage: null, loadFailed: 0 }),
        ...undoEntry(s, `Removed ${removedName}${ids.length > 1 ? ' and its copies' : ''}`, removedName),
      };
    }),

  clear: () =>
    set((s) => {
      sessionSwaps++;
      fileSetSwaps++;
      return {
        ...(s.files.length > 0 || s.pendingFiles.length > 0
          ? undoEntry(s, s.files.length === 0 ? 'Cleared the session' : `Cleared ${s.files.length} file${s.files.length === 1 ? '' : 's'}`)
          : { undo: null }),
        loadFailed: 0,
        saved: null,
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
        reference: null,
        pendingFiles: [],
        // The user's sub-bands were made for the files that go: the next session starts with automatic ones. So were the
        // simulation and the horizontal cut chosen: the next files start as their files are (the undo brings all of it back).
        // The 3D method and "Show original" are display choices and stay.
        view: {
          ...s.view,
          deltaVsReference: false,
          subBands: [],
          simulation: { ...s.view.simulation, electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0, hCut: 'beam', offsets: {}, groupOffsets: {} },
        },
      };
    }),

  setTags: (id, tags) =>
    set((state) => {
      const current = state.tagOverrides[id];
      // Nothing to change when every given tag is already overridden to that value (and `{}` changes
      // nothing). A key counts only when it is present: an override with `undefined` clears an inferred tag.
      const held = current ?? {};
      if ((Object.keys(tags) as (keyof Tags)[]).every((k) => Object.prototype.hasOwnProperty.call(held, k) && Object.is(held[k], tags[k]))) return state;
      return { tagOverrides: { ...state.tagOverrides, [id]: { ...current, ...tags } } };
    }),

  toggleVisible: (id) => set((state) => ({ visible: { ...state.visible, [id]: !state.visible[id] } })),

  setVisible: (ids, visible) =>
    set((state) => {
      if (ids.every((id) => !!state.visible[id] === visible)) return state;
      const next = { ...state.visible };
      for (const id of ids) next[id] = visible;
      return { visible: next };
    }),

  setVisibleOnly: (ids, label) =>
    set((state) => {
      const wanted = new Set(ids);
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(state.visible)) next[k] = false;
      for (const id of wanted) next[id] = true;
      const same = [...new Set([...Object.keys(state.visible), ...wanted])].every((k) => !!state.visible[k] === wanted.has(k));
      return same ? state : { visible: next, ...undoEntry(state, label) };
    }),

  setHighlighted: (id) => set({ highlighted: id, selected: id ? { kind: 'file', id } : null }),

  updateSettings: (partial) =>
    set((state) => {
      if (sameValues(state.settings, partial)) return state;
      const settings = { ...state.settings, ...partial };
      // The plot floor stays beyond the level ring: a higher level lifts it.
      const floorDb = clampFloor(state.view.floorDb, settings.levelDb);
      return floorDb !== null && floorDb !== state.view.floorDb ? { settings, view: { ...state.view, floorDb } } : { settings };
    }),

  updateView: (partial) => set((state) => (sameValues(state.view, partial) ? state : { view: { ...state.view, ...partial } })),

  dropSubBands: () =>
    set((state) => {
      const n = state.view.subBands.length;
      if (n === 0) return state;
      return { ...undoEntry(state, n === 1 ? 'Dropped your sub-band' : `Dropped your ${n} sub-bands`), view: { ...state.view, subBands: [] } };
    }),

  setLoadMessage: (message, tone = 'warn') =>
    set((s) => ({ loadMessage: message, loadTone: tone, loadSeq: s.loadSeq + 1, ...(tone === 'info' && message !== null ? {} : { loadFailed: 0 }) })),

  // A copy has its own line and fade: the standing load status (and its "Show errors" button) is not touched.
  setCopyNote: (message) => {
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    copyTimer = undefined;
    set((s) => ({ copyNote: message, copySeq: s.copySeq + 1 }));
    if (message !== null) {
      const seq = useStore.getState().copySeq;
      copyTimer = setTimeout(() => {
        copyTimer = undefined;
        if (useStore.getState().copySeq === seq) useStore.setState({ copyNote: null });
      }, COPY_NOTE_MS);
    }
  },

  updateSimulation: (partial) =>
    set((state) => {
      const next = { ...state.view.simulation, ...partial };
      for (const key of Object.keys(SIM_LIMITS) as SimulationKey[]) next[key] = clampSim(key, next[key]);
      // A field that commits its unchanged value on blur must not count as an edit.
      if (sameValues(state.view.simulation, next)) return state;
      return { view: { ...state.view, simulation: next } };
    }),

  resetSimulation: (scope = 'all') =>
    set((state) => {
      const sim = state.view.simulation;
      const hasOffsets = Object.keys(sim.offsets).length > 0 || Object.keys(sim.groupOffsets).length > 0;
      if (isZeroOffset(sim) && !(scope === 'all' && (hasOffsets || sim.hCut !== 'beam'))) return state;
      return {
        // Whatever the reset takes (slider values, offsets, the cut at the horizon) can be put back: the usual offer and Ctrl/Cmd+Z.
        ...undoEntry(state, scope === 'all' ? 'Reset the simulation' : 'Reset the sliders'),
        view: {
          ...state.view,
          simulation: {
            ...sim,
            electricalDeg: 0,
            mechanicalDeg: 0,
            azimuthDeg: 0,
            // "Reset everything" also puts the horizontal cut back to the one through the beam peak.
            ...(scope === 'all' ? { offsets: {}, groupOffsets: {}, hCut: 'beam' as const } : {}),
          },
        },
      };
    }),

  setOffset: (id, partial) =>
    set((state) => {
      const cur = state.view.simulation.offsets[id] ?? ZERO_OFFSET;
      const next = { ...cur, ...partial };
      for (const key of Object.keys(SIM_LIMITS) as SimulationKey[]) next[key] = clampSim(key, next[key]);
      if (sameValues(cur, next)) return state;
      const offsets = { ...state.view.simulation.offsets };
      if (next.electricalDeg === 0 && next.mechanicalDeg === 0 && next.azimuthDeg === 0) delete offsets[id];
      else offsets[id] = next;
      return withOffsets(state, offsets);
    }),

  clearOffsets: (id) =>
    set((state) => (state.view.simulation.offsets[id] ? withOffsets(state, without(state.view.simulation.offsets, id)) : state)),

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
      const trimmed = name.trim();
      if (!instanceExists(s, id) || (s.names[id] ?? '') === trimmed) return s;
      const names = { ...s.names };
      if (trimmed) names[id] = trimmed;
      else delete names[id];
      return { names };
    }),

  createGroup: (name) => {
    const s = get();
    const id = nextGroupId(s.customGroups);
    const label = name?.trim() ? uniqueGroupName(s.customGroups, name.trim()) : nextGroupName(s.customGroups, 'Group');
    set({ customGroups: [...s.customGroups, { id, name: label }] });
    return id;
  },

  renameGroup: (id, name) =>
    set((s) => {
      const trimmed = name.trim();
      const group = s.customGroups.find((g) => g.id === id);
      if (!trimmed || !group || group.name === trimmed) return s;
      const name2 = uniqueGroupName(s.customGroups, trimmed, id);
      if (group.name === name2) return s;
      return { customGroups: s.customGroups.map((g) => (g.id === id ? { ...g, name: name2 } : g)) };
    }),

  deleteGroup: (id) =>
    set((s) => {
      const group = s.customGroups.find((g) => g.id === id);
      if (!group) return s;
      const d = draftOf(s);
      d.customGroups = d.customGroups.filter((g) => g.id !== id);
      for (const k of Object.keys(d.membership)) if (d.membership[k] === id) delete d.membership[k];
      delete d.groupOffsets[id];
      return {
        ...commit(s, d),
        selected: s.selected?.kind === 'group' && s.selected.id === id ? null : s.selected,
        ...undoEntry(s, `Deleted group ${group.name}`, group.name),
      };
    }),

  duplicateGroup: (id) => {
    const s = get();
    const g = s.customGroups.find((x) => x.id === id);
    if (!g) return null;
    const d = draftOf(s);
    const newId = nextGroupId(d.customGroups);
    d.customGroups.push({ id: newId, name: uniqueGroupName(d.customGroups, `${g.name} (copy)`) });
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
      if (groupId && !s.customGroups.some((g) => g.id === groupId)) return s;
      if ((s.membership[id] ?? null) === (groupId || null)) return s;
      const membership = { ...s.membership };
      if (groupId) membership[id] = groupId;
      else delete membership[id];
      return { membership };
    }),

  setGroupOffset: (groupId, partial) =>
    set((s) => {
      if (!s.customGroups.some((g) => g.id === groupId)) return s;
      const cur = s.view.simulation.groupOffsets[groupId] ?? ZERO_OFFSET;
      const next = { ...cur, ...partial };
      for (const key of Object.keys(SIM_LIMITS) as SimulationKey[]) next[key] = clampSim(key, next[key]);
      if (sameValues(cur, next)) return s;
      const groupOffsets = { ...s.view.simulation.groupOffsets };
      if (isZeroOffset(next)) delete groupOffsets[groupId];
      else groupOffsets[groupId] = next;
      return { view: { ...s.view, simulation: { ...s.view.simulation, groupOffsets } } };
    }),

  clearGroupOffsets: (groupId) =>
    set((s) =>
      s.view.simulation.groupOffsets[groupId]
        ? { view: { ...s.view, simulation: { ...s.view.simulation, groupOffsets: without(s.view.simulation.groupOffsets, groupId) } } }
        : s,
    ),

  setReference: (id) =>
    set((s) => {
      if (id === s.reference) return s;
      if (id !== null && !instanceExists(s, id)) return s;
      return { reference: id, ...(id === null && s.view.deltaVsReference ? { view: { ...s.view, deltaVsReference: false } } : {}) };
    }),

  select: (selection) =>
    set(selection?.kind === 'file' ? { selected: selection, highlighted: selection.id } : { selected: selection }),

  pickFile: (id) =>
    set((s) => {
      if (s.highlighted === id && s.visible[id]) return { highlighted: null, selected: null };
      return { visible: s.visible[id] ? s.visible : { ...s.visible, [id]: true }, highlighted: id, selected: { kind: 'file', id } };
    }),

  clearHighlight: () => set((s) => (s.highlighted === null && s.selected === null ? s : { highlighted: null, selected: null })),

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
  };
});
