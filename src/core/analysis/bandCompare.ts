import { fineDecimals, tiltText, type BandCell } from './bandParams';
import { MIN_SAMPLES } from './bandStats';
import type { TaggedPattern } from './metrics';
import { autoSubBands, type SubBand } from './subBands';

/**
 * Two antennas side by side in the band statistics: "B − A" for each parameter and sub-band. A difference is only
 * made of two BASTA statistics; it is signed and never graded (BASTA gives no "better" direction for most rows).
 */

/** The numeric columns of a band CSV line; a difference line holds B − A of each where both antennas have it. */
export type DiffNumberKey = 'value' | 'tolerance' | 'lower' | 'upper' | 'percentile' | 'min' | 'max' | 'mean';

export interface BandDiff {
  /** 'none': no difference is made (an input has no statistic); the text is a dash and the title says why. */
  state: 'ok' | 'none';
  text: string;
  title: string;
  /** Shown dimmed: no difference, or one partly of 22 dB substitutes. */
  muted: boolean;
  /** An input's limit was changed by the 3 dB excursion rule (the text ends in `*`). */
  adjusted: boolean;
  /** An input counts "not available" values as 22 dB (the text ends in `†`). */
  substituted: boolean;
  /**
   * "°"; "%" for a percentage row, whose difference is in percentage points; or "dB" for every dB row and for gain (a
   * difference of two dBi or dBd values is in dB).
   */
  unit: string;
  numbers: Partial<Record<DiffNumberKey, number>>;
}

/** What the two antennas are called in the reasons. */
export interface DiffNames {
  a?: string;
  b?: string;
}

/**
 * `v` signed with a fixed number of decimals, like the statistics it is the difference of; one that rounds to zero is
 * written without a sign ("0.0", or "0" with `trim`), as the metrics table's difference view writes it. Never more
 * digits than the inputs show: a 1° grid does not give a difference of 0.002°.
 */
function signedText(v: number, decimals: number, trim: boolean): string {
  const rounded = Number(v.toFixed(decimals));
  if (rounded === 0) return trim ? '0' : (0).toFixed(decimals);
  const text = trim ? String(rounded) : rounded.toFixed(decimals);
  return rounded > 0 ? `+${text}` : text;
}

const withUnit = (text: string, unit: string): string => text + (unit === '°' ? '' : ' ') + unit;

/**
 * A difference as the band table writes it: signed, one decimal ("+1.2°", "-0.4 dB"), or the row's own; "0.0 dB" where
 * it rounds to zero.
 */
export const signedDiff = (v: number, unit: string, decimals = 1): string => withUnit(signedText(v, decimals, false), unit);

/** A difference of nominal tilts, written as the tilts are (at most one decimal, none for whole degrees). */
const signedTilt = (v: number): string => `${signedText(v, 1, true)}°`;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const extent = (values: readonly number[]) => ({ min: Math.min(...values), max: Math.max(...values) });

/** Why a cell gives no difference, or null when it has a statistic to take one of. */
function noStatistic(cell: BandCell, who: string): string | null {
  switch (cell.state) {
    case 'empty':
      return `${who} has no values in this sub-band`;
    case 'few':
      return `${who} has only ${plural(cell.n, 'value')} (fewer than ${MIN_SAMPLES}): the range is no BASTA statistic, so there is no difference`;
    case 'notApplicable':
      return `${who} is n/a (more than half the values are "not available", BASTA 12.5.3)`;
    default:
      return null;
  }
}

/** The two antennas as the reasons name them: "A", or "A (Array Y2)". */
const whoOf = (side: 'A' | 'B', name?: string): string => (name ? `${side} (${name})` : side);

/**
 * B − A of one band-statistics cell. Per kind of cell:
 * - double-sided (mean ± tolerance): the difference of the means, and of the tolerances in brackets;
 * - single-sided limit (< P84, > P16): the difference of the limits as shown (adjusted ones where the 3 dB excursion
 *   rule changed them; the `*` is carried);
 * - mean (gain at a tilt): the difference of the means, with both tilts named when they are not the same;
 * - absolute (electrical tilt range): the difference of the lowest and of the highest nominal tilt.
 * No difference (a dash) where either input has no statistic: no values, fewer than `MIN_SAMPLES` values (its range is
 * shown, which is no statistic), or n/a. A difference partly of 22 dB substitutes (BASTA 12.5.3) is marked `†` and dimmed.
 */
