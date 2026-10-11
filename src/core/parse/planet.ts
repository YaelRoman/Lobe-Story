import type { Cut, ParseResult, ParseWarning, Pattern } from '../types';

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

export function parsePlanet(text: string, fileName: string): ParseResult {
  const lines = text.split(/\r?\n/);
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

  const freq = headers.get('FREQUENCY');
  if (!freq) return { ok: false, error: 'Missing FREQUENCY' };
  const frequencyMHz = parseFloat(freq.value);
  if (!Number.isFinite(frequencyMHz)) {
    return { ok: false, error: `Non-numeric FREQUENCY "${freq.value}"`, line: freq.line };
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

  warnings.push(...checkCut('HORIZONTAL', horizontal), ...checkCut('VERTICAL', vertical));

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
