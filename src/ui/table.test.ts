import { describe, expect, it } from 'vitest';
import {
  buildRows, columnLabel, columnTitle, convertGain, formatCell, METRIC_COLUMNS, COLUMN_GROUPS, visibleColumns,
  simulationLabel, toCsv, offsetLabel, csvCell, csvText, clearOfSticky, METRIC_KEYS,
  nextSort, revealScrollTop, sortIfShown, shouldReveal, sortRows, sortValue, ariaSort, type MetricsRow, type SortState,
} from './table';
import { DEFAULT_TABLE_GROUPS, type ColumnGroupKey } from '../state/store';
import { analyzeAll, DEFAULT_SETTINGS } from '../core/analysis/metrics';
import { analyzeTilted, tiltTagged, effectiveFor, isTilted, tiltEach, type SimSettings } from '../core/analysis/tilt';
import { groupPatterns } from '../state/selectors';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';

describe('convertGain', () => {
  it('converts between dBd and dBi', () => {
    expect(convertGain({ value: 15, unit: 'dBd' }, 'dBi')).toBeCloseTo(17.15);
    expect(convertGain({ value: 17.15, unit: 'dBi' }, 'dBd')).toBeCloseTo(15);
    expect(convertGain({ value: 15, unit: 'dBd' }, 'dBd')).toBe(15);
    expect(convertGain(undefined, 'dBi')).toBeNull();
  });
});

describe('buildRows and toCsv', () => {
  const pattern = patternFrom(quadBeam(60), vBeamWithLobes, {
    id: 'dir/"odd, name".MSI',
    fileName: '"odd, name".MSI',
    gain: { value: 15, unit: 'dBd' },
  });
  const tagged = [{ pattern, tags: { polarization: '+45', tiltDeg: 6 } }];
  const groups = groupPatterns(tagged);
  const rows = buildRows(groups, analyzeAll(tagged), 'dBi');

  it('builds one row per pattern', () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'dir/"odd, name".MSI', file: '"odd, name".MSI', group: '+45 · 6°T', freq: 1800 });
    expect(rows[0].gain).toBeCloseTo(17.15);
    expect(rows[0].cells.hHpbw.value).toBeCloseTo(60, 5);
    expect(rows[0].cells.tracking.value).toBeNull();
    expect(Object.keys(rows[0].cells)).toEqual(METRIC_COLUMNS.map((c) => c.key));
  });

  it('writes CSV with escaped cells and empty nulls', () => {
    const csv = toCsv(rows, 'dBi', 30);
    const [header, line] = csv.trimEnd().split('\r\n');
    expect(
      header.startsWith(
        'File,Group,Frequency (MHz),Gain (dBi),H-HPBW (°),V-HPBW (°),H-BW 10 dB (°),V-BW 10 dB (°),Squint (°),Peak az (°),Tilt (°),Peak tilt (°),Tilt error (°),F/B 180° (dB),F/B ±30° (dB)',
      ),
    ).toBe(true);
    expect(line.startsWith('"""odd, name"".MSI",\'+45 · 6°T,1800,17.15,60.00,8.00,109.54,14.22,')).toBe(true);
    expect(line.split(',').length).toBeGreaterThan(10);
    expect(line).toContain(',,'); // null tracking / deltas are empty
  });
});

