import { describe, expect, it } from 'vitest';
import { BAND_PARAMS, bandTable, type BandCell, type BandColumn } from '../core/analysis/bandParams';
import { analyzeAll, DEFAULT_SETTINGS } from '../core/analysis/metrics';
import type { SubBand } from '../core/analysis/subBands';
import { bandItems } from '../test/bandFixture';
import { ADJUSTED_LEGEND, anyAdjusted, bandCsv, bandFollowsHCut, bandHistogramMarks, bandTsv, cellDisplay, defaultDataset, editSubBand, filesText, hintText, largestDataset, lobeLimitWarning, sameSubBands } from './bandView';

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

describe('excursion-adjusted cells', () => {
  const adjustedMetrics = new Map([...metrics].map(([id, m]) => [id, id === 'f0' ? { ...m, fbWindow: { value: 10 } } : { ...m, fbWindow: { value: 18 } }]));
  const adj = bandTable(items, adjustedMetrics, [{ name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 }], ctx);
  it('marks the text, keeps the number clean in the CSV and adds an Adjusted column', () => {
    expect(adj[0].cells.fbWindow.text).toBe('> 13.0 dB*');
    expect(cellDisplay(adj[0].cells.fbWindow).text).toBe('> 13.0 dB*');
    const line = bandCsv([{ label: 'Array Y1', columns: adj }], DEFAULT_SETTINGS).split('\r\n').find((l) => l.includes('F/B'));
    expect(line).toBe('Array Y1,1800–1900 MHz,1800,1900,F/B ±30°,dB,single-sided min,12,> 13.0 dB*,13.00,,,,18.00,10.00,18.00,,0,yes');
    const rest = bandCsv([{ label: 'Array Y1', columns: adj }], DEFAULT_SETTINGS).split('\r\n').filter((l) => l.endsWith(',yes'));
    expect(rest).toHaveLength(1);
  });
  it('shows the legend only when a visible cell is adjusted', () => {
    expect(ADJUSTED_LEGEND).toBe('* adjusted by the 3 dB excursion rule (BASTA 12.2)');
    expect(anyAdjusted(columns)).toBe(false);
    expect(anyAdjusted(adj)).toBe(true);
    expect(anyAdjusted(columns, adj)).toBe(true);
    expect(anyAdjusted(adj, columns)).toBe(true);
    expect(anyAdjusted([])).toBe(false);
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

describe('defaultDataset and filesText', () => {
  it('picks the dataset with the most files, the first on a tie', () => {
    const a = { key: 'a', label: 'a', items: items.slice(0, 3) };
    const b = { key: 'b', label: 'b', items };
    const c = { key: 'c', label: 'c', items };
    expect(defaultDataset([a, b, c])).toBe(b);
    expect(defaultDataset([a])).toBe(a);
    expect(defaultDataset([])).toBeUndefined();
  });
  it('uses the singular for one file', () => {
    expect([0, 1, 2].map(filesText)).toEqual(['0 files', '1 file', '2 files']);
  });
});

describe('lobeLimitWarning', () => {
  it('warns only for a non-standard first-lobe limit', () => {
    expect(lobeLimitWarning(DEFAULT_SETTINGS)).toBeNull();
    expect(lobeLimitWarning({ ...DEFAULT_SETTINGS, lobeLimitFactor: 2.5 })).toBe(
      'First-lobe limit is 2.5 × V-HPBW, not the standard 1.78: sidelobe and null-fill rows are non-standard.',
    );
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
  it('leaves the list unchanged for a bad number and does not mutate', () => {
    expect(editSubBand(auto, 0, { minMHz: NaN })).toEqual(auto);
    expect(auto[0].maxMHz).toBe(1880);
  });
  it('leaves the list unchanged when a frequency is above the limit', () => {
    const list: SubBand[] = [{ name: 'B3', minMHz: 1710, maxMHz: 1880 }, { name: 'B1', minMHz: 1920, maxMHz: 2170 }];
    expect(editSubBand(list, 0, { maxMHz: 188000 })).toEqual(list);
    expect(editSubBand(list, 1, { minMHz: 0 })).toEqual(list);
    expect(editSubBand(list, 0, { maxMHz: 100000 })[0].maxMHz).toBe(100000);
  });
});

describe('bandCsv', () => {
  const header =
    'Antenna,Sub-band,Min (MHz),Max (MHz),Parameter,Unit,Type,N,Statistic,Value,Tolerance,Lower,Upper,Percentile,Min,Max,Mean,Counted as 22 dB,Adjusted';
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
      'Array Y1,1800–1900 MHz,1800,1900,Azimuth beamwidth,°,double-sided,12,71.0° ± 9.5°,71.00,9.53,61.47,80.53,,60.00,82.00,71.00,0,',
    );
    expect(find('P2P tracking')).toBe(
      'Array Y1,1800–1900 MHz,1800,1900,P2P tracking (sector edges),dB,single-sided max,12,< 0.6 dB,0.65,,,,0.65,0.00,1.00,,0,',
    );
    expect(find('Gain, highest tilt')).toBe(
      'Array Y1,1800–1900 MHz,1800,1900,"Gain, highest tilt (6°)",dBi,mean,6,17.7 dBi @ 6°,17.66,,,,,17.20,18.10,17.66,0,',
    );
    expect(find('H-SLS')).toBe('Array Y1,1800–1900 MHz,1800,1900,H-SLS,dB,single-sided min,0,—,,,,,,,,,0,');
    expect(find('Electrical tilt range')).toContain('Electrical tilt range,°,absolute,2,2° – 6°,,,,,,2.00,6.00,,0,');
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

describe('bandCsv edge cases', () => {
  const band = [{ name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 }];
  const csvLines = (sheets: Parameters<typeof bandCsv>[0]) => bandCsv(sheets, DEFAULT_SETTINGS).split('\r\n');

  it('lists the antennas in sheet order', () => {
    const lines = csvLines([
      { label: 'Array Y1', columns },
      { label: 'Array R1', columns },
    ]);
    expect(lines).toHaveLength(2 + 2 * BAND_PARAMS.length);
    expect(lines.slice(1, 1 + BAND_PARAMS.length).every((l) => l.startsWith('Array Y1,'))).toBe(true);
    expect(lines.slice(1 + BAND_PARAMS.length, -1).every((l) => l.startsWith('Array R1,'))).toBe(true);
  });

  it('writes both states, each with its own numbers, when the tilted run differs', () => {
    const tiltedMetrics = new Map([...metrics].map(([id, m]) => [id, { ...m, h: { ...m.h, hpbw: { value: (m.h.hpbw.value ?? 0) + 10 } } }]));
    const tilted = bandTable(items, tiltedMetrics, band, ctx);
    const lines = csvLines([{ label: 'Array Y1', columns, tilted }]);
    expect(lines).toHaveLength(2 + 2 * BAND_PARAMS.length);
    const az = lines.filter((l) => l.includes('Azimuth beamwidth'));
    expect(az).toHaveLength(2);
    expect(az[0].startsWith('Array Y1,original,')).toBe(true);
    expect(az[0]).toContain(',71.0° ± 9.5°,71.00,');
    expect(az[1].startsWith('Array Y1,tilted,')).toBe(true);
    expect(az[1]).toContain(',81.0° ± 9.5°,81.00,');
    expect(lines.filter((l) => l.includes('Elevation beamwidth'))[0].split(',').slice(2)).toEqual(
      lines.filter((l) => l.includes('Elevation beamwidth'))[1].split(',').slice(2),
    );
  });

  it('writes an empty cell with no numbers and a few-samples cell with its range', () => {
    const empty = bandTable(items, metrics, [{ name: '880–960 MHz', minMHz: 880, maxMHz: 960 }], ctx)[0];
    const emptyLine = csvLines([{ label: 'Array Y1', columns: [empty] }]).find((l) => l.includes('Azimuth beamwidth'));
    expect(emptyLine).toBe('Array Y1,880–960 MHz,880,960,Azimuth beamwidth,°,double-sided,0,—,,,,,,,,,0,');

    const few = bandTable(items.slice(0, 4), metrics, band, ctx)[0];
    expect(few.cells.hHpbw.state).toBe('few');
    const line = csvLines([{ label: 'Array Y1', columns: [few] }]).find((l) => l.includes('Azimuth beamwidth'))!;
    const f = line.split(',');
    expect(f.slice(7, 9)).toEqual(['4', few.cells.hHpbw.text]);
    expect(f.slice(9, 14)).toEqual(['', '', '', '', '']);
    expect(f[14]).toBe(Math.min(...few.cells.hHpbw.values).toFixed(2));
    expect(f[15]).toBe(Math.max(...few.cells.hHpbw.values).toFixed(2));
    expect(f[16]).toBe('');
  });

  it('guards a text that starts like a formula', () => {
    const line = csvLines([{ label: '=Site', columns }])[1];
    expect(line.startsWith("'=Site,")).toBe(true);
    for (const lead of ['\t', '\r']) {
      expect(csvLines([{ label: `${lead}x`, columns }])[1].startsWith(`"'${lead}x",`) || csvLines([{ label: `${lead}x`, columns }])[1].startsWith(`'${lead}x,`)).toBe(true);
    }
    const named = [{ ...columns[0], subBand: { ...columns[0].subBand, name: '-B3' } }];
    expect(csvLines([{ label: 'A', columns: named }])[1].startsWith("A,'-B3,")).toBe(true);
  });

  it('leaves statistic text that starts with a sign unquoted', () => {
    const squint = { ...columns[0], cells: { ...columns[0].cells, squint: { ...columns[0].cells.squint, text: '-0.3° ± 1.0°' } } };
    const line = csvLines([{ label: 'A', columns: [squint] }]).find((l) => l.includes('squint'))!;
    expect(line).toContain(',-0.3° ± 1.0°,');
    expect(line).not.toContain("'");
  });
});

describe('sameSubBands', () => {
  const a = [{ name: 'X', minMHz: 1, maxMHz: 2 }];
  it('compares name and range', () => {
    expect(sameSubBands(a, [{ name: 'X', minMHz: 1, maxMHz: 2 }])).toBe(true);
    expect(sameSubBands(a, [{ name: 'Y', minMHz: 1, maxMHz: 2 }])).toBe(false);
    expect(sameSubBands(a, [{ name: 'X', minMHz: 1, maxMHz: 3 }])).toBe(false);
    expect(sameSubBands(a, [])).toBe(false);
  });
  it('tells a no-op edit from a real one', () => {
    expect(sameSubBands(a, editSubBand(a, 0, { minMHz: 1 }))).toBe(true);
    expect(sameSubBands(a, editSubBand(a, 0, { name: '  X ' }))).toBe(true);
    expect(sameSubBands(a, editSubBand(a, 0, { minMHz: 1.5 }))).toBe(false);
  });
});

describe('bandTsv', () => {
  const settings = { ...DEFAULT_SETTINGS };
  const mkCell = (text: string) => ({ text, title: '', state: 'ok', n: 3, values: [], unit: 'dB' }) as unknown as BandCell;
  const column = (name: string, text: string): BandColumn => ({
    subBand: { name, minMHz: 1, maxMHz: 2 },
    files: 4,
    cells: Object.fromEntries(BAND_PARAMS.map((p) => [p.key, mkCell(text)])) as BandColumn['cells'],
  } as BandColumn);

  it('has a header with the sub-bands and a line per parameter with the shown text, tilted where it differs', () => {
    const lines = bandTsv([column('=evil', '25.0 ± 2.0')], [column('=evil', '24.0 ± 2.0')], settings).trimEnd().split('\r\n');
    expect(lines).toHaveLength(BAND_PARAMS.length + 1);
    expect(lines[0]).toBe("Parameter\t'=evil (4 files)");
    expect(lines[1].split('\t')[1]).toBe('25.0 ± 2.0 → 24.0 ± 2.0');
    expect(bandTsv([column('a', '1')], null, settings).split('\r\n')[1].split('\t')[1]).toBe('1');
  });

  it('guards only the user text: a computed negative cell is copied without a leading quote', () => {
    const line = bandTsv([column('-odd\tname', '-0.4° ± 0.6°')], null, settings).split('\r\n');
    expect(line[0].split('\t')[1]).toBe("'-odd name (4 files)");
    expect(line[1].split('\t')[1]).toBe('-0.4° ± 0.6°');
    expect(bandTsv([column('a', 'x\ty')], null, settings).split('\r\n')[1].split('\t')).toHaveLength(2);
  });
});

describe('band histogram marks at the horizon with no tilt', () => {
  // Only the horizontal cut at the horizon is simulated: `simulatedAmong(hCutCounts)` is true only when the cut counts.
  const horizonOnly = (hCutCounts: boolean) => hCutCounts;
  const tiltedFile = () => true;
  const nothing = () => false;
  it('marks a parameter read from the horizontal cut and names the cut', () => {
    for (const key of ['hHpbw', 'squint', 'fbWindow', 'hSls', 'tracking', 'rollOff', 'air'] as const) {
      expect(bandFollowsHCut(key)).toBe(true);
      expect(bandHistogramMarks(key, horizonOnly)).toEqual({ simulated: true, namesHCut: true });
    }
  });
  it('does not mark a parameter of the vertical cut or a declared one, and does not name the cut', () => {
    for (const key of ['vHpbw', 'gainAll', 'gainMinTilt', 'tiltRange', 'tiltDeviation', 'firstUsls', 'usls', 'uslsHorizon', 'uslsMax', 'nullFill', 'firstLsls'] as const) {
      expect(bandFollowsHCut(key)).toBe(false);
      expect(bandHistogramMarks(key, horizonOnly)).toEqual({ simulated: false, namesHCut: false });
    }
  });
  it('marks a vertical parameter when a file is tilted, without naming the horizontal cut', () => {
    expect(bandHistogramMarks('vHpbw', tiltedFile)).toEqual({ simulated: true, namesHCut: false });
    expect(bandHistogramMarks('hHpbw', nothing)).toEqual({ simulated: false, namesHCut: true });
  });
  it('leaves the State of a vertical parameter as "tilted" in the CSV and marks only the horizontal ones', () => {
    const lines = bandCsv([{ label: 'Array Y1', columns, tilted: columns }], DEFAULT_SETTINGS, true).split('\r\n');
    const state = (label: string) => lines.filter((l) => l.includes(`,${label},`)).map((l) => l.split(',')[1]);
    expect(state('Azimuth beamwidth')).toEqual(['original', 'tilted [H cut at the horizon]']);
    expect(state('Elevation beamwidth')).toEqual(['original', 'tilted']);
  });
});
