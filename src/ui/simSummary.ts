import type { SimSettings } from '../core/analysis/tilt';

/** A number with a true minus sign (U+2212), as the marker labels write it. */
const minus = (v: number): string => String(v).replace('-', '−');

/** The one-line state of a collapsed bar: the global values and how many per-file / group offsets are set. */
export function simSummary(
  g: { electricalDeg: number; mechanicalDeg: number; azimuthDeg: number },
  fileOffsets: number,
  groupOffsets: number,
  /** The 3D method, given only while it changes a number on screen (see `summaryMethod`). */
  method?: 'summation' | 'weighted',
): string {
  const parts = [`Tilt Δ ${minus(g.electricalDeg)}°`, `Mech ${minus(g.mechanicalDeg)}°`, `Az ${minus(g.azimuthDeg)}°`];
  if (fileOffsets > 0) parts.push(`${fileOffsets} file offset${fileOffsets === 1 ? '' : 's'}`);
  if (groupOffsets > 0) parts.push(`${groupOffsets} group offset${groupOffsets === 1 ? '' : 's'}`);
  if (method) parts.push(`3D method: ${method === 'weighted' ? 'Weighted' : 'Summation'}`);
  return parts.join(' · ');
}

/**
 * The 3D method for the collapsed bar's summary, or undefined while it changes nothing on screen: it matters under a
 * tilt, and while the angular-region estimate (integrated over the reconstruction) is shown or plotted.
 */
export const summaryMethod = <M extends 'summation' | 'weighted'>(method: M, tiltActive: boolean, angularRegions: boolean): M | undefined =>
  tiltActive || angularRegions ? method : undefined;

/** The simulation facts a caption or a file name needs (the parts of `SimulationResult` used, so it can be tested without hooks). */
export interface SimFacts {
  tiltActive: boolean;
  tilt: { electricalDeg: number; mechanicalDeg: number };
  azimuthDeg: number;
  offsetCount: number;
  groupOffsetCount: number;
}

/** Whether any simulation is active: a tilt, an azimuth, or an offset on a file or a group. */
export const simulationActive = (s: SimFacts): boolean => s.tiltActive || s.azimuthDeg !== 0 || s.offsetCount > 0 || s.groupOffsetCount > 0;

/**
 * Whether something among the files `ids` (the ones a picture draws or an export lists) is simulated: one of them has
 * a non-zero effective tilt or azimuth (global values plus its own and its group's offsets). An offset on a file that
 * is not among them does not count.
 */
export function anySimulated(effective: (id: string) => SimSettings, ids: Iterable<string>): boolean {
  for (const id of ids) {
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
 * "Simulated: electrical Δ 4°, mechanical 0°, azimuth 0°, summation method" (the method only while a tilt is active,
 * as it changes the result then), plus the number of per-file and per-group offsets (those among the files the picture
 * shows when `counts` is given, see `offsetCountsAmong`; else all of the project's).
 */
export function simulatedCaption(s: SimFacts, method: 'summation' | 'weighted', counts?: { files: number; groups: number }): string | undefined {
  if (!simulationActive(s)) return undefined;
  const parts = [`electrical Δ ${minus(s.tilt.electricalDeg)}°`, `mechanical ${minus(s.tilt.mechanicalDeg)}°`, `azimuth ${minus(s.azimuthDeg)}°`];
  if (s.tiltActive) parts.push(`${method} method`);
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