describe('simulation in the table', () => {
  const pattern = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'p', fileName: 'p.MSI' });
  const tagged = [{ pattern, tags: { polarization: '+45', tiltDeg: 6 } }];
  const groups = groupPatterns(tagged);
  const tilt = { electricalDeg: 4, mechanicalDeg: 0 };
  const tilted = analyzeTilted(tiltTagged(tagged, tilt, 'summation'), DEFAULT_SETTINGS, tilt);
  const rows = buildRows(groups, analyzeAll(tagged), 'dBd', tilted);

  it('formats original → tilted with both reasons', () => {
    expect(formatCell({ value: 6 }, { value: 10 })).toEqual({ text: '6.0 → 10.0' });
    expect(formatCell({ value: 6 })).toEqual({ text: '6.0', title: undefined });
    expect(formatCell({ value: null, reason: 'a' }, { value: null, reason: 'b' })).toEqual({
      text: '— → —',
      title: 'original: a\ntilted: b',
    });
  });

  it('labels the simulation', () => {
    expect(simulationLabel(tilt)).toBe('Simulated: Δe +4°, mech 0°');
    expect(simulationLabel({ electricalDeg: -1.5, mechanicalDeg: 2 })).toBe('Simulated: Δe -1.5°, mech +2°');
  });

  it('adds tilted cells to rows', () => {
    expect(rows[0].cells.tilt.value).toBeCloseTo(6, 5);
    expect(rows[0].tilted!.tilt!.value).toBeCloseTo(10, 5);
  });

  it('doubles metric columns and appends slider values in the CSV when tilted', () => {
    const [header, line] = toCsv(rows, 'dBd', 30, { ...tilt, azimuthDeg: 30 }).trimEnd().split('\r\n');
    expect(header).toContain('H-HPBW original (°),H-HPBW tilted (°)');
    expect(header.endsWith('Electrical tilt Δ (°),Mechanical tilt (°),Azimuth (°)')).toBe(true);
    expect(line.endsWith(',4,0,30')).toBe(true);
  });

  it('ignores an azimuth-only simulation in the CSV', () => {
    const plain = buildRows(groups, analyzeAll(tagged), 'dBd');
    expect(toCsv(plain, 'dBd', 30, { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 45 })).toBe(
      toCsv(plain, 'dBd', 30),
    );
  });

  it('leaves the CSV unchanged without a tilt', () => {
    const plain = buildRows(groups, analyzeAll(tagged), 'dBd');
    expect(toCsv(plain, 'dBd', 30)).not.toContain('original');
  });
});

describe('per-file simulation in the table', () => {
  const pa = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'a', fileName: 'a.MSI' });
  const pb = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b', fileName: 'b.MSI' });
  const tagged = [
    { pattern: pa, tags: { polarization: '+45', tiltDeg: 6 } },
    { pattern: pb, tags: { polarization: '+45', tiltDeg: 6 } },
  ];
  const groups = groupPatterns(tagged);
  const global: SimSettings = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 5 };
  const offsets: Record<string, SimSettings> = { b: { electricalDeg: 0, mechanicalDeg: 4, azimuthDeg: 10 } };
  const effective = (id: string) => effectiveFor(global, offsets[id]);
  const isTiltedId = (id: string) => isTilted(effective(id));
  const tiltedMetrics = analyzeTilted(tiltEach(tagged, effective, 'summation'), DEFAULT_SETTINGS, effective);
  const rows = buildRows(groups, analyzeAll(tagged), 'dBd', tiltedMetrics, isTiltedId);

  it('shows arrows only on tilted rows', () => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('a')!.tilted).toBeUndefined();
    expect(byId.get('b')!.tilted!.tilt!.value).toBeCloseTo(10, 5);
  });

  it('writes per-row effective slider values and repeats untilted values', () => {
    const lines = toCsv(rows, 'dBd', 30, effective).trimEnd().split('\r\n');
    expect(lines[0]).toContain('Tilt original (°),Tilt tilted (°)');
    const lineA = lines.find((l) => l.startsWith('a.MSI'))!;
    const lineB = lines.find((l) => l.startsWith('b.MSI'))!;
    expect(lineA.endsWith(',0,0,5')).toBe(true);
    expect(lineB.endsWith(',0,4,15')).toBe(true);
    expect(lineA).toMatch(/,6\.00,6\.00,/); // tilt original and tilted equal for the untilted row
  });

  it('labels offsets', () => {
    expect(simulationLabel({ electricalDeg: 0, mechanicalDeg: 0 }, 1)).toBe(
      'Simulated: Δe 0°, mech 0° + offsets on 1 file',
    );
    expect(simulationLabel({ electricalDeg: 2, mechanicalDeg: 0 }, 3)).toBe(
      'Simulated: Δe +2°, mech 0° + offsets on 3 files',
    );
    expect(offsetLabel({ electricalDeg: 1, mechanicalDeg: 2, azimuthDeg: -30 })).toBe('Δe +1°, mech +2°, az -30°');
    expect(offsetLabel({ electricalDeg: 0, mechanicalDeg: 3, azimuthDeg: 0 })).toBe('mech +3°');
  });
});

