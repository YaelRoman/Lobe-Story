/** The one-line state of a collapsed bar: the global values and how many per-file / group offsets are set. */
export function simSummary(
  g: { electricalDeg: number; mechanicalDeg: number; azimuthDeg: number },
  fileOffsets: number,
  groupOffsets: number,
  /** The 3D method, given only while a tilt is active (it changes the result then). */
  method?: 'summation' | 'weighted',
): string {
  const parts = [`Tilt Δ ${g.electricalDeg}°`, `Mech ${g.mechanicalDeg}°`, `Az ${g.azimuthDeg}°`];
  if (fileOffsets > 0) parts.push(`${fileOffsets} file offset${fileOffsets === 1 ? '' : 's'}`);
  if (groupOffsets > 0) parts.push(`${groupOffsets} group offset${groupOffsets === 1 ? '' : 's'}`);
  if (method) parts.push(`3D method: ${method === 'weighted' ? 'Weighted' : 'Summation'}`);
  return parts.join(' · ');
}
