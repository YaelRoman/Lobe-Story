import { uniqueGroupName } from './groupNames';
import type { Tags } from '../core/types';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import { clampFloor, clampSetting, FLOOR_LIMITS } from '../core/analysis/settingLimits';
import { sanitizeSubBands } from '../core/analysis/subBands';
import { HORIZON_LEVEL_KEY, METRIC_KEYS, type TableColumn } from './metricKeys';
import { clampSim, type OffsetState } from './simLimits';
import { fingerprint, isFingerprint, type PendingFile } from './duplicates';
import type { BandCompare, CustomGroup, LoadedFile, Selection, SimulationState, StoreData, ViewState } from './store';
import { settingText } from '../core/fixed';

export const PROJECT_FORMAT = 'lobe-story-project';
export const PROJECT_VERSION = 1;

export interface ProjectFileEntry {
  path: string;
  /** The file's decoded text; absent in layout-only projects. */
  text?: string;
  /**
   * Content fingerprint (see duplicates.ts `fingerprint`), so a layout-only project recognises its
   * files by content, not only by name. Optional: projects saved before it existed have none.
   */
  fp?: string;
}

/** View fields that are display chrome: remembered per browser (prefs.ts), never saved in a project and never unsaved work. */
export type ChromeKey = 'theme' | 'collapsed' | 'freqMetric' | 'tableTickedOnly';
export const CHROME_KEYS: readonly ChromeKey[] = ['theme', 'collapsed', 'freqMetric', 'tableTickedOnly'];

/** The display-chrome part of a view: what opening a project or applying an undo leaves as it is. */
export const chromeOf = (v: Pick<ViewState, ChromeKey>): Pick<ViewState, ChromeKey> => ({
  theme: v.theme,
  collapsed: v.collapsed,
  freqMetric: v.freqMetric,
  tableTickedOnly: v.tableTickedOnly,
});

export interface ProjectState {
  tagOverrides: Record<string, Partial<Tags>>;
  visible: Record<string, boolean>;
  copies: Record<string, { sourceId: string }>;
  names: Record<string, string>;
  customGroups: CustomGroup[];
  membership: Record<string, string>;
  highlighted: string | null;
  selected: Selection;
  /** The pinned reference file (instance id). Optional: projects saved before it existed have none. */
  reference: string | null;
  settings: AnalysisSettings;
  view: Omit<ViewState, ChromeKey>;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  files: ProjectFileEntry[];
  state: Partial<ProjectState>;
}

export type ParsedProject = { ok: true; project: ProjectFile } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type SessionSource = Pick<
  StoreData,
  'files' | 'pendingFiles' | 'tagOverrides' | 'visible' | 'copies' | 'names' | 'customGroups' | 'membership' | 'reference' | 'settings' | 'view'
>;

/**
 * The files a project lists. A failed file that shares its path with a loaded one (id `path#failed`)
 * is not saved, and neither is a failed file on a path a pending entry still waits for: the pending
 * entry (with its fingerprint) is the one that stays, so a path is never listed twice.
 */
const savedFiles = (files: LoadedFile[], pending: PendingFile[]): LoadedFile[] =>
  files.filter((f) => f.id === f.path && (f.result.ok || !pending.some((p) => p.path === f.path)));

const pendingEntry = (p: PendingFile): PendingFile => (p.fp !== undefined ? { path: p.path, fp: p.fp } : { path: p.path });

/** The files a project lists: path and content fingerprint of every loaded and still-pending file. */
export function sessionFiles(s: Pick<StoreData, 'files' | 'pendingFiles'>): PendingFile[] {
  return [...savedFiles(s.files, s.pendingFiles).map((f) => ({ path: f.path, fp: fingerprint(f.text) })), ...s.pendingFiles.map(pendingEntry)];
}

/**
 * The work a project file keeps, apart from the file list and from what is only "where the user
 * was looking" (highlight, selection) and display chrome (theme, folded bars). `serializeProject` writes exactly this, and
 * unsaved-work tracking (undo.ts) compares exactly this, so the two cannot drift apart.
 */