describe('beam tracking arrow for an untilted partner (I1)', () => {
  const pa = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'a', fileName: 'a.MSI' });
  const pb = patternFrom(quadBeam(58), vBeamWithLobes, { id: 'b', fileName: 'b.MSI' });
  const tagged = [
    { pattern: pa, tags: { polarization: '+45', tiltDeg: 6 } },
    { pattern: pb, tags: { polarization: '-45', tiltDeg: 6 } },
  ];
  const groups = groupPatterns(tagged);
  const global: SimSettings = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
  // Only 'a' is tilted; 'b' is untilted but is a's ±45 tracking partner.
  const offsets: Record<string, SimSettings> = { a: { electricalDeg: 0, mechanicalDeg: 6, azimuthDeg: 0 } };
  const effective = (id: string) => effectiveFor(global, offsets[id]);
  const isTiltedId = (id: string) => isTilted(effective(id));
  const original = analyzeAll(tagged);
  const tiltedMetrics = analyzeTilted(tiltEach(tagged, effective, 'summation'), DEFAULT_SETTINGS, effective);
  const rows = buildRows(groups, original, 'dBd', tiltedMetrics, isTiltedId);
  const byId = new Map(rows.map((r) => [r.id, r]));

  it("B's tracking value changes under the tilted run (A's tilted H cut)", () => {
    expect(isTiltedId('a')).toBe(true);
    expect(isTiltedId('b')).toBe(false);
    expect(original.get('b')!.beamTracking.value).not.toBeNull();
    expect(tiltedMetrics.get('b')!.beamTracking.value).not.toBeNull();
    expect(tiltedMetrics.get('b')!.beamTracking.value).not.toBe(original.get('b')!.beamTracking.value);
  });

  it('attaches a tilted entry for every cell on the tilted row, and only the tracking cell on the untilted row', () => {
    const rowA = byId.get('a')!;
    const rowB = byId.get('b')!;
    expect(Object.keys(rowA.tilted!).sort()).toEqual(METRIC_COLUMNS.map((c) => c.key).sort());
    expect(rowB.tilted).toEqual({ tracking: tiltedMetrics.get('b')!.beamTracking });
  });

  it("shows B's tracking tilted value in the CSV instead of repeating the original", () => {
    const csv = toCsv(rows, 'dBd', 30, effective);
    const [header, ...lines] = csv.trimEnd().split('\r\n');
    const cols = header.split(',');
    const origIdx = cols.indexOf('P2P tracking original (dB)');
    const tiltIdx = cols.indexOf('P2P tracking tilted (dB)');
    const lineB = lines.find((l) => l.startsWith('b.MSI'))!.split(',');
    expect(lineB[origIdx]).not.toBe(lineB[tiltIdx]);
  });
});

describe('display names in the table', () => {
  const p = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'a#copy-2', fileName: 'a.MSI', displayName: 'North' });
  const tagged = [{ pattern: p, tags: { polarization: '+45', tiltDeg: 6 } }];
  const rows = buildRows(groupPatterns(tagged), analyzeAll(tagged), 'dBd');

  it('shows the display name and keeps the source file', () => {
    expect(rows[0].file).toBe('North');
    expect(rows[0].source).toBe('a.MSI');
    const [header, line] = toCsv(rows, 'dBd', 30).trimEnd().split('\r\n');
    expect(header.startsWith('File,Source file,Group,')).toBe(true);
    expect(line.startsWith('North,a.MSI,')).toBe(true);
  });

  it('leaves the CSV unchanged without copies or names', () => {
    const plain = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b', fileName: 'b.MSI' });
    const t = [{ pattern: plain, tags: {} }];
    expect(toCsv(buildRows(groupPatterns(t), analyzeAll(t), 'dBd'), 'dBd', 30)).not.toContain('Source file');
  });

  it('counts groups in the simulation label', () => {
    expect(simulationLabel({ electricalDeg: 0, mechanicalDeg: 0 }, 1, 2)).toBe(
      'Simulated: Δe 0°, mech 0° + offsets on 1 file, 2 groups',
    );
    expect(simulationLabel({ electricalDeg: 0, mechanicalDeg: 0 }, 0, 1)).toBe(
      'Simulated: Δe 0°, mech 0° + offsets on 1 group',
    );
  });
});

