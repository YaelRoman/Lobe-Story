import type { HCutMode, SimSettings } from '../core/analysis/tilt';
import { methodFull, methodOfName, methodWords, type MethodName } from '../core/analysis/backHalf3d';

/** A number with a true minus sign (U+2212), as the marker labels write it. */
const minus = (v: number): string => String(v).replace('-', '−');

/** The one-line state of a collapsed bar: the global values and how many per-file / group offsets are set. */
export function simSummary(
  g: { electricalDeg: number; mechanicalDeg: number; azimuthDeg: number },
  fileOffsets: number,
  groupOffsets: number,
  /** The 3D method, given only while it changes a number on screen (see `summaryMethod`). */
  method?: MethodName,
  /** Which horizontal cut the simulated files show, given only while it is not simply the file cut (see `summaryHCut`). */
  hCut?: HCutMode,
): string {
  const parts = [`Tilt Δ ${minus(g.electricalDeg)}°`, `Mech ${minus(g.mechanicalDeg)}°`, `Az ${minus(g.azimuthDeg)}°`];
  if (fileOffsets > 0) parts.push(`${fileOffsets} file offset${fileOffsets === 1 ? '' : 's'}`);
  if (groupOffsets > 0) parts.push(`${groupOffsets} group offset${groupOffsets === 1 ? '' : 's'}`);
  if (method) parts.push(`3D method: ${methodFull(method)}`);
  if (hCut) parts.push(`H cut: ${H_CUT_WHERE[hCut]}`);
  return parts.join(' · ');
}

const H_CUT_WHERE: Record<HCutMode, string> = { beam: 'through the beam peak', horizon: 'at the horizon' };

/** The choice of the simulated horizontal cut in words, as captions and notes name it. */
export const hCutLabel = (hCut: HCutMode): string => `horizontal cut ${H_CUT_WHERE[hCut]}`;

/** The tooltip of "Use the back of the vertical cut", beside the 3D method (see docs/metrics.md). */
export const BACK_HALF_TITLE =
  'Behind the antenna, read the 3D reconstruction from the back half of the vertical cut instead of the azimuth cut alone, and make it one value straight up and straight down. Changes simulated F/B, the back of the 3D view, horizon cuts and the angular regions. Off: the numbers of earlier versions.';

/** Beside the 3D method control while it is disabled: what would enable it. */
export const METHOD_UNUSED_NOTE = 'Used by the 3D view, a tilt, the horizon cut and the angular regions; none of them is on.';

/** What can put the 3D method to use. */
export interface MethodUses {
  view3d: boolean;
  tilt: boolean;
  horizonCut: boolean;
  angularRegions: boolean;
}

/**
 * The line beside the 3D method control: the reason it is off, or what uses it now. One of the two is always true, so
 * the place it takes never has to come or go (which would move the bar under a slider that is being dragged).
 */
export function methodUseNote(u: MethodUses): string {
  const by = [u.view3d ? 'the 3D view' : '', u.tilt ? 'a tilt' : '', u.horizonCut ? 'the horizon cut' : '', u.angularRegions ? 'the angular regions' : ''].filter(Boolean);
  if (by.length === 0) return METHOD_UNUSED_NOTE;
  return `In use by ${by.length === 1 ? by[0] : `${by.slice(0, -1).join(', ')} and ${by[by.length - 1]}`}.`;
}

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
export const weightedHorizonNote = (hCut: HCutMode | undefined, method: MethodName): string | undefined =>
  hCut === 'horizon' && methodOfName(method) === 'weighted' ? WEIGHTED_HORIZON_NOTE : undefined;

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
export const summaryMethod = <M extends MethodName>(method: M, tiltActive: boolean, angularRegions: boolean, hCut: HCutMode = 'beam'): M | undefined =>
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

/** Whether any simulation is active: a tilt, an azimuth (which only turns the drawing), an offset on a file or a group, or the horizontal cut at the horizon. */
export const simulationActive = (s: SimFacts): boolean => modelled(s) || s.azimuthDeg !== 0 || s.offsetCount > 0 || s.groupOffsetCount > 0;

/**
 * Whether something among the files `ids` (the ones a picture draws or an export lists) is simulated: one of them has
 * a non-zero effective tilt or azimuth (global values plus its own and its group's offsets). An offset on a file that
 * is not among them does not count. With `everyFile` (the horizontal cut at the horizon, in what shows it) any file is.
 * The azimuth only turns the drawing of the horizontal cut and of the 3D view: with `turnCounts` false (the table, the
 * statistics, the frequency chart, the vertical cut: nothing in them turns) an azimuth alone is no simulation.
 */
