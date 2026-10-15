import type { Pattern } from '../core/types';
import type { Method3d, Surface3d } from '../core/analysis/pattern3d';
import { gridsFor } from '../core/analysis/metrics';
import { reconstructTilted3d, type SimSettings } from '../core/analysis/tilt';

/**
 * The 3D view's reconstruction of a file with one method, at the file's effective tilt and azimuth, kept per file and
 * method for the last tilt asked: each method's surface is computed once per change of input, whether the single view
 * or the methods compared asks for it, and switching between the two reuses it. Pattern objects do not change and the
 * map holds them weakly, so a file that is closed takes its surfaces with it.
 */
const cache = new WeakMap<Pattern, Partial<Record<Method3d, { key: string; surface: Surface3d }>>>();
let computed = 0;

const keyOf = (e: SimSettings): string => `${e.electricalDeg}|${e.mechanicalDeg}|${e.azimuthDeg}`;

export function surfaceFor(pattern: Pattern, e: SimSettings, method: Method3d): Surface3d {
  let entry = cache.get(pattern);
  if (!entry) cache.set(pattern, (entry = {}));
  const key = keyOf(e);
  const hit = entry[method];
  if (hit && hit.key === key) return hit.surface;
  const g = gridsFor(pattern);
  const surface = reconstructTilted3d(g.h, g.v, e, e.azimuthDeg, method);
  computed++;
  entry[method] = { key, surface };
  return surface;
}

/** How many surfaces were computed so far (for tests). */
export const surfacesComputed = (): number => computed;