describe('sector columns', () => {
  const pattern = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'p', fileName: 'p.MSI' });
  const tagged = [{ pattern, tags: {} }];
  const m = analyzeAll(tagged);
  const rows = buildRows(groupPatterns(tagged), m, 'dBd');

  it('adds the six columns after tracking in order', () => {
    const keys = METRIC_COLUMNS.map((c) => c.key);
    const i = keys.indexOf('tracking');
    expect(keys.slice(i + 1, i + 7)).toEqual(['spr', 'air', 'rollOff', 'du16', 'du64', 'du256']);
    expect(METRIC_COLUMNS.slice(i, i + 7).map((c) => `${c.label} ${c.unit}`)).toEqual([
      'P2P tracking dB', 'SPR %', 'AIR dB', 'Roll-off dB', 'D/U 16QAM °', 'D/U 64QAM °', 'D/U 256QAM °',
    ]);
  });

  it('fills the cells from the metrics and exports them to CSV', () => {
    const p = m.get('p')!;
    expect(rows[0].cells.spr).toBe(p.spr);
    expect(rows[0].cells.du256).toBe(p.du.qam256);
    expect(rows[0].cells.rollOff).toBe(p.rollOff);
    const [header, line] = toCsv(rows, 'dBd', 30).trimEnd().split('\r\n');
    expect(header).toContain('SPR (%),AIR (dB),Roll-off (dB),D/U 16QAM (°),D/U 64QAM (°),D/U 256QAM (°)');
    expect(line.split(',')).toHaveLength(header.split(',').length);
  });

  it('builds tooltips from the sector settings', () => {
    const s = { sectorEdgeDeg: 45, siteSectors: 6 };
    expect(columnTitle('spr', s)).toBe('Sector power ratio: power outside ±45° / power inside (co-pol)');
    expect(columnTitle('air', s)).toBe('Azimuth interference ratio: 10·log10(inside/outside), co-pol only');
    expect(columnTitle('rollOff', s)).toBe('Level at the ±45° sector edges below the peak (worse edge)');
    expect(columnTitle('tracking', s)).toBe(
      'Azimuth beam port-to-port tracking within ±45° (gain-aware when both gains are declared)',
    );
    expect(columnTitle('du16', s)).toBe(
      'Width around boresight where this pattern is ≥ 15 dB above the neighbouring sectors (6-sector site)',
    );
    expect(columnTitle('du64', s)).toContain('≥ 20 dB');
    expect(columnTitle('du256', s)).toContain('≥ 25 dB');
    expect(columnTitle('hHpbw', { ...s, levelDb: 6 })).toContain('6 dB below the peak');
    expect(columnTitle('fbWindow', { ...s, fbWindowDeg: 25 })).toContain('180° ± 25°');
  });

  it('gives every column a header tooltip', () => {
    const s = { sectorEdgeDeg: 60, siteSectors: 3 };
    for (const c of METRIC_COLUMNS) expect(columnTitle(c.key, s), c.key).toBeTruthy();
  });
});