export function anySimulated(effective: (id: string) => SimSettings, ids: Iterable<string>, everyFile = false, turnCounts = true): boolean {
  for (const id of ids) {
    if (everyFile) return true;
    const e = effective(id);
    if (e.electricalDeg !== 0 || e.mechanicalDeg !== 0 || (turnCounts && e.azimuthDeg !== 0)) return true;
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
 * A picture that is only turned (an azimuth, no tilt, not the cut at the horizon) is not called simulated:
 * "Turned on the plot: azimuth 20°. The metrics are not affected."
 */
export function simulatedCaption(s: SimFacts, method: MethodName, counts?: { files: number; groups: number }): string | undefined {
  if (!simulationActive(s)) return undefined;
  const offsetsText = (): string => {
    const files = counts?.files ?? s.offsetCount;
    const groups = counts?.groups ?? s.groupOffsetCount;
    const on = [files > 0 ? `${files} file${files === 1 ? '' : 's'}` : '', groups > 0 ? `${groups} group${groups === 1 ? '' : 's'}` : ''].filter(Boolean);
    return on.length > 0 ? `; offsets on ${on.join(' and ')}` : '';
  };
  // With no tilt among the files any offset is an azimuth offset: nothing but the direction of the drawing differs from the file.
  if (!modelled(s)) return `Turned on the plot: azimuth ${minus(s.azimuthDeg)}°${offsetsText()}. The metrics are not affected.`;
  const parts = [`electrical Δ ${minus(s.tilt.electricalDeg)}°`, `mechanical ${minus(s.tilt.mechanicalDeg)}°`, `azimuth ${minus(s.azimuthDeg)}°`];
  if (modelled(s)) parts.push(methodWords(method));
  if (modelled(s) && s.hCut) parts.push(hCutLabel(s.hCut));
  return `Simulated: ${parts.join(', ')}${offsetsText()}`;
}

/** The tooltip of each global slider: what it does to the files. */
/** A slider's value as it is read out (`aria-valuetext`): a bare "2.5" does not say what it is. */
export const degreesSpoken = (deg: number): string => `${deg < 0 ? 'minus ' : ''}${Math.abs(deg)} degree${Math.abs(deg) === 1 ? '' : 's'}`;

export const SIM_SLIDER_HELP: Record<'electricalDeg' | 'mechanicalDeg' | 'azimuthDeg', string> = {
  electricalDeg:
    'Electrical tilt Δ: a change of the electrical tilt, added to the tilt each file already has. The beam moves down (positive) or up along the antenna’s own axis; the vertical cut and its metrics follow.',
  mechanicalDeg:
    'Mechanical tilt: the whole antenna is tipped forward (positive) or back. The front of the pattern goes down, the back comes up; both cuts and their metrics are read from the tipped 3D reconstruction.',
  azimuthDeg:
    'Azimuth: the direction the antenna points to, for a site view. It turns the pattern on the plot (the horizontal cut and the 3D view); the metrics are not affected: they are properties of the antenna, read against its own boresight.',
};

/** The line in the bar about the Azimuth slider (the only one of the three that changes no number). */
export const AZIMUTH_HINT = 'Azimuth turns the pattern on the plot (a pointing direction, for a site view); the metrics are not affected.';

/**
 * The word on the Simulation bar's badge, or null for none: "Simulated" while values are (a tilt, or the horizontal cut
 * at the horizon), "Turned" while the only thing set is an azimuth (the drawing is turned, no value is simulated).
 * Offsets that change nothing (they cancel out) keep the badge "Simulated", as before.
 */
export function simBadge(o: { valuesSimulated: boolean; turned: boolean; offsets: boolean }): 'Simulated' | 'Turned' | null {
  if (o.valuesSimulated) return 'Simulated';
  if (o.turned) return 'Turned';
  return o.offsets ? 'Simulated' : null;
}

/**
 * The file name of a picture that an azimuth turns (the horizontal cut, the 3D view): `-simulated` while a value in it
 * is simulated, `-turned` while it is only turned, else the plain name.
 */
export const pictureName = (base: string, simulatedOrTurned: boolean, valuesSimulated: boolean): string =>
  !simulatedOrTurned ? base : valuesSimulated ? `${base}-simulated` : `${base}-turned`;

/** An export file name, with `-simulated` before the extension while a simulation is active. */
export const exportName = (base: string, simulated: boolean, extension = ''): string => `${base}${simulated ? '-simulated' : ''}${extension}`;
