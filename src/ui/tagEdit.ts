import type { Tags } from '../core/types';

const KEYS: (keyof Tags)[] = ['polarization', 'tiltDeg', 'port', 'array'];

/** True when both hold the same value for every tag (a missing tag and an undefined one are the same). */
export function sameTags(a: Tags, b: Tags): boolean {
  return KEYS.every((k) => Object.is(a[k], b[k]));
}

export type TiltEntry = { ok: true; value: number | undefined } | { ok: false; message: string };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** The tilt field's text as a tilt: empty clears it, a plain decimal number sets it, anything else is refused. */
export function parseTilt(text: string): TiltEntry {
  const t = text.trim();
  if (t === '') return { ok: true, value: undefined };
  if (!NUMBER.test(t)) return { ok: false, message: 'Tilt must be a number such as 6 or 6.5 (leave it empty for none).' };
  return { ok: true, value: Number(t) };
}
