import { describe, expect, it } from 'vitest';
import { buildRows, formatCell, HORIZON_WORDS, markReference, pairWords, rowCell, TILT_WORDS, toCsv, toTsv, visibleColumns, withHorizonLevel, csvColumns } from './table';
import { bandCsv, bandTsv, cellDisplay, bandStateNote } from './bandView';
import { bandHistCaption } from './bandHistFigure';
import { metricCaption } from './metricFigure';
import { hpbwCaption } from './hpbwFigure';
import { traceNote } from './legend';
import { simulatedNote } from './simSummary';
import { BAND_PARAMS, bandTable } from '../core/analysis/bandParams';
import { DEFAULT_TABLE_GROUPS } from '../state/store';
import { groupPatterns } from '../state/selectors';
import { analyzeAll, DEFAULT_SETTINGS, type TaggedPattern } from '../core/analysis/metrics';
import { analyzeTilted, tiltEach } from '../core/analysis/tilt';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';
import { bandItems } from '../test/bandFixture';

// The cut at the horizon with no tilt on any file: nothing is tilted, so nothing may be called "tilted".
const a: TaggedPattern = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a', fileName: 'a.msi' }), tags: { tiltDeg: 6 } };
const b: TaggedPattern = { pattern: patternFrom(quadBeam(60), quadBeam(8, 0, 30), { id: 'b', fileName: 'b.msi' }), tags: { tiltDeg: 0 } };
const items = [a, b];
const original = analyzeAll(items);
const NONE = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
const effective = () => NONE;
const metrics = analyzeTilted(tiltEach(items, effective, 'summation', 'horizon'), DEFAULT_SETTINGS, effective);
const rows = [...buildRows(groupPatterns(items), original, 'dBd', metrics, () => false, () => true)].sort((p, q) => p.id.localeCompare(q.id));
const columns = withHorizonLevel(csvColumns(DEFAULT_TABLE_GROUPS), true);
const shown = withHorizonLevel(visibleColumns(DEFAULT_TABLE_GROUPS), true);
const header = (csv: string) => csv.split('\r\n')[0].split(',');

describe('wording of the cut at the horizon while no file is tilted', () => {
  it('names the two values of a cell "file cut" and "horizon cut" only then', () => {
    expect(pairWords(true, false)).toBe(HORIZON_WORDS);
    expect(pairWords(true, true)).toBe(TILT_WORDS);
    expect(pairWords(false, true)).toBe(TILT_WORDS);
    expect(HORIZON_WORDS).toEqual({ from: 'file cut', to: 'horizon cut' });
  });

  it('table cells: the tooltips say file cut and horizon cut, never tilted', () => {
    expect(formatCell({ value: 65 }, { value: 65 }, 1, HORIZON_WORDS)).toEqual({ text: '65.0', title: 'file cut and horizon cut are equal', equal: true });
    expect(formatCell({ value: 1 }, { value: null, reason: 'no lobe' }, 1, HORIZON_WORDS).title).toBe('horizon cut: no lobe');
    expect(formatCell({ value: null, reason: 'declared' }, { value: null, reason: 'x' }, 1, HORIZON_WORDS).title).toBe('file cut and horizon cut are equal\nfile cut: declared\nhorizon cut: x');
    for (const r of rows) for (const c of shown) expect(rowCell(r, c.key, HORIZON_WORDS).title ?? '').not.toMatch(/tilted|original/);
    // Under a tilt the wording is as it was.
    expect(formatCell({ value: 65 }, { value: 65 })).toEqual({ text: '65.0', title: 'original and tilted are equal under the simulation', equal: true });
    expect(formatCell({ value: 1 }, { value: null, reason: 'no lobe' }).title).toBe('tilted: no lobe');
  });

  it('CSV: the same columns in the same order, the horizontal ones tagged [H cut at the horizon], none "tilted"', () => {
    const tilted = header(toCsv(rows, 'dBd', 30, effective, 20, 3, undefined, false, columns, 'summation', true));
    const plain = header(toCsv(rows, 'dBd', 30, effective, 20, 3, undefined, false, columns, 'summation', true, false));
    expect(plain).toHaveLength(tilted.length);
    expect(plain.join(',')).not.toMatch(/tilted/);
    expect(plain.every((h) => !h.includes('"'))).toBe(true);
    const at = plain.indexOf('H-HPBW original (°)');
    expect(plain.slice(at, at + 5)).toEqual(['H-HPBW original (°)', 'H-HPBW [H cut at the horizon] [Summation] (°)', 'Horizon level [horizon cut] [Summation] (dB)', 'V-HPBW original (°)', 'V-HPBW simulated (°)']);
    expect(plain).toContain('F/B 180° [H cut at the horizon] [Summation] (dB)');
    // Only the words differ from the header under a tilt: column by column.
    plain.forEach((h, i) => expect(h.replace(' [H cut at the horizon]', ' tilted [horizon cut]').replace(' simulated (', ' tilted (')).toBe(tilted[i]));
    expect(plain.slice(-3)).toEqual(['Electrical tilt Δ (°)', 'Mechanical tilt (°)', 'Azimuth pointing (°)']);
    // The values are untouched.
    const body = (csv: string) => csv.split('\r\n').slice(1).join('\n');
    expect(body(toCsv(rows, 'dBd', 30, effective, 20, 3, undefined, false, columns, 'summation', true, false))).toBe(body(toCsv(rows, 'dBd', 30, effective, 20, 3, undefined, false, columns, 'summation', true)));
  });

  it('copied table: [H cut at the horizon] on the horizontal columns', () => {
    const head = toTsv(rows, shown, 'dBd', 30, 20, 3, undefined, false, 'summation', true, false).split('\r\n')[0].split('\t');
    expect(head).toContain('H-HPBW [H cut at the horizon] [Summation] (°)');
    expect(head).toContain('V-HPBW (°)');
    expect(head.join('\t')).not.toMatch(/tilted/);
    expect(toTsv(rows, shown, 'dBd', 30, 20, 3, undefined, false, 'summation', true).split('\r\n')[0]).toContain('H-HPBW [tilted: horizon cut] [Summation] (°)');
  });

  it('difference view: the horizontal columns are tagged, nothing says "tilted values"', () => {
    const delta = markReference(rows, 'b', true);
    const csv = header(toCsv(delta, 'dBd', 30, effective, 20, 3, 'b.msi', true, columns, 'summation', true, false));
    expect(csv).toContain('H-HPBW Δ vs b.msi [H cut at the horizon] [Summation] (°)');
    expect(csv).toContain('Horizon level Δ vs b.msi [H cut at the horizon] [Summation] (dB)');
    expect(csv).toContain('V-HPBW Δ vs b.msi (°)');
    expect(csv).toContain('Gain Δ vs b.msi (dBd)');
    expect(csv.join(',')).not.toMatch(/tilted/);
    const tsv = toTsv(delta, shown, 'dBd', 30, 20, 3, 'b.msi', true, 'summation', true, false).split('\r\n')[0];
    expect(tsv).toContain('H-HPBW Δ vs b.msi [H cut at the horizon] [Summation] (°)');
    expect(tsv).not.toMatch(/tilted/);
  });

  it('the note above the table says what a pair is', () => {
    expect(simulatedNote(true, false)).toBe('a → b: file cut → horizon cut');
    expect(simulatedNote(true, true)).toBeUndefined();
    expect(simulatedNote(false, true)).toBeUndefined();
  });
});