export function sessionState(s: SessionSource): Omit<ProjectState, 'highlighted' | 'selected'> {
  const view: Partial<ViewState> = { ...s.view };
  for (const k of CHROME_KEYS) delete view[k];
  return {
    tagOverrides: s.tagOverrides,
    visible: s.visible,
    copies: s.copies,
    names: s.names,
    customGroups: s.customGroups,
    membership: s.membership,
    reference: s.reference,
    settings: s.settings,
    view: view as Omit<ViewState, ChromeKey>,
  };
}

/** The session as a project file. The theme and the fold state are never saved. */
export function serializeProject(s: StoreData, includeFiles: boolean, now: Date = new Date()): string {
  const project: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: now.toISOString(),
    files: [
      ...savedFiles(s.files, s.pendingFiles).map((f) => ({ path: f.path, ...(includeFiles ? { text: f.text } : {}), fp: fingerprint(f.text) })),
      ...s.pendingFiles.map(pendingEntry),
    ],
    state: { ...sessionState(s), highlighted: s.highlighted, selected: s.selected },
  };
  return JSON.stringify(project);
}

/** Validates the envelope and takes each state part only if it has the expected basic shape. */
export function parseProject(text: string): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!isObj(raw) || raw.format !== PROJECT_FORMAT) return { ok: false, error: 'Not a Lobe-Story project.' };
  if (typeof raw.version !== 'number' || raw.version > PROJECT_VERSION) {
    return { ok: false, error: 'This project was saved by a newer version of the app.' };
  }
  if (!Array.isArray(raw.files) || !raw.files.every((f) => isObj(f) && typeof f.path === 'string')) {
    return { ok: false, error: 'The project file is damaged (files).' };
  }
  if (!isObj(raw.state)) return { ok: false, error: 'The project file is damaged (state).' };

  const files: ProjectFileEntry[] = (raw.files as Record<string, unknown>[]).map((f) => ({
    path: f.path as string,
    ...(typeof f.text === 'string' ? { text: f.text } : {}),
    ...(isFingerprint(f.fp) ? { fp: f.fp } : {}),
  }));
  const st = raw.state;
  const state: Partial<ProjectState> = {};
  if (isObj(st.tagOverrides)) state.tagOverrides = st.tagOverrides as ProjectState['tagOverrides'];
  if (isObj(st.visible)) state.visible = st.visible as ProjectState['visible'];
  if (isObj(st.copies)) state.copies = st.copies as ProjectState['copies'];
  if (isObj(st.names)) state.names = st.names as ProjectState['names'];
  if (isObj(st.membership)) state.membership = st.membership as ProjectState['membership'];
  if (Array.isArray(st.customGroups)) {
    state.customGroups = st.customGroups.filter(
      (g): g is CustomGroup => isObj(g) && typeof g.id === 'string' && typeof g.name === 'string',
    );
  }
  if (typeof st.reference === 'string' || st.reference === null) state.reference = st.reference;
  if (typeof st.highlighted === 'string' || st.highlighted === null) state.highlighted = st.highlighted;
  const sel = st.selected;
  if (sel === null) state.selected = null;
  else if (isObj(sel) && (sel.kind === 'file' || sel.kind === 'group') && typeof sel.id === 'string') {
    state.selected = { kind: sel.kind, id: sel.id };
  }
  if (isObj(st.settings)) state.settings = st.settings as unknown as AnalysisSettings;
  if (isObj(st.view)) state.view = st.view as unknown as ProjectState['view'];
  return {
    ok: true,
    project: {
      format: PROJECT_FORMAT,
      version: raw.version,
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
      files,
      state,
    },
  };
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

function cleanMap<T>(raw: unknown, ok: (v: unknown) => v is T): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (ok(v)) out[k] = v;
  return out;
}

