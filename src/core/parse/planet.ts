import type { Cut, ParseResult, ParseWarning, Pattern } from '../types';
import { convertGain, hasUsableFrequency, PLAUSIBLE_GAIN_DBI } from '../gain';

const KNOWN_HEADERS = new Set([
  'NAME',
  'FILENAME',
  'MAKE',
  'FREQUENCY',
  'H_WIDTH',
  'V_WIDTH',
  'FRONT_TO_BACK',
  'GAIN',
  'TILT',
  'COMMENT',
  'COMMENTS',
  'POLARIZATION',
  'ELECTRICAL_TILT',
]);

type BlockResult = { ok: true; cut: Cut; next: number } | { ok: false; error: string; line: number };

function readBlock(lines: string[], start: number, key: string, countText: string): BlockResult {
  const count = Number(countText);
  if (!Number.isInteger(count) || count <= 0) {
    return { ok: false, error: `Invalid ${key} point count "${countText}"`, line: start + 1 };
  }
  const angles: number[] = [];
  const atten: number[] = [];
  let i = start + 1;
  while (angles.length < count) {
    const text = i < lines.length ? lines[i].trim() : undefined;
    if (text === '') {
      i++;
      continue;
    }
    if (text === undefined || /^[A-Za-z]/.test(text)) {
      return {
        ok: false,
        error: `${key} block declares ${count} points but only ${angles.length} found`,
        line: start + 1,
      };
    }
    const parts = text.split(/\s+/);
    const angle = Number(parts[0]);
    const value = Number(parts[1]);
    if (parts.length < 2 || !Number.isFinite(angle) || !Number.isFinite(value)) {
      return { ok: false, error: `Non-numeric value in ${key} block: "${text}"`, line: i + 1 };
    }
    angles.push(angle);
    atten.push(value);
    i++;
  }
  return { ok: true, cut: { angles, atten }, next: i };
}

function optionalNumber(text: string | undefined): number | undefined {
  if (text === undefined || text.trim() === '') return undefined;
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : undefined;
}

/** A cut is taken for negative levels only when its lowest value is at least this far below 0 (and none is above 0). */
export const NEGATIVE_LEVELS_MIN_DB = 3;

/**
 * Some tools write the levels as dB relative to the peak with a minus sign (0 at the peak, −40 at the back) instead
 * of as attenuation (0 at the peak, 40 at the back). Read as attenuation such a cut is upside down: its back becomes
 * the peak. Only the unambiguous case is turned round: no value above 0 and a lowest value of −3 dB or lower. An
 * attenuation cut has no such shape (its values are ≥ 0), so nothing else is touched. Returns the cut to use, and
 * whether it was turned round.
 */
function asAttenuation(cut: Cut): { cut: Cut; flipped: boolean } {
  let max = -Infinity;
  let min = Infinity;
  for (const v of cut.atten) {
    if (v > max) max = v;
    if (v < min) min = v;
  }
  if (!(max <= 0 && min <= -NEGATIVE_LEVELS_MIN_DB)) return { cut, flipped: false };
  return { cut: { angles: cut.angles, atten: cut.atten.map((v) => (v === 0 ? 0 : -v)) }, flipped: true };
}

/** A frequency below this with no unit is more likely GHz than MHz (no cellular pattern is measured below 30 MHz). */
export const BARE_FREQUENCY_MIN_MHZ = 30;

function checkCut(label: string, cut: Cut): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  const seen = new Set<number>();
  let duplicate = false;
  for (const a of cut.angles) {
    const m = ((a % 360) + 360) % 360;
    if (seen.has(m)) duplicate = true;
    seen.add(m);
  }
  if (duplicate) {
    warnings.push({ code: 'duplicate-angle', message: `${label} cut has duplicate angles; the last value is used` });
  }
  const uniform = seen.size === 360 && [...seen].every((a) => Number.isInteger(a));
  if (!uniform) {
    warnings.push({ code: 'resampled', message: `${label} cut is not a 1° grid; it is resampled for analysis` });
  }
  const min = Math.min(...cut.atten);
  if (min !== 0) {
    warnings.push({
      code: 'peak-not-zero',
      message: `${label} cut minimum is ${min} dB, not 0; analysis normalises it`,
    });
  }
  return warnings;
}

/** True when some line starts with a Planet header or block keyword (a quick content sniff). */
function looksLikePlanet(lines: string[]): boolean {
  return lines.some((line) => {
    const key = /^\s*(\S+)/.exec(line)?.[1].toUpperCase();
    return key !== undefined && (KNOWN_HEADERS.has(key) || key === 'HORIZONTAL' || key === 'VERTICAL');
  });
}

