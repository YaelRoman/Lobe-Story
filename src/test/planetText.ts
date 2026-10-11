const signedDeg = (a: number) => (a > 180 ? a - 360 : a);

/** Data lines "angle<sep>atten" for angles 0..359 (step), atten = fn(signed angle). */
export function points(fn: (signedAngle: number) => number, sep = ' ', step = 1): string[] {
  const out: string[] = [];
  for (let a = 0; a < 360; a += step) out.push(`${a.toFixed(1)}${sep}${fn(signedDeg(a)).toFixed(2)}`);
  return out;
}

export const DEFAULT_HEADERS = ['NAME TEST1', 'FREQUENCY 1800', 'GAIN 15.2 dBi', 'TILT ELECTRICAL'];

export interface PlanetTextOptions {
  headers?: string[];
  h?: string[];
  v?: string[];
  hCount?: number;
  vCount?: number;
  eol?: string;
}

/** A complete Planet file: H beam with 65° HPBW at 0°, V beam with 8° HPBW at +8°. */
export function planetText(o: PlanetTextOptions = {}): string {
  const eol = o.eol ?? '\r\n';
  const h = o.h ?? points((a) => Math.min(40, 3 * (a / 32.5) ** 2));
  const v = o.v ?? points((a) => Math.min(40, 3 * ((a - 8) / 4) ** 2));
  const nonBlank = (lines: string[]) => lines.filter((l) => l.trim() !== '').length;
  const lines = [
    ...(o.headers ?? DEFAULT_HEADERS),
    `HORIZONTAL ${o.hCount ?? nonBlank(h)}`,
    ...h,
    `VERTICAL ${o.vCount ?? nonBlank(v)}`,
    ...v,
  ];
  return lines.join(eol) + eol;
}