describe('column groups', () => {
  const order = COLUMN_GROUPS.map((g) => g.key);

  it('keeps each group contiguous, in group order', () => {
    const idx = METRIC_COLUMNS.map((c) => order.indexOf(c.group));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('shows all but the declared columns by default', () => {
    const keys = visibleColumns(DEFAULT_TABLE_GROUPS).map((c) => c.key);
    expect(keys).toHaveLength(25);
    for (const k of ['dH', 'dV', 'dFb']) expect(keys).not.toContain(k);
  });

  it('orders the beam group', () => {
    expect(METRIC_COLUMNS.filter((c) => c.group === 'beam').map((c) => c.key)).toEqual([
      'hHpbw', 'vHpbw', 'hBw10', 'vBw10', 'squint', 'hPeak', 'tilt', 'vPeak', 'tiltError',
    ]);
    expect(METRIC_COLUMNS.filter((c) => ['hBw10', 'vBw10', 'hPeak', 'vPeak'].includes(c.key)).map((c) => `${c.label} ${c.unit}`)).toEqual([
      'H-BW 10 dB °', 'V-BW 10 dB °', 'Peak az °', 'Peak tilt °',
    ]);
  });

  it('describes the beam columns in header tooltips', () => {
    const s = { sectorEdgeDeg: 60, siteSectors: 3 };
    expect(columnTitle('hBw10', s)).toBe('Azimuth beamwidth 10 dB below the peak of the cut (BASTA 6.1.6)');
    expect(columnTitle('vBw10', s)).toBe('Elevation beamwidth 10 dB below the peak of the cut (BASTA 6.1.6)');
    expect(columnTitle('hPeak', s)).toBe(
      'Azimuth of the strongest co-pol level (BASTA beam direction); Squint is the bisector of the beamwidth points',
    );
    expect(columnTitle('vPeak', s)).toBe(
      'Elevation of the strongest co-pol level, positive below the horizon; Tilt is the bisector of the beamwidth points',
    );
    expect(columnTitle('squint', s)).toBe('Azimuth beam squint: bisector of the beamwidth points relative to boresight (0°)');
    expect(columnTitle('tilt', s)).toBe(
      'Electrical downtilt: bisector of the beamwidth points of the elevation cut (BASTA half-power beam axis), positive below the horizon',
    );
    expect(columnTitle('tiltError', s)).toBe('Tilt minus the nominal tilt, signed (BASTA downtilt deviation is its absolute value)');
    expect(columnTitle('hHpbw', s)).toContain('3 dB below the peak');
  });

  it('filters by group', () => {
    const none = Object.fromEntries(order.map((k) => [k, false])) as Record<ColumnGroupKey, boolean>;
    expect(visibleColumns(none)).toEqual([]);
    expect(visibleColumns({ ...none, fb: true }).map((c) => c.key)).toEqual(['fb180', 'fbWindow']);
  });
});

describe('sidelobe columns', () => {
  const pattern = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'p', fileName: 'p.MSI' });
  const tagged = [{ pattern, tags: {} }];
  const rows = buildRows(groupPatterns(tagged), analyzeAll(tagged), 'dBd');

  it('orders the sidelobes group', () => {
    expect(METRIC_COLUMNS.filter((c) => c.group === 'sidelobes').map((c) => [c.key, c.label, c.unit])).toEqual([
      ['firstUsls', 'First USLS', 'dB'],
      ['usls', 'USLS peak to 20°', 'dB'],
      ['uslsHorizon', 'USLS horizon to 20°', 'dB'],
      ['uslsMax', 'USLS max', 'dB'],
      ['nullFill', 'Null fill', 'dB'],
      ['firstLsls', 'First LSLS', 'dB'],
      ['hSls', 'H-SLS', 'dB'],
    ]);
    expect(visibleColumns(DEFAULT_TABLE_GROUPS)).toHaveLength(25);
    expect(METRIC_COLUMNS).toHaveLength(28);
  });

  it('maps the cells to the metrics fields', () => {
    const m = analyzeAll(tagged).get('p')!;
    for (const k of ['firstUsls', 'usls', 'uslsHorizon', 'uslsMax', 'nullFill', 'firstLsls', 'hSls'] as const) {
      expect(rows[0].cells[k]).toEqual(m[k]);
    }
  });

  it('labels the USLS columns with the window and exports them', () => {
    expect(columnLabel({ key: 'usls', label: 'x' }, 30, 12)).toBe('USLS peak to 12°');
    expect(columnLabel({ key: 'uslsHorizon', label: 'x' }, 30, 12)).toBe('USLS horizon to 12°');
    expect(columnLabel({ key: 'fbWindow', label: 'x' }, 30)).toBe('F/B ±30°');
    const [header, line] = toCsv(rows, 'dBd', 30).trimEnd().split('\r\n');
    expect(header).toContain(
      'First USLS (dB),USLS peak to 20° (dB),USLS horizon to 20° (dB),USLS max (dB),Null fill (dB),First LSLS (dB),H-SLS (dB)',
    );
    expect(line.split(',')).toHaveLength(header.split(',').length);
    const [h15] = toCsv(rows, 'dBd', 30, undefined, 15).trimEnd().split('\r\n');
    expect(h15).toContain('USLS peak to 15° (dB),USLS horizon to 15° (dB)');
  });

  it('builds the sidelobe tooltips', () => {
    const s = { sectorEdgeDeg: 45, siteSectors: 3, uslsRangeDeg: 15 };
    expect(columnTitle('firstUsls', s)).toBe(
      'First upper sidelobe suppression (BASTA 7.8.4.2): first sidelobe peak within 1.78 × V-HPBW above the beam peak, else the level at 1.55 × V-HPBW above it (merged sidelobe)',
    );
    expect(columnTitle('usls', s)).toBe(
      'Upper sidelobe suppression, beam peak to 15° above it (BASTA 7.8.4.3): highest level beyond the main beam in that window; — when only the main beam is in the window',
    );
    expect(columnTitle('uslsHorizon', s)).toBe(
      'Upper sidelobe suppression, horizon to 15° above it (BASTA 7.8.4.5, elevation cut only); — when only the main beam is in the window',
    );
    expect(columnTitle('uslsMax', s)).toBe('Maximum upper sidelobe suppression, beam peak to zenith (BASTA 7.8.4.4)');
    expect(columnTitle('nullFill', s)).toBe(
      'Null fill (BASTA 7.8.3): depth below the peak of the first null below the main beam, or of the merged first lower sidelobe at 1.55 × V-HPBW',
    );
    expect(columnTitle('firstLsls', s)).toBe('First lower sidelobe suppression: as First USLS, below the beam peak');
    expect(columnTitle('hSls', s)).toBe(
      'Maximum horizontal sidelobe suppression within ±45° (BASTA 7.8.4.1): highest level beyond the first nulls of the azimuth main beam',
    );
    expect(columnTitle('usls', { sectorEdgeDeg: 60, siteSectors: 3 })).toContain('beam peak to 20° above it');
  });

  it('shows merged and not-available notes in the cell tooltip', () => {
    const q = patternFrom(quadBeam(60), quadBeam(8, 6), { id: 'q', fileName: 'q.MSI' });
    const t = [{ pattern: q, tags: {} }];
    const r = buildRows(groupPatterns(t), analyzeAll(t), 'dBd')[0];
    const merged = formatCell(r.cells.nullFill);
    expect(merged.text).toBe('28.9');
    expect(merged.title).toMatch(/Merged with the main beam/);
    // A real "not available" result: the 8° window ends inside the main beam of vBeamWithLobes.
    const lobes = [{ pattern, tags: {} }];
    const narrow = analyzeAll(lobes, { ...DEFAULT_SETTINGS, uslsRangeDeg: 8 });
    expect(narrow.get('p')!.usls.notAvailable).toBe(true);
    const na = formatCell(buildRows(groupPatterns(lobes), narrow, 'dBd')[0].cells.usls);
    expect(na.text).toBe('—');
    expect(na.title).toMatch(/only the main beam/);
  });

  it('shows the configured first-lobe limit in the First USLS tooltip', () => {
    const s = { sectorEdgeDeg: 60, siteSectors: 3, lobeLimitFactor: 2.5 };
    expect(columnTitle('firstUsls', s)).toContain('within 2.5 × V-HPBW above the beam peak');
    expect(columnTitle('firstUsls', s)).not.toContain('1.78');
  });

  it('exports the declared columns although the group is hidden by default', () => {
    expect(DEFAULT_TABLE_GROUPS.declared).toBe(false);
    const [header] = toCsv(rows, 'dBd', 30).trimEnd().split('\r\n');
    expect(header).toContain('ΔH-HPBW (°),ΔV-HPBW (°),ΔF/B (dB)');
  });
});

