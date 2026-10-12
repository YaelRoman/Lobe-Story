import type { HCutMode, SimSettings } from '../core/analysis/tilt';

/** A number with a true minus sign (U+2212), as the marker labels write it. */
const minus = (v: number): string => String(v).replace('-', '−');

/** The one-line state of a collapsed bar: the global values and how many per-file / group offsets are set. */
export function simSummary(
  g: { electricalDeg: number; mechanicalDeg: number; azimuthDeg: number },
  fileOffsets: number,
  groupOffsets: number,
  /** The 3D method, given only while it changes a number on screen (see `summaryMethod`). */
  method?: 'summation' | 'weighted',
  /** Which horizontal cut the simulated files show, given only while it is not simply the file cut (see `summaryHCut`). */
  hCut?: HCutMode,
): string {
  const parts = [`Tilt Δ ${minus(g.electricalDeg)}°`, `Mech ${minus(g.mechanicalDeg)}°`, `Az ${minus(g.azimuthDeg)}°`];
  if (fileOffsets > 0) parts.push(`${fileOffsets} file offset${fileOffsets === 1 ? '' : 's'}`);
  if (groupOffsets > 0) parts.push(`${groupOffsets} group offset${groupOffsets === 1 ? '' : 's'}`);
  if (method) parts.push(`3D method: ${method === 'weighted' ? 'Weighted' : 'Summation'}`);
  if (hCut) parts.push(`H cut: ${H_CUT_WHERE[hCut]}`);
  return parts.join(' · ');
}

const H_CUT_WHERE: Record<HCutMode, string> = { beam: 'through the beam peak', horizon: 'at the horizon' };

/** The choice of the simulated horizontal cut in words, as captions and notes name it. */
export const hCutLabel = (hCut: HCutMode): string => `horizontal cut ${H_CUT_WHERE[hCut]}`;

/** The line under the Horizontal cut control: what each choice shows. */
export const H_CUT_HINT =
  'Through the beam peak: the cut a data sheet gives. At the horizon: what each antenna radiates along the horizon (0° elevation), with or without a tilt.';

/** Added to the hint in the 3D view: the surface is drawn from the reconstruction itself, but the rest of the page follows the choice. */
export const H_CUT_3D_NOTE = 'The 3D view does not depend on this choice; the table, the frequency chart and the band statistics below do.';

/** What the status region says when the choice is switched: the plot, a table column and most horizontal cells change at once. */
export const hCutAnnouncement = (hCut: HCutMode): string =>
  hCut === 'horizon'
    ? 'Horizontal cut at the horizon: every file shows its horizon cut. Horizon level column added.'
    : 'Horizontal cut through the beam peak. Horizon level column removed.';

/**
 * Said wherever a horizon cut made with the Weighted method is shown: the rule weights the two cuts by each other's
 * level, which reshapes the cut as soon as the elevation cut is not at its peak (see docs/metrics.md).
 */
export const WEIGHTED_HORIZON_NOTE =
  'Weighted distorts the shape of a horizon cut (an artefact of its interpolation, not of the antenna): read its level, not its width. Summation is the reference for this cut.';

/** The note above, while the horizontal cut is the one at the horizon and the 3D method is Weighted. */
export const weightedHorizonNote = (hCut: HCutMode | undefined, method: 'summation' | 'weighted'): string | undefined =>
  hCut === 'horizon' && method === 'weighted' ? WEIGHTED_HORIZON_NOTE : undefined;

/**
 * The horizontal-cut choice for the collapsed bar's summary: the cut at the horizon always (every file shows it, tilted
 * or not), the cut through the beam peak only while a file is tilted (without a tilt it is the file cut).
 */
export const summaryHCut = (hCut: HCutMode, tiltActive: boolean): HCutMode | undefined => (tiltActive || hCut === 'horizon' ? hCut : undefined);

/**
 * The 3D method for the collapsed bar's summary, or undefined while it changes nothing on screen: it matters under a
 * tilt, for a horizon cut (read from the reconstruction, tilted or not), and while the angular-region estimate
 * (integrated over the reconstruction) is shown or plotted.
 */
export const summaryMethod = <M extends 'summation' | 'weighted'>(method: M, tiltActive: boolean, angularRegions: boolean, hCut: HCutMode = 'beam'): M | undefined =>
  tiltActive || angularRegions || hCut === 'horizon' ? method : undefined;

