import type { Tags } from '../core/types';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import { clampSim, type OffsetState } from './simLimits';
import type { CustomGroup, LoadedFile, Selection, SimulationState, StoreData, ViewState } from './store';

export const PROJECT_FORMAT = 'lobe-story-project';
export const PROJECT_VERSION = 1;

export interface ProjectFileEntry {
  path: string;
  /** The file's decoded text; absent in layout-only projects. */
  text?: string;
}

export interface ProjectState {
  tagOverrides: Record<string, Partial<Tags>>;
  visible: Record<string, boolean>;
  copies: Record<string, { sourceId: string }>;
  names: Record<string, string>;
  customGroups: CustomGroup[];
  membership: Record<string, string>;
  highlighted: string | null;
  selected: Selection;
  settings: AnalysisSettings;
  view: Omit<ViewState, 'theme'>;
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

/** The session as a project file. The theme is never saved. */
export function serializeProject(s: StoreData, includeFiles: boolean, now: Date = new Date()): string {
  const view: Partial<ViewState> = { ...s.view };
  delete view.theme;
  const project: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: now.toISOString(),
    files: [
      ...s.files.map((f) => (includeFiles ? { path: f.path, text: f.text } : { path: f.path })),
      ...s.pendingFiles.map((path) => ({ path })),
    ],
    state: {
      tagOverrides: s.tagOverrides,
      visible: s.visible,
      copies: s.copies,
      names: s.names,
      customGroups: s.customGroups,
      membership: s.membership,
      highlighted: s.highlighted,
      selected: s.selected,
      settings: s.settings,
      view: view as Omit<ViewState, 'theme'>,
    },
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

  const files: ProjectFileEntry[] = (raw.files as Record<string, unknown>[]).map((f) =>
    typeof f.text === 'string' ? { path: f.path as string, text: f.text } : { path: f.path as string },
  );
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

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const SETTING_MAX: Record<keyof AnalysisSettings, number> = {
  levelDb: 100,
  fbWindowDeg: 360,
  uslsRangeDeg: 360,
  nullSearchDeg: 360,
  trackingWindowDeg: 360,
};

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

/**
 * The store state for a parsed project: files with text are parsed with `loadText`, files without
 * become `pendingFiles`; every part is sanitised against `defaults`; the theme is the caller's.
 */
export function projectToState(
  project: ProjectFile,
  defaults: StoreData,
  theme: ViewState['theme'],
  loadText: (path: string, text: string) => LoadedFile,
): Partial<StoreData> {
  const files: LoadedFile[] = [];
  const pendingFiles: string[] = [];
  const seen = new Set<string>();
  for (const f of project.files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    if (typeof f.text === 'string') files.push(loadText(f.path, f.text));
    else pendingFiles.push(f.path);
  }

  const st = project.state;
  const customGroups = st.customGroups ?? [];
  const groupIds = new Set(customGroups.map((g) => g.id));
  const membership: Record<string, string> = {};
  for (const [id, gid] of Object.entries(st.membership ?? {})) {
    if (typeof gid === 'string' && groupIds.has(gid)) membership[id] = gid;
  }

  const rawView: Record<string, unknown> = isObj(st.view) ? (st.view as Record<string, unknown>) : {};
  const rawSim: Record<string, unknown> = isObj(rawView.simulation) ? rawView.simulation : {};
  const rawMarkers: Record<string, unknown> = isObj(rawView.markers) ? rawView.markers : {};
  const dv = defaults.view;

  const markers = { ...dv.markers };
  for (const k of Object.keys(markers) as (keyof typeof markers)[]) {
    if (typeof rawMarkers[k] === 'boolean') markers[k] = rawMarkers[k] as boolean;
  }

  const simulation: SimulationState = {
    electricalDeg: clampSim('electricalDeg', num(rawSim.electricalDeg, 0)),
    mechanicalDeg: clampSim('mechanicalDeg', num(rawSim.mechanicalDeg, 0)),
    azimuthDeg: clampSim('azimuthDeg', num(rawSim.azimuthDeg, 0)),
    showOriginal: typeof rawSim.showOriginal === 'boolean' ? rawSim.showOriginal : true,
    offsets: cleanOffsets(rawSim.offsets, () => true),
    groupOffsets: cleanOffsets(rawSim.groupOffsets, (id) => groupIds.has(id)),
  };

  const rawSettings: Record<string, unknown> = isObj(st.settings) ? (st.settings as unknown as Record<string, unknown>) : {};
  const settings: AnalysisSettings = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(settings) as (keyof AnalysisSettings)[]) {
    const v = rawSettings[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= SETTING_MAX[k]) settings[k] = v;
  }

  const floor = num(rawView.floorDb, dv.floorDb);
  const selected = st.selected && st.selected.kind === 'group' && !groupIds.has(st.selected.id) ? null : (st.selected ?? null);

  return {
    files,
    pendingFiles,
    tagOverrides: cleanTagOverrides(st.tagOverrides),
    visible: cleanMap(st.visible, (v): v is boolean => typeof v === 'boolean'),
    copies: cleanCopies(st.copies),
    names: cleanMap(st.names, (v): v is string => typeof v === 'string' && v !== ''),
    customGroups,
    membership,
    highlighted: st.highlighted ?? null,
    selected,
    settings,
    loadMessage: null,
    view: {
      cut: oneOf(rawView.cut, ['H', 'V', 'both'] as const, dv.cut),
      mode: oneOf(rawView.mode, ['polar', 'rect'] as const, dv.mode),
      gainUnit: oneOf(rawView.gainUnit, ['dBd', 'dBi'] as const, dv.gainUnit),
      theme,
      floorDb: floor > 0 ? floor : dv.floorDb,
      markers,
      dimension: oneOf(rawView.dimension, ['2d', '3d'] as const, dv.dimension),
      method3d: oneOf(rawView.method3d, ['summation', 'weighted'] as const, dv.method3d),
      layout3d: oneOf(rawView.layout3d, ['grid', 'overlay'] as const, dv.layout3d),
      simulation,
    },
  };
}

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** The pending path an incoming file satisfies: exact path, else the only pending path with the same file name. */
export function matchPending(pending: string[], incomingPath: string): string | null {
  if (pending.includes(incomingPath)) return incomingPath;
  const name = fileNameOf(incomingPath);
  const byName = pending.filter((p) => fileNameOf(p) === name);
  return byName.length === 1 ? byName[0] : null;
}

export function pendingLabel(pending: string[]): string {
  const names = pending.map(fileNameOf);
  const more = names.length > 5 ? ` and ${names.length - 5} more` : '';
  return `${names.length} pattern file${names.length === 1 ? '' : 's'} needed: ${names.slice(0, 5).join(', ')}${more}`;
}