export function bandDiff(a: BandCell, b: BandCell, names: DiffNames = {}): BandDiff {
  const whoA = whoOf('A', names.a);
  const whoB = whoOf('B', names.b);
  const unit = a.unit === '°' || a.unit === '%' ? a.unit : 'dB';
  const reasons = [noStatistic(a, whoA), noStatistic(b, whoB)].filter((r): r is string => r !== null);
  if (reasons.length > 0) {
    return { state: 'none', text: '—', title: `No difference: ${reasons.join('; ')}`, muted: true, adjusted: false, substituted: false, unit, numbers: {} };
  }

  /** A number of the detail text: signed, two decimals, with the unit. */
  const u = (v: number): string => withUnit(signedText(v, a.decimals === undefined ? 2 : fineDecimals(v, a.decimals + 1), false), unit);
  /** A difference in the text: the row's decimals, or (a row with its own) as many more as it takes not to read 0 when it is not. */
  const shown = (v: number): string => signedDiff(v, unit, a.decimals === undefined ? 1 : fineDecimals(v, a.decimals));
  const points = unit === '%' ? ' (percentage points)' : '';
  const inputs = [`${whoA}: ${a.text} (N = ${a.n})`, `${whoB}: ${b.text} (N = ${b.n})`];
  const sa = a.stat;
  const sb = b.stat;
  const numbers: BandDiff['numbers'] = {};
  let text: string;
  let what: string;

  if (a.key === 'tiltRange' || !sa || !sb) {
    const ea = extent(a.values);
    const eb = extent(b.values);
    numbers.min = eb.min - ea.min;
    numbers.max = eb.max - ea.max;
    text = a.values.length === 1 && b.values.length === 1 ? signedTilt(numbers.min) : `lowest ${signedTilt(numbers.min)}, highest ${signedTilt(numbers.max)}`;
    what = 'B − A of the lowest and of the highest nominal electrical tilt';
  } else {
    const ea = extent(a.values);
    const eb = extent(b.values);
    numbers.min = eb.min - ea.min;
    numbers.max = eb.max - ea.max;
    if (sa.kind === 'double' && sb.kind === 'double') {
      numbers.value = numbers.mean = sb.mean - sa.mean;
      numbers.tolerance = sb.tolerance - sa.tolerance;
      numbers.lower = sb.lower - sa.lower;
      numbers.upper = sb.upper - sa.upper;
      text = `${shown(numbers.mean)} (tol ${shown(numbers.tolerance)})`;
      what = `B − A of the mean${points}: ${u(numbers.mean)}; in brackets, of the tolerance: ${u(numbers.tolerance)}`;
    } else if (sa.kind === 'mean' && sb.kind === 'mean') {
      numbers.value = numbers.mean = sb.mean - sa.mean;
      text = shown(numbers.mean);
      what = `B − A of the mean gain: ${u(numbers.mean)}`;
      if (a.tiltDeg !== b.tiltDeg) {
        text += ` (A @ ${tiltText(a.tiltDeg!)}°, B @ ${tiltText(b.tiltDeg!)}°)`;
        what += `; the two antennas are not at the same nominal tilt (A ${tiltText(a.tiltDeg!)}°, B ${tiltText(b.tiltDeg!)}°)`;
      }
    } else if ((sa.kind === 'min' || sa.kind === 'max') && sb.kind === sa.kind) {
      numbers.value = sb.value - sa.value;
      numbers.percentile = sb.percentile - sa.percentile;
      text = shown(numbers.value);
      what = `B − A${points} of the single-sided ${sa.kind === 'min' ? 'minimum (16th percentile)' : 'maximum (84th percentile)'}: ${u(numbers.value)}`;
    } else {
      // Both cells of one row are always of the same kind; a mismatch has nothing to subtract.
      return { state: 'none', text: '—', title: 'No difference: the two statistics are not of the same kind', muted: true, adjusted: false, substituted: false, unit, numbers: {} };
    }
  }

  const lines = [`${what} (a signed difference, not a grade)`, ...inputs];
  const adjusted = a.adjusted || b.adjusted;
  if (a.adjusted) lines.push(`* ${whoA} is adjusted by the 3 dB excursion rule (BASTA 12.2)`);
  if (b.adjusted) lines.push(`* ${whoB} is adjusted by the 3 dB excursion rule (BASTA 12.2)`);
  const substituted = a.substituted > 0 || b.substituted > 0;
  if (a.substituted > 0) lines.push(`† ${whoA} counts ${a.substituted} "not available" values as 22 dB (BASTA 12.5.3)`);
  if (b.substituted > 0) lines.push(`† ${whoB} counts ${b.substituted} "not available" values as 22 dB (BASTA 12.5.3)`);
  if (substituted) lines.push('The difference is partly of that substitute, not of measured values');
  return {
    state: 'ok',
    text: text + (adjusted ? '*' : '') + (substituted ? '†' : ''),
    title: lines.join('\n'),
    muted: substituted,
    adjusted,
    substituted,
    unit,
    numbers,
  };
}

/**
 * The sub-bands of a comparison: the user's when there are any, else automatic ones over the frequencies of both
 * antennas, so that A and B have the same columns (A's own automatic sub-bands can differ from these).
 */
export function compareSubBands(a: readonly TaggedPattern[], b: readonly TaggedPattern[], user: readonly SubBand[]): SubBand[] {
  return user.length ? [...user] : autoSubBands([...a, ...b].map((i) => i.pattern.frequencyMHz));
}