function cleanCopies(raw: unknown): Record<string, { sourceId: string }> {
  const out: Record<string, { sourceId: string }> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (isObj(v) && typeof v.sourceId === 'string') out[k] = { sourceId: v.sourceId };
  }
  return out;
}

function cleanTagOverrides(raw: unknown): Record<string, Partial<Tags>> {
  const out: Record<string, Partial<Tags>> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    const t: Partial<Tags> = {};
    if (typeof v.polarization === 'string') t.polarization = v.polarization;
    if (typeof v.port === 'string') t.port = v.port;
    if (typeof v.array === 'string') t.array = v.array;
    if (typeof v.tiltDeg === 'number' && Number.isFinite(v.tiltDeg)) t.tiltDeg = v.tiltDeg;
    out[k] = t;
  }
  return out;
}

function cleanOffsets(raw: unknown, keep: (id: string) => boolean): Record<string, OffsetState> {
  const out: Record<string, OffsetState> = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!isObj(v) || !keep(id)) continue;
    const o: OffsetState = {
      electricalDeg: clampSim('electricalDeg', num(v.electricalDeg, 0)),
      mechanicalDeg: clampSim('mechanicalDeg', num(v.mechanicalDeg, 0)),
      azimuthDeg: clampSim('azimuthDeg', num(v.azimuthDeg, 0)),
    };
    if (o.electricalDeg !== 0 || o.mechanicalDeg !== 0 || o.azimuthDeg !== 0) out[id] = o;
  }
  return out;
}

/** The analysis settings of a stored object: every field validated by its limits, else the default. */
export function sanitizeSettings(raw: unknown): AnalysisSettings {
  const rawSettings: Record<string, unknown> = isObj(raw) ? raw : {};
  const settings: AnalysisSettings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(settings) as (keyof AnalysisSettings)[]) {
    const v = rawSettings[k];
    if (typeof v === 'number') {
      const ok = clampSetting(k, v);
      if (ok !== null) settings[k] = ok;
    }
  }
  if (rawSettings.sectorEdgeDeg === undefined) {
    const legacy = rawSettings.trackingWindowDeg;
    const ok = typeof legacy === 'number' ? clampSetting('sectorEdgeDeg', legacy) : null;
    if (ok !== null) settings.sectorEdgeDeg = ok;
  }
  return settings;
}

/** The metric of a stored object, or `fallback` when it is neither a metric column nor the Horizon level. */
export const sanitizeMetric = (v: unknown, fallback: TableColumn): TableColumn =>
  (METRIC_KEYS as readonly unknown[]).includes(v) || v === HORIZON_LEVEL_KEY ? (v as TableColumn) : fallback;

/** Two different dataset keys, or null (a comparison that cannot be read is no comparison). */
function sanitizeBandCompare(raw: unknown): BandCompare | null {
  if (!isObj(raw)) return null;
  const { a, b } = raw;
  return typeof a === 'string' && typeof b === 'string' && a !== b ? { a, b } : null;
}