describe('csvCell and csvText', () => {
  it('csvCell only quotes for CSV syntax', () => {
    for (const t of ['=1+1', '-0.25', '+3', '-cmd', '@x', '\tx', '12.50', '', 'plain', '> 13.0 dB', '—']) expect(csvCell(t)).toBe(t);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it('csvText prefixes a quote to text that a spreadsheet would read as a formula', () => {
    expect(csvText('=1+1')).toBe("'=1+1");
    expect(csvText('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvText('-cmd')).toBe("'-cmd");
    expect(csvText('@x')).toBe("'@x");
    expect(csvText('\tx')).toBe("'\tx");
    expect(csvText('\rx')).toBe("\"'\rx\"");
    expect(csvText('=HYPERLINK("a","b")')).toBe('"\'=HYPERLINK(""a"",""b"")"');
    expect(csvText('plain')).toBe('plain');
    expect(csvText('a,b')).toBe('"a,b"');
  });
  it('guards file, source file and group in the metrics CSV, not numbers or headers', () => {
    const pattern = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'x', fileName: '=cmd.msi', gain: { value: 15, unit: 'dBd' } });
    const tagged = [{ pattern, tags: {} }];
    const rows = buildRows(groupPatterns(tagged), analyzeAll(tagged), 'dBi');
    const lines = toCsv(rows, 'dBi', 30).split('\r\n');
    expect(lines[1].startsWith("'=cmd.msi,")).toBe(true);
    expect(lines[0].startsWith('File,')).toBe(true);
    expect(toCsv([{ ...rows[0], source: '@src.msi' }, { ...rows[0], group: '-g' }], 'dBi', 30)).toMatch(/'@src\.msi/);
    expect(toCsv([{ ...rows[0], group: '-g' }], 'dBi', 30).split('\r\n')[1]).toContain(",'-g,");
  });
  it('leaves a negative metric value unquoted', () => {
    const pattern = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'x', fileName: 'a.msi', gain: { value: -5, unit: 'dBi' } });
    const tagged = [{ pattern, tags: {} }];
    const rows = buildRows(groupPatterns(tagged), analyzeAll(tagged), 'dBi');
    const line = toCsv(rows, 'dBi', 30).split('\r\n')[1];
    expect(line).toContain(',-5.00,');
    expect(line).not.toContain("'-5");
  });
});

describe('sorting the table', () => {
  const res = (value: number | null, reason?: string) => ({ value, ...(reason ? { reason } : {}) });
  const row = (id: string, file: string, freq: number, hpbw: number | null, over: Partial<MetricsRow> = {}): MetricsRow => {
    const base = buildRows(
      groupPatterns([{ pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id }), tags: {} }]),
      analyzeAll([{ pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id }), tags: {} }]),
      'dBd',
    )[0];
    return { ...base, id, file, source: file, group: 'G', freq, gain: 10, cells: { ...base.cells, hHpbw: res(hpbw) }, ...over };
  };
  const rows = [row('a', 'A10', 1800, 65), row('b', 'A2', 900, null), row('c', 'a1', 2100, 60), row('d', 'B', 900, 70)];
  const ids = (sort: SortState | null) => sortRows(rows, sort).map((r) => r.id);

  it('cycles ascending, descending, none, and restarts on another column', () => {
    const asc = nextSort(null, 'freq');
    expect(asc).toEqual({ key: 'freq', dir: 'asc' });
    const desc = nextSort(asc, 'freq');
    expect(desc).toEqual({ key: 'freq', dir: 'desc' });
    expect(nextSort(desc, 'freq')).toBeNull();
    expect(nextSort(desc, 'file')).toEqual({ key: 'file', dir: 'asc' });
  });

  it('maps the sort state to aria-sort', () => {
    const s: SortState = { key: 'hHpbw', dir: 'desc' };
    expect(ariaSort(s, 'hHpbw')).toBe('descending');
    expect(ariaSort({ ...s, dir: 'asc' }, 'hHpbw')).toBe('ascending');
    expect(ariaSort(s, 'freq')).toBe('none');
    expect(ariaSort(null, 'freq')).toBe('none');
  });

  it('leaves the order alone without a sort and does not mutate the input', () => {
    expect(ids(null)).toEqual(['a', 'b', 'c', 'd']);
    ids({ key: 'freq', dir: 'desc' });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts numbers numerically and keeps ties in the original order', () => {
    expect(ids({ key: 'freq', dir: 'asc' })).toEqual(['b', 'd', 'a', 'c']);
    expect(ids({ key: 'freq', dir: 'desc' })).toEqual(['c', 'a', 'b', 'd']);
  });

  it('sorts text naturally and case-insensitively', () => {
    expect(ids({ key: 'file', dir: 'asc' })).toEqual(['c', 'b', 'a', 'd']); // a1, A2, A10, B
    expect(ids({ key: 'file', dir: 'desc' })).toEqual(['d', 'a', 'b', 'c']);
  });

  it('always puts missing values last, in both directions', () => {
    expect(ids({ key: 'hHpbw', dir: 'asc' })).toEqual(['c', 'a', 'd', 'b']);
    expect(ids({ key: 'hHpbw', dir: 'desc' })).toEqual(['d', 'a', 'c', 'b']);
    const noGain = [row('x', 'X', 1, 1, { gain: null }), row('y', 'Y', 1, 1, { gain: 3 })];
    expect(sortRows(noGain, { key: 'gain', dir: 'desc' }).map((r) => r.id)).toEqual(['y', 'x']);
  });

  it('sorts original → tilted cells by the tilted value when there is one', () => {
    const t = [
      row('p', 'P', 1, 60, { tilted: { hHpbw: res(90) } }),
      row('q', 'Q', 1, 80, { tilted: { hHpbw: res(null, 'off beam') } }),
      row('r', 'R', 1, 70),
    ];
    expect(sortValue(t[0], 'hHpbw')).toBe(90);
    expect(sortValue(t[1], 'hHpbw')).toBeNull();
    expect(sortValue(t[2], 'hHpbw')).toBe(70);
    expect(sortRows(t, { key: 'hHpbw', dir: 'asc' }).map((r) => r.id)).toEqual(['r', 'p', 'q']);
  });
});

