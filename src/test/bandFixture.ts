import type { TaggedPattern } from '../core/analysis/metrics';
import { patternFrom, pwl, vBeamWithLobes } from './synthetic';

const hCut = (half: number, eL: number, eR: number, back: number) =>
  pwl([[-180, back], [-120, back], [-65, eL], [-55, eL], [-half, 3], [0, 0], [half, 3], [55, eR], [65, eR], [120, back], [180, back]]);

/** Twelve files of one array: 1800, 1850, 1900 MHz × tilts 2° and 6° × ±45 ports, with varied metrics. */
export function bandItems(): TaggedPattern[] {
  const items: TaggedPattern[] = [];
  let k = 0;
  for (const f of [1800, 1850, 1900]) {
    for (const t of [2, 6]) {
      for (const pol of ['+45', '-45'] as const) {
        const steer = pol === '+45' ? 1 : -1;
        const eL = 9 + 0.2 * k;
        const eR = k % 2 ? 10 + 0.1 * k : 10;
        const back = 25 + k;
        const half = 30 + k;
        const peak = t + (k >= 10 ? 1 : 0);
        const cut = hCut(half, eL, eR, back);
        items.push({
          pattern: patternFrom((a) => cut(a - steer), (a) => vBeamWithLobes(a - (peak - 6)), {
            id: `f${k}`,
            fileName: `f${k}.msi`,
            frequencyMHz: f,
            gain: { value: Math.round((17 + 0.1 * k) * 10) / 10, unit: 'dBi' },
          }),
          tags: { polarization: pol, tiltDeg: t, array: 'Y1' },
        });
        k++;
      }
    }
  }
  return items;
}