export function parsePlanet(text: string, fileName: string): ParseResult {
  const lines = text.split(/\r?\n/);
  if (!looksLikePlanet(lines)) return { ok: false, error: 'Not a Planet pattern file' };
  const headers = new Map<string, { value: string; line: number }>();
  const warnings: ParseWarning[] = [];
  let horizontal: Cut | undefined;
  let vertical: Cut | undefined;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '') {
      i++;
      continue;
    }
    const match = /^(\S+)(?:\s+(.*))?$/.exec(line)!;
    const key = match[1].toUpperCase();
    const value = (match[2] ?? '').trim();
    if (key === 'HORIZONTAL' || key === 'VERTICAL') {
      const block = readBlock(lines, i, key, value);
      if (!block.ok) return { ok: false, error: block.error, line: block.line };
      if (key === 'HORIZONTAL') horizontal = block.cut;
      else vertical = block.cut;
      i = block.next;
      continue;
    }
    if (/^[-+\d.]/.test(key)) {
      return { ok: false, error: `Data line outside a HORIZONTAL/VERTICAL block: "${line}"`, line: i + 1 };
    }
    if (!KNOWN_HEADERS.has(key)) {
      warnings.push({ code: 'unknown-header', message: `Unknown header "${key}"`, line: i + 1 });
    }
    headers.set(key, { value, line: i + 1 });
    i++;
  }

  if (!horizontal) return { ok: false, error: 'Missing HORIZONTAL block' };
  if (!vertical) return { ok: false, error: 'Missing VERTICAL block' };
  const cutWarnings: ParseWarning[] = [];
  const cuts = { HORIZONTAL: asAttenuation(horizontal), VERTICAL: asAttenuation(vertical) };
  for (const label of ['HORIZONTAL', 'VERTICAL'] as const) {
    if (cuts[label].flipped) {
      cutWarnings.push({ code: 'negative-levels', message: `${label} cut: values look like negative levels (dB relative to peak written with a minus sign); read as attenuation` });
    }
    cutWarnings.push(...checkCut(label, cuts[label].cut));
  }
  horizontal = cuts.HORIZONTAL.cut;
  vertical = cuts.VERTICAL.cut;

  const freq = headers.get('FREQUENCY');
  let frequencyMHz = 0;
  if (!freq || freq.value === '') {
    // The file still loads; it has no place on a frequency axis and in no band.
    warnings.push({ code: 'no-frequency', message: 'No FREQUENCY header: shown as 0 MHz and left out of the frequency chart and the band statistics' });
  } else {
    frequencyMHz = parseFloat(freq.value);
    if (!Number.isFinite(frequencyMHz)) {
      return { ok: false, error: `Non-numeric FREQUENCY "${freq.value}"`, line: freq.line };
    }
    // A unit after the number: GHz is converted (the page works in MHz); MHz, or none, is taken as it is.
    const unit = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?\s*([a-z]+)/i.exec(freq.value)?.[1].toLowerCase();
    if (unit === 'ghz') frequencyMHz = Number((frequencyMHz * 1000).toFixed(6));
    else if (unit === undefined && frequencyMHz > 0 && frequencyMHz < BARE_FREQUENCY_MIN_MHZ) {
      warnings.push({
        code: 'frequency-unit',
        message: `FREQUENCY ${freq.value} has no unit and is below ${BARE_FREQUENCY_MIN_MHZ}: frequency looks like GHz. It is read as ${frequencyMHz} MHz; write "${frequencyMHz} GHz" or ${Number((frequencyMHz * 1000).toFixed(6))} if GHz is meant`,
        line: freq.line,
      });
    }
    if (!hasUsableFrequency(frequencyMHz)) {
      warnings.push({
        code: 'no-frequency',
        message: `FREQUENCY ${freq.value} is not above 0 MHz: left out of the frequency chart and the band statistics`,
        line: freq.line,
      });
    }
  }

  const get = (k: string) => {
    const v = headers.get(k)?.value;
    return v === undefined || v === '' ? undefined : v;
  };

  let gain: Pattern['gain'];
  const gainMatch = /^(-?\d+(?:\.\d+)?)\s*(dBd|dBi)?/i.exec(get('GAIN') ?? '');
  if (gainMatch) {
    gain = { value: parseFloat(gainMatch[1]), unit: gainMatch[2]?.toLowerCase() === 'dbi' ? 'dBi' : 'dBd' };
  } else {
    warnings.push({ code: 'missing-gain', message: 'No usable GAIN header' });
  }
  if (gain) {
    const dbi = convertGain(gain, 'dBi')!;
    if (dbi < PLAUSIBLE_GAIN_DBI.min || dbi > PLAUSIBLE_GAIN_DBI.max) {
      warnings.push({
        code: 'gain-out-of-range',
        message: `Declared gain ${gain.value} ${gain.unit} (${Number(dbi.toFixed(2))} dBi) is outside ${PLAUSIBLE_GAIN_DBI.min} to ${PLAUSIBLE_GAIN_DBI.max} dBi; check the GAIN header`,
        line: headers.get('GAIN')?.line,
      });
    }
  }

  warnings.push(...cutWarnings);

  const extraHeaders: Record<string, string> = {};
  for (const [k, { value }] of headers) if (!KNOWN_HEADERS.has(k)) extraHeaders[k] = value;

  const pattern: Pattern = {
    id: fileName,
    fileName,
    name: get('NAME') ?? get('FILENAME'),
    make: get('MAKE'),
    frequencyMHz,
    gain,
    tilt: get('TILT'),
    comment: get('COMMENT') ?? get('COMMENTS'),
    polarization: get('POLARIZATION'),
    electricalTiltDeg: optionalNumber(get('ELECTRICAL_TILT')),
    declared: {
      hBeamwidth: optionalNumber(get('H_WIDTH')),
      vBeamwidth: optionalNumber(get('V_WIDTH')),
      frontToBack: optionalNumber(get('FRONT_TO_BACK')),
    },
    horizontal,
    vertical,
    extraHeaders,
  };
  return { ok: true, pattern, warnings };
}
