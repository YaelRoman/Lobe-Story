import { describe, expect, it } from 'vitest';
import {
  buildRows, cellText, columnLabel, columnTitle, COLUMN_GROUPS, csvColumns, markReference, METRIC_COLUMNS, needsAngularRegions,
  rowCell, toCsv, toTsv, visibleColumns, withMethod,
} from './table';
import { DEFAULT_TABLE_GROUPS } from '../state/store';
import { analyzeAll, analyzePattern, DEFAULT_SETTINGS } from '../core/analysis/metrics';
import { analyzeTilted, tiltedAngularRegions, tiltTagged } from '../core/analysis/tilt';
import { toGrid } from '../core/analysis/grid';
import { angularRegionEfficiency } from '../core/analysis/are';
import { gridFrom, patternFrom, quadBeam } from '../test/synthetic';
import { groupPatterns } from '../state/selectors';
import { fixed } from './fixed';

const ARE_KEYS = ['areSector', 'areSpatial', 'areLower'] as const;
const shownGroups = { ...DEFAULT_TABLE_GROUPS, are: true };

/** Two made-up macro-like panels: 65° and 80° azimuth beams, 8° elevation beam 6° below the horizon. */
const hA = quadBeam(65, 0, 25);
const hB = quadBeam(80, 0, 25);
const vFn = quadBeam(8, 6, 20);
const tagged = [
  { pattern: patternFrom(hA, vFn, { id: 'alpha.msi', fileName: 'alpha.msi', gain: { value: 15, unit: 'dBd' } }), tags: { polarization: '+45', tiltDeg: 6 } },
  { pattern: patternFrom(hB, vFn, { id: 'beta.msi', fileName: 'beta.msi', gain: { value: 14, unit: 'dBd' } }), tags: { polarization: '+45', tiltDeg: 6 } },
];
const groups = groupPatterns(tagged);
const withAre = analyzeAll(tagged, DEFAULT_SETTINGS, { areMethod: 'summation' });
const expectedA = angularRegionEfficiency(gridFrom(hA), gridFrom(vFn), 60, 'summation');
const expectedB = angularRegionEfficiency(gridFrom(hB), gridFrom(vFn), 60, 'summation');

describe('the angular-region estimate in the analysis', () => {
  it('is not computed unless asked for', () => {
    const m = analyzeAll(tagged).get('alpha.msi')!;
    for (const r of [m.are.sector, m.are.spatial, m.are.lower]) expect(r).toEqual({ value: null, reason: 'Not computed' });
    expect(analyzePattern(tagged[0]).are.sector.value).toBeNull();
  });

  it('is computed from the file\'s cuts with the sector-edge setting and the given 3D method', () => {
    const m = withAre.get('alpha.msi')!;
    expect(m.are.sector.value).toBeCloseTo(expectedA.sector.value!, 9);
    expect(m.are.spatial.value).toBeCloseTo(expectedA.spatial.value!, 9);
    expect(m.are.lower.value).toBeCloseTo(expectedA.lower.value!, 9);
    const narrow = analyzeAll(tagged, { ...DEFAULT_SETTINGS, sectorEdgeDeg: 45 }, { areMethod: 'summation' }).get('alpha.msi')!;
    expect(narrow.are.sector.value!).toBeLessThan(m.are.sector.value!);
    const weighted = analyzePattern(tagged[0], DEFAULT_SETTINGS, undefined, { areMethod: 'weighted' });
    expect(weighted.are.sector.value).toBeCloseTo(angularRegionEfficiency(gridFrom(hA), gridFrom(vFn), 60, 'weighted').sector.value!, 9);
    expect(weighted.are.sector.value).not.toBeCloseTo(m.are.sector.value!, 3);
  });

  it('does not depend on the beamwidth-level setting (Type A uses the 3 dB beamwidth)', () => {
    const other = analyzeAll(tagged, { ...DEFAULT_SETTINGS, levelDb: 6 }, { areMethod: 'summation' }).get('alpha.msi')!;
    expect(other.are.sector.value).toBeCloseTo(expectedA.sector.value!, 9);
  });

  it('is kept per pattern: an unchanged file is not integrated again', () => {
    const first = analyzeAll(tagged, DEFAULT_SETTINGS, { areMethod: 'summation' });
    const again = analyzeAll(tagged, { ...DEFAULT_SETTINGS, fbWindowDeg: 20 }, { areMethod: 'summation' });
    expect(again.get('alpha.msi')!.are).toBe(first.get('alpha.msi')!.are);
    const otherEdge = analyzeAll(tagged, { ...DEFAULT_SETTINGS, sectorEdgeDeg: 50 }, { areMethod: 'summation' });
    expect(otherEdge.get('alpha.msi')!.are).not.toBe(first.get('alpha.msi')!.are);
    expect(otherEdge.get('alpha.msi')!.are.sector.value!).toBeLessThan(first.get('alpha.msi')!.are.sector.value!);
    const otherMethod = analyzeAll(tagged, DEFAULT_SETTINGS, { areMethod: 'weighted' });
    expect(otherMethod.get('alpha.msi')!.are.sector.value).not.toBeCloseTo(expectedA.sector.value!, 3);
    const back = analyzeAll(tagged, DEFAULT_SETTINGS, { areMethod: 'summation' });
    expect(back.get('alpha.msi')!.are.sector.value).toBeCloseTo(expectedA.sector.value!, 9);
  });

  it('uses the grids it is given, not a remembered result, when a caller passes its own', () => {
    const own = { h: gridFrom(hB), v: gridFrom(vFn) };
    const m = analyzePattern(tagged[0], DEFAULT_SETTINGS, own, { areMethod: 'summation' });
    expect(m.are.sector.value).toBeCloseTo(expectedB.sector.value!, 9);
  });
});