describe('revealScrollTop', () => {
  const view = { scrollTop: 100, clientHeight: 300, headerHeight: 30 };
  it('keeps the scroll position for a row that is fully visible', () => {
    expect(revealScrollTop({ top: 200, height: 20 }, view)).toBe(100);
  });
  it('scrolls up so the row sits just under the sticky header', () => {
    expect(revealScrollTop({ top: 110, height: 20 }, view)).toBe(80);
    expect(revealScrollTop({ top: 0, height: 20 }, view)).toBe(0);
  });
  it('scrolls down so the row ends at the bottom edge', () => {
    expect(revealScrollTop({ top: 390, height: 20 }, view)).toBe(110);
  });
});

describe('sortIfShown', () => {
  const cols = visibleColumns({ ...DEFAULT_TABLE_GROUPS });
  const hidden = METRIC_COLUMNS.find((c) => !cols.some((v) => v.key === c.key))!;
  it('keeps a sort on a fixed column or a displayed metric column', () => {
    for (const key of ['file', 'group', 'freq', 'gain'] as const) {
      const s: SortState = { key, dir: 'asc' };
      expect(sortIfShown(s, [])).toBe(s);
    }
    const s: SortState = { key: cols[0].key, dir: 'desc' };
    expect(sortIfShown(s, cols)).toBe(s);
  });
  it('clears a sort whose column is no longer displayed', () => {
    expect(hidden).toBeDefined();
    expect(sortIfShown({ key: hidden.key, dir: 'asc' }, cols)).toBeNull();
    expect(sortIfShown(null, cols)).toBeNull();
  });
});