/**
 * What the note above the metrics table adds while the cut is at the horizon and no file is tilted: what a pair of
 * values in a cell is. (Under a tilt a pair is original → tilted, as everywhere.)
 */
export const simulatedNote = (horizonCut: boolean, tiltActive: boolean): string | undefined => (horizonCut && !tiltActive ? 'a → b: file cut → horizon cut' : undefined);

/** The simulation facts a caption or a file name needs (the parts of `SimulationResult` used, so it can be tested without hooks). */
export interface SimFacts {
  tiltActive: boolean;
  tilt: { electricalDeg: number; mechanicalDeg: number };
  azimuthDeg: number;
  offsetCount: number;
  groupOffsetCount: number;
  /**
   * Which horizontal cut the simulated files show: named in a caption while a tilt is active, and the cut at the
   * horizon also without one. Left out for a picture that does not depend on it (the vertical cut, the 3D view).
   */
  hCut?: HCutMode;
}

/** Whether the picture's files show a reconstructed cut: one is tilted, or the horizontal cut is the one at the horizon. */
const modelled = (s: SimFacts): boolean => s.tiltActive || s.hCut === 'horizon';

/** Whether any simulation is active: a tilt, an azimuth, an offset on a file or a group, or the horizontal cut at the horizon. */
export const simulationActive = (s: SimFacts): boolean => modelled(s) || s.azimuthDeg !== 0 || s.offsetCount > 0 || s.groupOffsetCount > 0;

/**
 * Whether something among the files `ids` (the ones a picture draws or an export lists) is simulated: one of them has
 * a non-zero effective tilt or azimuth (global values plus its own and its group's offsets). An offset on a file that
 * is not among them does not count. With `everyFile` (the horizontal cut at the horizon, in what shows it) any file is.
 */
export function anySimulated(effective: (id: string) => SimSettings, ids: Iterable<string>, everyFile = false): boolean {
  for (const id of ids) {
    if (everyFile) return true;
    const e = effective(id);
    if (e.electricalDeg !== 0 || e.mechanicalDeg !== 0 || e.azimuthDeg !== 0) return true;
  }
  return false;
}

/**
 * How many per-file and per-group offsets are set among the files `ids` (a file's own offset; a custom group counts
 * once when one of the files is a member and the group has an offset): what one picture shows, not the whole project.
 */
export function offsetCountsAmong(
  ids: Iterable<string>,
  fileOffsets: Record<string, unknown>,
  groupOffsets: Record<string, unknown>,
  membership: Record<string, string>,
): { files: number; groups: number } {
  let files = 0;
  const groups = new Set<string>();
  for (const id of ids) {
    if (fileOffsets[id]) files++;
    const gid = membership[id];
    if (gid && groupOffsets[gid]) groups.add(gid);
  }
  return { files, groups: groups.size };
}

/**
 * The caption line of an exported image while a simulation is active, else undefined:
 * "Simulated: electrical Δ 4°, mechanical 0°, azimuth 0°, summation method, horizontal cut at the horizon" (the method
 * and the horizontal cut only while they change the result: under a tilt, or for the cut at the horizon), plus the number of per-file and per-group offsets (those among the files the picture
 * shows when `counts` is given, see `offsetCountsAmong`; else all of the project's).
 */
export function simulatedCaption(s: SimFacts, method: 'summation' | 'weighted', counts?: { files: number; groups: number }): string | undefined {
  if (!simulationActive(s)) return undefined;
  const parts = [`electrical Δ ${minus(s.tilt.electricalDeg)}°`, `mechanical ${minus(s.tilt.mechanicalDeg)}°`, `azimuth ${minus(s.azimuthDeg)}°`];
  if (modelled(s)) parts.push(`${method} method`);
  if (modelled(s) && s.hCut) parts.push(hCutLabel(s.hCut));
  const files = counts?.files ?? s.offsetCount;
  const groups = counts?.groups ?? s.groupOffsetCount;
  const offsets = [
    files > 0 ? `${files} file${files === 1 ? '' : 's'}` : '',
    groups > 0 ? `${groups} group${groups === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `Simulated: ${parts.join(', ')}${offsets.length > 0 ? `; offsets on ${offsets.join(' and ')}` : ''}`;
}

/** An export file name, with `-simulated` before the extension while a simulation is active. */
export const exportName = (base: string, simulated: boolean, extension = ''): string => `${base}${simulated ? '-simulated' : ''}${extension}`;