describe('band statistics at the horizon while no file is tilted', () => {
  const bItems = bandItems();
  const bMetrics = analyzeAll(bItems, DEFAULT_SETTINGS);
  const cols = bandTable(bItems, bMetrics, [{ name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 }], { gainUnit: 'dBi' as const, settings: DEFAULT_SETTINGS });

  it('CSV State: "horizon cut" on the horizontal rows, "simulated" on the others, the same lines as under a tilt', () => {
    const lines = bandCsv([{ label: 'Array Y1', columns: cols, tilted: cols }], DEFAULT_SETTINGS, true, false).split('\r\n');
    const state = (label: string) => lines.filter((l) => l.includes(`,${label},`)).map((l) => l.split(',')[1]);
    expect(state('Azimuth beamwidth')).toEqual(['original', 'horizon cut']);
    expect(state('Elevation beamwidth')).toEqual(['original', 'simulated']);
    expect(lines.join('\n')).not.toMatch(/tilted/);
    expect(lines).toHaveLength(bandCsv([{ label: 'Array Y1', columns: cols, tilted: cols }], DEFAULT_SETTINGS, true).split('\r\n').length);
    expect(lines).toHaveLength(2 * BAND_PARAMS.length + 2);
  });

  it('copied table, cell tooltip, heading, caption and note', () => {
    expect(bandTsv(cols, cols, DEFAULT_SETTINGS, true, false).split('\t')[0]).toBe('Parameter [H cut at the horizon]');
    expect(bandTsv(cols, cols, DEFAULT_SETTINGS, true).split('\t')[0]).toBe('Parameter [tilted: H cut at the horizon]');
    const cell = cols[0].cells.hHpbw;
    expect(cellDisplay(cell, { ...cell, text: 'x', title: 'T' }, HORIZON_WORDS).title).toBe(`file cut: ${cell.title}\nhorizon cut: T`);
    const caption = (state: 'tilted' | 'horizon cut' | undefined) =>
      bandHistCaption({ antenna: 'A', subBand: { name: 'B', minMHz: 1, maxMHz: 2 }, parameter: 'p', stat: null, unit: '', n: 12, ...(state ? { state } : {}) }).items;
    expect(caption('horizon cut')).toContain('N = 12 (horizon cut)');
    expect(caption('tilted')).toContain('N = 12 (tilted)');
    expect(caption(undefined)).toContain('N = 12');
    expect(bandStateNote('horizon', false)).toBe('Horizontal cut at the horizon: cells show file cut → horizon cut where they differ.');
    expect(bandStateNote('horizon', true)).toBe('Simulation active: cells show original → tilted where they differ (horizontal cut at the horizon).');
    expect(bandStateNote('beam', true)).toBe('Simulation active: cells show original → tilted where they differ (horizontal cut through the beam peak).');
  });
});

describe('plots at the horizon while no file is tilted', () => {
  it('the frequency chart calls its faint lines the file\'s own cut', () => {
    expect(metricCaption('F/B 180°', 'dB', true, false, false, true).items).toEqual(["Faint lines: the file's own cut"]);
    expect(hpbwCaption(3, true, false, true).items).toEqual(["Faint lines: the file's own cut"]);
    expect(metricCaption('F/B 180°', 'dB', true).items).toEqual(['Faint lines: original patterns before the simulated tilt']);
    expect(hpbwCaption(3, true).items).toEqual(['Faint lines: original patterns before the simulated tilt']);
  });

  it('the note under a cut plot without a legend calls the dashed lines the file\'s own cut', () => {
    const base = { traces: 24, byGroup: false, originals: true, referenceLabel: null };
    expect(traceNote({ ...base, fileCut: true })).toContain("(dashed = the file's own cut)");
    expect(traceNote({ ...base, fileCut: true })).not.toContain('original');
    expect(traceNote(base)).toContain('(dashed = original)');
  });
});
