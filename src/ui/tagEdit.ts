import type { Tags } from '../core/types';

const KEYS: (keyof Tags)[] = ['polarization', 'tiltDeg', 'port', 'array'];

/** True when both hold the same value for every tag (a missing tag and an undefined one are the same). */
export function sameTags(a: Tags, b: Tags): boolean {
  return KEYS.every((k) => Object.is(a[k], b[k]));
}