/** The display part of the view (everything but the theme and the simulation) of a stored object; bad or missing values take `dv`'s. */
export function sanitizeDisplayView(rawView: Record<string, unknown>, dv: ViewState): Omit<ViewState, 'theme' | 'simulation' | 'freqMetric' | 'tableTickedOnly'> {
  const rawMarkers: Record<string, unknown> = isObj(rawView.markers) ? rawView.markers : {};
  const rawGroups: Record<string, unknown> = isObj(rawView.tableGroups) ? rawView.tableGroups : {};
  const markers = { ...dv.markers };
  for (const k of Object.keys(markers) as (keyof typeof markers)[]) {
    if (typeof rawMarkers[k] === 'boolean') markers[k] = rawMarkers[k] as boolean;
  }
  const tableGroups = { ...dv.tableGroups };
  for (const k of Object.keys(tableGroups) as (keyof typeof tableGroups)[]) {
    if (typeof rawGroups[k] === 'boolean') tableGroups[k] = rawGroups[k] as boolean;
  }
  const rawCollapsed: Record<string, unknown> = isObj(rawView.collapsed) ? rawView.collapsed : {};
  const collapsed = { ...dv.collapsed };
  for (const k of Object.keys(collapsed) as (keyof typeof collapsed)[]) {
    if (typeof rawCollapsed[k] === 'boolean') collapsed[k] = rawCollapsed[k] as boolean;
  }
  const floor = num(rawView.floorDb, dv.floorDb);
  return {
    collapsed,
    cut: oneOf(rawView.cut, ['H', 'V', 'both'] as const, dv.cut),
    mode: oneOf(rawView.mode, ['polar', 'rect'] as const, dv.mode),
    gainUnit: oneOf(rawView.gainUnit, ['dBd', 'dBi'] as const, dv.gainUnit),
    floorDb: floor >= FLOOR_LIMITS.min && floor <= FLOOR_LIMITS.max ? floor : dv.floorDb,
    markers,
    tableGroups,
    subBands: sanitizeSubBands(rawView.subBands),
    bandCompare: sanitizeBandCompare(rawView.bandCompare),
    deltaVsReference: typeof rawView.deltaVsReference === 'boolean' ? rawView.deltaVsReference : dv.deltaVsReference,
    dimension: oneOf(rawView.dimension, ['2d', '3d'] as const, dv.dimension),
    method3d: oneOf(rawView.method3d, ['summation', 'weighted'] as const, dv.method3d),
    layout3d: oneOf(rawView.layout3d, ['grid', 'overlay'] as const, dv.layout3d),
    compare3d: typeof rawView.compare3d === 'boolean' ? rawView.compare3d : dv.compare3d,
  };
}

/**
 * The store state for a parsed project: files with text are parsed with `loadText`, files without
 * become `pendingFiles`; every part is sanitised against `defaults`; the theme and the fold state (`chrome`) are the caller's.
 */