describe('the angular-region column group', () => {
  it('is the last group, labelled as an estimate, and off by default', () => {
    expect(COLUMN_GROUPS[COLUMN_GROUPS.length - 1]).toEqual({ key: 'are', label: 'Angular regions (est.)' });
    expect(DEFAULT_TABLE_GROUPS.are).toBe(false);
    const keys = visibleColumns(DEFAULT_TABLE_GROUPS).map((c) => c.key);
    for (const k of ARE_KEYS) expect(keys).not.toContain(k);
  });

  it('adds three percent columns whose labels say "est."', () => {
    const cols = visibleColumns(shownGroups).filter((c) => c.group === 'are');
    expect(cols.map((c) => c.key)).toEqual([...ARE_KEYS]);
    expect(cols.map((c) => `${columnLabel(c, 30)} (${c.unit})`)).toEqual(['Sector eff. est. (%)', 'Spatial eff. est. (%)', 'Lower region est. (%)']);
    expect(METRIC_COLUMNS.filter((c) => c.group === 'are')).toHaveLength(3);
  });

  it('says in every tooltip that the value is an estimate from two cuts and not BASTA-compliant', () => {
    const s = { sectorEdgeDeg: 45, siteSectors: 3, method3d: 'weighted' as const };
    for (const k of ARE_KEYS) {
      const t = columnTitle(k, s)!;
      expect(t).toMatch(/estimate/i);
      expect(t).toContain('not BASTA-compliant');
      expect(t).toContain('two co-polar cuts');
      expect(t).toContain('Weighted');
      expect(t).toContain('Type A');
    }
    expect(columnTitle('areSector', s)).toContain('±45°');
    expect(columnTitle('areSector', s)).toContain('whole sphere');
    expect(columnTitle('areSpatial', s)).toContain('service and interference regions');
    expect(columnTitle('areLower', s)).toContain('75°');
    expect(columnTitle('areSector', { sectorEdgeDeg: 60, siteSectors: 3 })).toContain('Summation');
  });

  it('names the 3D method wherever a value leaves the table, for these columns only', () => {
    expect(withMethod('areSector', 'Sector eff. est.', 'summation')).toBe('Sector eff. est., Summation');
    expect(withMethod('areLower', 'Lower region est.', 'weighted')).toBe('Lower region est., Weighted');
    expect(withMethod('hHpbw', 'H-HPBW', 'weighted')).toBe('H-HPBW');
  });

  it('is needed while its group is shown or the frequency chart plots one of its columns', () => {
    expect(needsAngularRegions(DEFAULT_TABLE_GROUPS, 'hHpbw')).toBe(false);
    expect(needsAngularRegions(shownGroups, 'hHpbw')).toBe(true);
    for (const k of ARE_KEYS) expect(needsAngularRegions(DEFAULT_TABLE_GROUPS, k)).toBe(true);
  });
});

