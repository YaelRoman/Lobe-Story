/** A number with a true minus sign (U+2212), as the marker labels write it. */
const minus = (v: number): string => String(v).replace('-', '−');

/** The one-line state of a collapsed bar: the global values and how many per-file / group offsets are set. */
export function simSummary(
  g: { electricalDeg: number; mechanicalDeg: number; azimuthDeg: number },
  fileOffsets: number,
  groupOffsets: number,
  /** The 3D method, given only while a tilt is active (it changes the result then). */
  method?: 'summation' | 'weighted',
): string {
  const parts = [`Tilt Δ ${minus(g.electricalDeg)}°`, `Mech ${minus(g.mechanicalDeg)}°`, `Az ${minus(g.azimuthDeg)}°`];
  if (fileOffsets > 0) parts.push(`${fileOffsets} file offset${fileOffsets === 1 ? '' : 's'}`);
  if (groupOffsets > 0) parts.push(`${groupOffsets} group offset${groupOffsets === 1 ? '' : 's'}`);
  if (method) parts.push(`3D method: ${method === 'weighted' ? 'Weighted' : 'Summation'}`);
  return parts.join(' · ');
}

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
 * The caption line of an exported image while a simulation is active, else undefined:
 * "Simulated: electrical Δ 4°, mechanical 0°, azimuth 0°, summation method" (the method only while a tilt is active,
 * as it changes the result then), plus the number of per-file and per-group offsets.
 */
export function simulatedCaption(s: SimFacts, method: 'summation' | 'weighted'): string | undefined {
  if (!simulationActive(s)) return undefined;
  const parts = [`electrical Δ ${minus(s.tilt.electricalDeg)}°`, `mechanical ${minus(s.tilt.mechanicalDeg)}°`, `azimuth ${minus(s.azimuthDeg)}°`];
  if (s.tiltActive) parts.push(`${method} method`);
  const offsets = [
    s.offsetCount > 0 ? `${s.offsetCount} file${s.offsetCount === 1 ? '' : 's'}` : '',
    s.groupOffsetCount > 0 ? `${s.groupOffsetCount} group${s.groupOffsetCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `Simulated: ${parts.join(', ')}${offsets.length > 0 ? `; offsets on ${offsets.join(' and ')}` : ''}`;
}

/** An export file name, with `-simulated` before the extension while a simulation is active. */
export const exportName = (base: string, simulated: boolean, extension = ''): string => `${base}${simulated ? '-simulated' : ''}${extension}`;
