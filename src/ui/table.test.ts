import { describe, expect, it } from 'vitest';
import {
  buildRows, columnLabel, columnTitle, convertGain, formatCell, METRIC_COLUMNS, COLUMN_GROUPS, visibleColumns,
  simulationLabel, toCsv, offsetLabel,
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
    expect(line.startsWith('"""odd, name"".MSI",+45 · 6°T,1800,17.15,60.00,8.00,109.54,14.22,')).toBe(true);
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
    expect(columnTitle('hHpbw', s)).toBeUndefined();
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
    expect(columnTitle('hHpbw', s)).toBeUndefined();
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
    const na = formatCell({ value: null, reason: 'Not available: only the main beam lies in this window' });
    expect(na.text).toBe('—');
    expect(na.title).toMatch(/only the main beam/);
  });
});