export function projectToState(
  project: ProjectFile,
  defaults: StoreData,
  chrome: Pick<ViewState, ChromeKey>,
  loadText: (path: string, text: string) => LoadedFile,
): Partial<StoreData> {
  const files: LoadedFile[] = [];
  const pendingFiles: PendingFile[] = [];
  const seen = new Set<string>();
  for (const f of project.files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    if (typeof f.text === 'string') files.push(loadText(f.path, f.text));
    // A fingerprint of the wrong shape (hand-edited file) is dropped: the entry then matches by name.
    else pendingFiles.push(isFingerprint(f.fp) ? { path: f.path, fp: f.fp } : { path: f.path });
  }

  const st = project.state;
  // Two groups with one name cannot be told apart in menus: a later one gets a suffix.
  const customGroups: CustomGroup[] = [];
  for (const g of st.customGroups ?? []) customGroups.push({ ...g, name: uniqueGroupName(customGroups, g.name) });
  const groupIds = new Set(customGroups.map((g) => g.id));
  const membership: Record<string, string> = {};
  for (const [id, gid] of Object.entries(st.membership ?? {})) {
    if (typeof gid === 'string' && groupIds.has(gid)) membership[id] = gid;
  }

  const rawView: Record<string, unknown> = isObj(st.view) ? (st.view as Record<string, unknown>) : {};
  const rawSim: Record<string, unknown> = isObj(rawView.simulation) ? rawView.simulation : {};
  const dv = defaults.view;

  const simulation: SimulationState = {
    electricalDeg: clampSim('electricalDeg', num(rawSim.electricalDeg, 0)),
    mechanicalDeg: clampSim('mechanicalDeg', num(rawSim.mechanicalDeg, 0)),
    azimuthDeg: clampSim('azimuthDeg', num(rawSim.azimuthDeg, 0)),
    showOriginal: typeof rawSim.showOriginal === 'boolean' ? rawSim.showOriginal : true,
    // A project saved before the choice existed has no such field: it shows the cut through the beam peak, as it did.
    hCut: oneOf(rawSim.hCut, ['beam', 'horizon'] as const, 'beam'),
    offsets: cleanOffsets(rawSim.offsets, () => true),
    groupOffsets: cleanOffsets(rawSim.groupOffsets, (id) => groupIds.has(id)),
  };

  const settings = sanitizeSettings(st.settings);

  // The reference must be a file or copy of this project (a pending file counts: it arrives later); anything else is dropped.
  const sources = new Set([...files.map((f) => f.id), ...pendingFiles.map((p) => p.path)]);
  const copies = cleanCopies(st.copies);
  const isInstance = (id: string): boolean => sources.has(id) || (copies[id] !== undefined && sources.has(copies[id].sourceId));
  const reference = typeof st.reference === 'string' && isInstance(st.reference) ? st.reference : null;
  const display = sanitizeDisplayView(rawView, dv);
  // The plot floor lies at least 1 dB beyond the beamwidth level, as in the settings panel.
  const floorDb = clampFloor(display.floorDb, settings.levelDb) ?? display.floorDb;
  const floorRaised = floorDb !== display.floorDb;

  const selected = st.selected && st.selected.kind === 'group' && !groupIds.has(st.selected.id) ? null : (st.selected ?? null);

  return {
    files,
    pendingFiles,
    tagOverrides: cleanTagOverrides(st.tagOverrides),
    visible: cleanMap(st.visible, (v): v is boolean => typeof v === 'boolean'),
    copies,
    names: cleanMap(st.names, (v): v is string => typeof v === 'string' && v !== ''),
    customGroups,
    membership,
    highlighted: st.highlighted ?? null,
    selected,
    reference,
    settings,
    loadMessage: floorRaised ? `Plot floor raised to ${settingText(floorDb)} dB: it must lie at least 1 dB beyond the ${settingText(settings.levelDb)} dB beamwidth level.` : null,
    view: {
      ...display,
      floorDb,
      deltaVsReference: reference !== null && display.deltaVsReference,
      ...chrome,
      // A project whose simulation is active opens with the bar unfolded, so what is simulated is in view.
      ...(simulationSet(simulation) ? { collapsed: { ...chrome.collapsed, simBar: false } } : {}),
      simulation,
    },
  };
}

/** True when any slider is off zero, any file or group has an offset, or the horizontal cut is the one at the horizon (every file then shows a reconstructed cut). */
export const simulationSet = (s: SimulationState): boolean =>
  s.electricalDeg !== 0 || s.mechanicalDeg !== 0 || s.azimuthDeg !== 0 || Object.keys(s.offsets).length > 0 || Object.keys(s.groupOffsets).length > 0 || s.hCut === 'horizon';

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const filesText = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;

/** The status line after Save project: the files written, and how many listed files are still missing (pending, no data to write). */
export const savedMessage = (fileName: string, fileCount: number, withPatternData: boolean, missing = 0): string =>
  `Saved ${fileName} (${filesText(fileCount)}, ${withPatternData ? 'with pattern data' : 'layout only'}${missing > 0 ? `, ${missing} still missing` : ''})`;

/** What Save project writes: the loaded files (with their data or just their fingerprint) and the pending ones it can only list. */
export function savedCounts(s: Pick<StoreData, 'files' | 'pendingFiles'>): { written: number; missing: number } {
  return { written: savedFiles(s.files, s.pendingFiles).length, missing: s.pendingFiles.length };
}

/** The status line after Open project: how many files the session now lists and how many are still to be supplied. */
export const openedMessage = (name: string, fileCount: number, missing: number): string =>
  `Opened project ${name}: ${filesText(fileCount)}${missing > 0 ? `, ${missing} still missing` : ''}`;

export function pendingLabel(pending: PendingFile[]): string {
  const names = pending.map((p) => fileNameOf(p.path));
  const more = names.length > 5 ? ` and ${names.length - 5} more` : '';
  return `${names.length} pattern file${names.length === 1 ? '' : 's'} needed: ${names.slice(0, 5).join(', ')}${more}`;
}
