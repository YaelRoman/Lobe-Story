import { describe, expect, it } from 'vitest';
import { BAND_PARAMS, bandTable, type BandCell } from '../core/analysis/bandParams';
import { analyzeAll, DEFAULT_SETTINGS } from '../core/analysis/metrics';
import type { SubBand } from '../core/analysis/subBands';
import { bandItems } from '../test/bandFixture';
import { bandCsv, cellDisplay, editSubBand, hintText, largestDataset } from './bandView';

const items = bandItems();
const metrics = analyzeAll(items, DEFAULT_SETTINGS);
const ctx = { gainUnit: 'dBi' as const, settings: DEFAULT_SETTINGS };
const columns = bandTable(items, metrics, [{ name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 }], ctx);
const cell = (key: string): BandCell => columns[0].cells[key as keyof (typeof columns)[0]['cells']];

describe('cellDisplay', () => {
  it('shows a single cell and mutes cells that are not ok', () => {
    const ok = cell('hHpbw');
    expect(cellDisplay(ok)).toEqual({ text: ok.text, title: ok.title, muted: false });
    const few = { ...ok, state: 'few' as const };
    expect(cellDisplay(few).muted).toBe(true);
    expect(cellDisplay(ok, ok).text).toBe(ok.text);
  });
  it('shows original → tilted when the texts differ', () => {
    const a = cell('hHpbw');
    const b = { ...a, text: '70.0° ± 1.0°', title: 'T' };
    const d = cellDisplay(a, b);
    expect(d.text).toBe(`${a.text} → ${b.text}`);
    expect(d.title.startsWith('original: ')).toBe(true);
    expect(d.title).toContain('\ntilted: T');
    expect(cellDisplay(a, { ...b, state: 'empty' }).muted).toBe(true);
    expect(cellDisplay({ ...a, state: 'empty' }, b).muted).toBe(false);
  });
});

describe('hint', () => {
  it('names the minimum and the largest set', () => {
    expect(hintText(2)).toBe(
      'Band statistics need at least 10 files of one antenna (frequencies × tilts × ports). Largest set loaded: 2.',
    );
    expect(largestDataset([])).toBe(0);
    expect(largestDataset([{ key: 'a', label: 'a', items: items.slice(0, 3) }, { key: 'b', label: 'b', items }])).toBe(12);
  });
});

describe('editSubBand', () => {
  const auto: SubBand[] = [{ name: '1710–1880 MHz', minMHz: 1710, maxMHz: 1880 }];
  it('keeps an automatic name in step with the range', () => {
    expect(editSubBand(auto, 0, { maxMHz: 1990 })[0].name).toBe('1710–1990 MHz');
    expect(editSubBand(auto, 0, { minMHz: 2000 })).toEqual([{ name: '1880–2000 MHz', minMHz: 1880, maxMHz: 2000 }]);
  });
  it('keeps a custom name and trims a typed one', () => {
    expect(editSubBand([{ ...auto[0], name: 'B3' }], 0, { maxMHz: 1990 })[0].name).toBe('B3');
    expect(editSubBand(auto, 0, { name: '  DCS ' })[0].name).toBe('DCS');
  });
  it('drops an entry with a bad number and does not mutate', () => {
    expect(editSubBand(auto, 0, { minMHz: NaN })).toEqual([]);
    expect(auto[0].maxMHz).toBe(1880);
  });
});

describe('bandCsv', () => {
  const header =
    'Antenna,Sub-band,Min (MHz),Max (MHz),Parameter,Unit,Type,N,Statistic,Value,Tolerance,Lower,Upper,Percentile,Min,Max,Mean,Counted as 22 dB';
  const csv = bandCsv([{ label: 'Array Y1', columns }], DEFAULT_SETTINGS);
  const lines = csv.split('\r\n');
  const find = (s: string) => lines.find((l) => l.includes(s));

  it('writes one line per parameter', () => {
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(lines).toHaveLength(22);
    expect(lines[0]).toBe(header);
    expect(lines.length - 2).toBe(BAND_PARAMS.length);
  });
  it('writes each validation type', () => {
    expect(find('Azimuth beamwidth')).toBe(
      'Array Y1,1800–1900 MHz,1800,1900,Azimuth beamwidth,°,double-sided,12,71.0° ± 9.5°,71.00,9.53,61.47,80.53,,60.00,82.00,71.00,0',
    );
    expect(find('P2P tracking')).toBe(
      'Array Y1,1800–1900 MHz,1800,1900,P2P tracking (sector edges),dB,single-sided max,12,< 0.6 dB,0.65,,,,0.65,0.00,1.00,,0',
    );
    expect(find('Gain, highest tilt')).toBe(
      'Array Y1,1800–1900 MHz,1800,1900,"Gain, highest tilt (6°)",dBi,mean,6,17.7 dBi @ 6°,17.66,,,,,17.20,18.10,17.66,0',
    );
    expect(find('H-SLS')).toBe('Array Y1,1800–1900 MHz,1800,1900,H-SLS,dB,single-sided min,0,—,,,,,,,,,0');
    expect(find('Electrical tilt range')).toContain('Electrical tilt range,°,absolute,2,2° – 6°,,,,,,2.00,6.00,,0');
  });
  it('doubles every line with a State column when a tilted run is given', () => {
    const t = bandCsv([{ label: 'Array Y1', columns, tilted: columns }], DEFAULT_SETTINGS).split('\r\n');
    expect(t[0].startsWith('Antenna,State,Sub-band')).toBe(true);
    expect(t).toHaveLength(42);
    expect(t[1].startsWith('Array Y1,original,')).toBe(true);
    expect(t[2].startsWith('Array Y1,tilted,')).toBe(true);
    expect(t[3].startsWith('Array Y1,original,')).toBe(true);
  });
});