describe('the angular-region columns in the table and the exports', () => {
  const rows = buildRows(groups, withAre, 'dBi');

  it('shows the three values with one decimal', () => {
    expect(cellText(rows[0], 'areSector')).toBe(fixed(expectedA.sector.value!, 1));
    expect(cellText(rows[0], 'areSpatial')).toBe(fixed(expectedA.spatial.value!, 1));
    expect(cellText(rows[1], 'areLower')).toBe(fixed(expectedB.lower.value!, 1));
  });

  it('shows — with the reason for a beam outside Type A', () => {
    const wide = [{ pattern: patternFrom(quadBeam(150, 0, 25), vFn, { id: 'wide.msi', fileName: 'wide.msi' }), tags: {} }];
    const [row] = buildRows(groupPatterns(wide), analyzeAll(wide, DEFAULT_SETTINGS, { areMethod: 'summation' }), 'dBi');
    for (const k of ARE_KEYS) {
      expect(rowCell(row, k).text).toBe('—');
      expect(rowCell(row, k).title).toContain('Not a Type A (macro) beam: H-HPBW 150.0° is outside 50–130°');
    }
  });

  it('leaves the columns out of the CSV while the group is hidden', () => {
    const header = toCsv(rows, 'dBi', 30).split('\r\n')[0];
    expect(header).not.toContain('est.');
    expect(toCsv(rows, 'dBi', 30)).toBe(toCsv(rows, 'dBi', 30, undefined, 20, 3, undefined, false, csvColumns(DEFAULT_TABLE_GROUPS)));
    // Every other group is exported whether shown or not, as before.
    expect(csvColumns({ beam: false, fb: false, sidelobes: false, sector: false, declared: false, are: false }).map((c) => c.key)).toEqual(
      METRIC_COLUMNS.filter((c) => c.group !== 'are').map((c) => c.key),
    );
  });

  it('adds the three columns, headers and values, to the CSV while the group is shown', () => {
    const lines = toCsv(rows, 'dBi', 30, undefined, 20, 3, undefined, false, csvColumns(shownGroups)).trimEnd().split('\r\n');
    // The 3D method changes these numbers by several points, so it is written into the header (quoted: it has a comma).
    expect(lines[0].endsWith(',F/B − decl. (dB),"Sector eff. est., Summation (%)","Spatial eff. est., Summation (%)","Lower region est., Summation (%)"')).toBe(true);
    const weightedRows = buildRows(groups, analyzeAll(tagged, DEFAULT_SETTINGS, { areMethod: 'weighted' }), 'dBi');
    const weightedHeader = toCsv(weightedRows, 'dBi', 30, undefined, 20, 3, undefined, false, csvColumns(shownGroups), 'weighted').split('\r\n')[0];
    expect(weightedHeader.endsWith('"Sector eff. est., Weighted (%)","Spatial eff. est., Weighted (%)","Lower region est., Weighted (%)"')).toBe(true);
    // No other header changes with the method.
    expect(weightedHeader.split('Weighted').join('Summation')).toBe(lines[0]);
    expect(lines[1].split(',').slice(-3)).toEqual([expectedA.sector, expectedA.spatial, expectedA.lower].map((r) => fixed(r.value!, 2)));
    expect(lines[2].split(',').slice(-3)).toEqual([expectedB.sector, expectedB.spatial, expectedB.lower].map((r) => fixed(r.value!, 2)));
    expect(lines[0].split(',')).toHaveLength(lines[1].split(',').length + 3);
  });

  it('copies the columns with the table (tab-separated) when they are shown', () => {
    const columns = visibleColumns(shownGroups);
    const [header, first] = toTsv(rows, columns, 'dBi', 30).trimEnd().split('\r\n');
    expect(header.split('\t').slice(-3)).toEqual(['Sector eff. est., Summation (%)', 'Spatial eff. est., Summation (%)', 'Lower region est., Summation (%)']);
    const weightedHeader = toTsv(rows, columns, 'dBi', 30, 20, 3, undefined, false, 'weighted').split('\r\n')[0];
    expect(weightedHeader.split('\t').slice(-3)).toEqual(['Sector eff. est., Weighted (%)', 'Spatial eff. est., Weighted (%)', 'Lower region est., Weighted (%)']);
    expect(weightedHeader.split('\t').slice(0, -3)).toEqual(header.split('\t').slice(0, -3));
    expect(first.split('\t').slice(-3)).toEqual([expectedA.sector, expectedA.spatial, expectedA.lower].map((r) => fixed(r.value!, 1)));
    expect(toTsv(rows, visibleColumns(DEFAULT_TABLE_GROUPS), 'dBi', 30)).not.toContain('est.');
  });

  it('shows the difference from the reference file in Δ mode', () => {
    const marked = markReference(rows, 'alpha.msi', true);
    const beta = marked.find((r) => r.id === 'beta.msi')!;
    expect(beta.isDelta).toBe(true);
    expect(beta.cells.areSector.value).toBeCloseTo(expectedB.sector.value! - expectedA.sector.value!, 9);
    expect(beta.cells.areSector.value!).toBeLessThan(0);
    expect(cellText(beta, 'areSector')).toMatch(/^-\d+\.\d$/);
    const header = toCsv(marked, 'dBi', 30, undefined, 20, 3, 'alpha.msi', false, csvColumns(shownGroups)).split('\r\n')[0];
    expect(header).toContain('"Sector eff. est., Summation Δ vs alpha.msi (%)"');
  });

  it('shows original → tilted under a tilt simulation', () => {
    const t = { electricalDeg: 0, mechanicalDeg: 4 };
    const tiltedItems = tiltTagged(tagged, t, 'summation');
    const tiltedMetrics = analyzeTilted(tiltedItems, DEFAULT_SETTINGS, t, 'summation');
    const simRows = buildRows(groups, withAre, 'dBi', tiltedMetrics);
    const tilted = simRows[0].tilted!.areSector!;
    // A mechanical down-tilt lowers the sector efficiency: off boresight the rotated beam is tilted less, so part of it
    // lies above the service region. (The product of the two tilted cuts, which this test used to accept, rises instead.)
    const ofTiltedCuts = angularRegionEfficiency(toGrid(tiltedItems[0].pattern.horizontal), toGrid(tiltedItems[0].pattern.vertical), 60, 'summation');
    expect(ofTiltedCuts.sector.value!).toBeGreaterThan(expectedA.sector.value!);
    expect(tilted.value!).toBeLessThan(expectedA.sector.value! - 1);
    expect(tilted.value).toBeCloseTo(
      tiltedAngularRegions(tagged[0].pattern, t, { h: toGrid(tiltedItems[0].pattern.horizontal), v: toGrid(tiltedItems[0].pattern.vertical) }, 60, 'summation').sector.value!,
      9,
    );
    expect(cellText(simRows[0], 'areSector')).toBe(`${fixed(expectedA.sector.value!, 1)} → ${fixed(tilted.value!, 1)}`);
    const lines = toCsv(simRows, 'dBi', 30, { ...t, azimuthDeg: 0 }, 20, 3, undefined, false, csvColumns(shownGroups)).trimEnd().split('\r\n');
    expect(lines[0]).toContain('"Sector eff. est., Summation original (%)","Sector eff. est., Summation tilted (%)","Spatial eff. est., Summation original (%)"');
    const cells = lines[1].split(',');
    // No header before this one has a comma, so the position of its first half is the column.
    const at = lines[0].split(',').indexOf('"Sector eff. est.');
    expect(cells[at]).toBe(fixed(expectedA.sector.value!, 2));
    expect(cells[at + 1]).toBe(fixed(tilted.value!, 2));
  });

  it('takes the tilted value from the two tilted cuts under an electrical tilt alone', () => {
    const t = { electricalDeg: 3, mechanicalDeg: 0 };
    const tiltedItems = tiltTagged(tagged, t, 'summation');
    const m = analyzeTilted(tiltedItems, DEFAULT_SETTINGS, t, 'summation').get('alpha.msi')!;
    const cuts = angularRegionEfficiency(toGrid(tiltedItems[0].pattern.horizontal), toGrid(tiltedItems[0].pattern.vertical), 60, 'summation');
    expect(m.are.sector.value).toBeCloseTo(cuts.sector.value!, 9);
    expect(m.are.lower.value).toBeCloseTo(cuts.lower.value!, 9);
  });

  it('is not computed for the tilted files either unless asked for', () => {
    const t = { electricalDeg: 2, mechanicalDeg: 0 };
    const m = analyzeTilted(tiltTagged(tagged, t, 'summation'), DEFAULT_SETTINGS, t).get('alpha.msi')!;
    expect(m.are.sector).toEqual({ value: null, reason: 'Not computed' });
  });
});