describe('shouldReveal', () => {
  const asc: SortState = { key: 'freq', dir: 'asc' };
  it('reveals when the highlighted id or the sort changes', () => {
    expect(shouldReveal({ id: 'a', sort: null }, { id: 'b', sort: null })).toBe(true);
    expect(shouldReveal({ id: 'a', sort: null }, { id: 'a', sort: asc })).toBe(true);
    expect(shouldReveal({ id: 'a', sort: asc }, { id: 'a', sort: { key: 'freq', dir: 'desc' } })).toBe(true);
    expect(shouldReveal({ id: 'a', sort: asc }, { id: 'a', sort: { key: 'gain', dir: 'asc' } })).toBe(true);
  });
  it('does not reveal when only the rows changed (same id, equal sort)', () => {
    expect(shouldReveal({ id: 'a', sort: asc }, { id: 'a', sort: { ...asc } })).toBe(false);
    expect(shouldReveal({ id: 'a', sort: null }, { id: 'a', sort: null })).toBe(false);
  });
  it('reveals on the first run', () => {
    expect(shouldReveal(null, { id: 'a', sort: null })).toBe(true);
  });
  it('never reveals without a highlight', () => {
    expect(shouldReveal({ id: 'a', sort: null }, { id: null, sort: null })).toBe(false);
  });
});

describe('beamwidth labels follow the level', () => {
  const col = (key: string) => METRIC_COLUMNS.find((c) => c.key === key)!;
  it('keeps HPBW at 3 dB and renames the beamwidth columns elsewhere', () => {
    expect(columnLabel(col('hHpbw'), 30)).toBe('H-HPBW');
    expect(columnLabel(col('hHpbw'), 30, 20, 10)).toBe('H-BW@10 dB');
    expect(columnLabel(col('vHpbw'), 30, 20, 1.5)).toBe('V-BW@1.5 dB');
    expect(columnLabel(col('dH'), 30, 20, 10)).toBe('ΔH-BW@10 dB');
    expect(columnLabel(col('dV'), 30, 20, 3)).toBe('ΔV-HPBW');
    expect(columnLabel(col('hBw10'), 30, 20, 10)).toBe('H-BW 10 dB');
  });
  it('writes the level into the CSV header too', () => {
    const pattern = patternFrom(quadBeam(60), vBeamWithLobes, { id: 'a.MSI', fileName: 'a.MSI' });
    const tagged = [{ pattern, tags: {} }];
    const rows = buildRows(groupPatterns(tagged), analyzeAll(tagged), 'dBd');
    const header = toCsv(rows, 'dBd', 30, undefined, 20, 10).split('\r\n')[0];
    expect(header).toContain('H-BW@10 dB (°)');
    expect(header).not.toContain('H-HPBW');
  });
});

describe('clearOfSticky', () => {
  const area = { left: 0, right: 400, top: 0, bottom: 300 };
  it('does not scroll for a cell that is visible beside the sticky column and below the header', () => {
    expect(clearOfSticky({ left: 200, right: 260, top: 100, bottom: 130 }, area, 120, 30)).toEqual({ dx: 0, dy: 0 });
  });
  it('scrolls back so a cell under the sticky File column or the header comes out from under it', () => {
    expect(clearOfSticky({ left: 100, right: 160, top: 10, bottom: 40 }, area, 120, 30)).toEqual({ dx: -20, dy: -20 });
  });
  it('scrolls forward for a cell past the right or bottom edge', () => {
    expect(clearOfSticky({ left: 380, right: 450, top: 290, bottom: 320 }, area, 120, 30)).toEqual({ dx: 50, dy: 20 });
  });
});

it('keeps the key list the state needs in step with the table columns', () => {
  expect(METRIC_COLUMNS.map((c) => c.key)).toEqual([...METRIC_KEYS]);
});
