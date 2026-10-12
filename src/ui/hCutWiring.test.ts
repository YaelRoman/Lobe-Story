// @vitest-environment jsdom
import { act, createElement, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlotData } from 'plotly.js';
import { hCutLabel, simSummary, simulatedCaption, simulationActive, summaryHCut, summaryMethod } from './simSummary';
import { buildRows, columnTitle, csvColumns, HORIZON_TAG, METRIC_COLUMNS, simulationLabel, toCsv, toTsv, visibleColumns } from './table';
import { bandCsv, bandTsv } from './bandView';
import { buildCutSeries } from './cutSeries';
import { buildCutFigure, buildCutOverlay, markerReadout, type CutFigureOptions } from './cutFigure';
import { exportCaptionLines, withSimulated } from './exportFigure';
import { FIGURE_THEMES } from './figureTheme';
import { useSimulation, type SimulationResult } from './useSimulation';
import { anySimulated } from './simSummary';
import { DEFAULT_TABLE_GROUPS, initialState, useStore } from '../state/store';
import { analyzeAll, DEFAULT_SETTINGS, type TaggedPattern } from '../core/analysis/metrics';
import { analyzeTilted, effectiveFor, isTilted, tiltEach, type HCutMode, type SimSettings, type TiltSettings } from '../core/analysis/tilt';
import { bandTable } from '../core/analysis/bandParams';
import { groupPatterns } from '../state/selectors';
import { bandItems } from '../test/bandFixture';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';

beforeEach(() => useStore.setState(initialState()));

const a: TaggedPattern = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a', fileName: 'a.msi' }), tags: { tiltDeg: 6 } };
const b: TaggedPattern = { pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b', fileName: 'b.msi' }), tags: { tiltDeg: 6 } };
const items = [a, b];
const original = analyzeAll(items);
const colors = new Map([['a', '#111111'], ['b', '#222222']]);

/** A simulation result as the hook gives it, without the hook. */
function simFor(tilt: TiltSettings, hCut: HCutMode, offsets: Record<string, SimSettings> = {}): SimulationResult {
  const global = { ...tilt, azimuthDeg: 0 };
  const effective = (id: string) => effectiveFor(global, offsets[id]);
  const isTiltedId = (id: string) => isTilted(effective(id));
  const tiltActive = items.some((i) => isTiltedId(i.pattern.id));
  const simActive = tiltActive || hCut === 'horizon';
  const tilted = simActive ? tiltEach(items, effective, 'summation', hCut) : items;
  return {
    tiltActive,
    simActive,
    tilt,
    azimuthDeg: 0,
    showOriginal: true,
    hCut,
    offsetCount: Object.keys(offsets).length,
    groupOffsetCount: 0,
    effective,
    simulatedAmong: (ids, hCutCounts = true) => anySimulated(effective, ids, hCutCounts && hCut === 'horizon'),
    offsetsAmong: () => ({ files: Object.keys(offsets).length, groups: 0 }),
    isTiltedId,
    showsSimulatedH: (id) => hCut === 'horizon' || isTiltedId(id),
    patterns: new Map(tilted.map((i) => [i.pattern.id, i.pattern])),
    metrics: simActive ? analyzeTilted(tilted, DEFAULT_SETTINGS, effective) : original,
  };
}

const MECH6 = { electricalDeg: 0, mechanicalDeg: 6 };
const NO_MARKERS = { hpbw: false, fb: false, usls: false, null: false, peak: false, sector: false };
const figureOptions = (sim: SimulationResult, over: Partial<CutFigureOptions> = {}): CutFigureOptions => ({
  series: buildCutSeries(items, sim, original, colors, 'H'),
  cut: 'H',
  mode: 'polar',
  floorDb: 60,
  markers: NO_MARKERS,
  markerTarget: null,
  theme: FIGURE_THEMES.light,
  levelDb: 3,
  fbWindowDeg: 30,
  sectorEdgeDeg: 60,
  uslsRangeDeg: 20,
  ...over,
});
const titleOf = (o: CutFigureOptions) => (buildCutOverlay(o).layout.title as { text: string }).text;

describe('the choice is named in the folded bar, the table note and the image caption', () => {
  const g = { electricalDeg: 0, mechanicalDeg: 6, azimuthDeg: 0 };

  it('folded Simulation bar: after the 3D method, while a tilt is active or the cut is the one at the horizon', () => {
    expect(simSummary(g, 0, 0, 'weighted', 'horizon')).toBe('Tilt Δ 0° · Mech 6° · Az 0° · 3D method: Weighted · H cut: at the horizon');
    expect(simSummary(g, 0, 0, 'weighted', 'beam')).toBe('Tilt Δ 0° · Mech 6° · Az 0° · 3D method: Weighted · H cut: through the beam peak');
    expect(simSummary(g, 0, 0, 'weighted')).toBe('Tilt Δ 0° · Mech 6° · Az 0° · 3D method: Weighted');
    expect(summaryHCut('horizon', true)).toBe('horizon');
    expect(summaryHCut('beam', true)).toBe('beam');
    // Without a tilted file the cut through the beam peak is the file cut and is not named; the horizon cut is shown for every file, tilted or not.
    expect(summaryHCut('beam', false)).toBeUndefined();
    expect(summaryHCut('horizon', false)).toBe('horizon');
    expect(simSummary({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 }, 0, 0, summaryMethod('summation', false, false, 'horizon'), summaryHCut('horizon', false))).toBe(
      'Tilt Δ 0° · Mech 0° · Az 0° · 3D method: Summation · H cut: at the horizon',
    );
    expect(summaryMethod('summation', false, false, 'beam')).toBeUndefined();
    expect(summaryMethod('summation', false, false)).toBeUndefined();
  });

  it('image caption: after the method, while a tilt is active or the cut is the one at the horizon', () => {
    const facts = { tiltActive: true, tilt: { electricalDeg: 4, mechanicalDeg: -2 }, azimuthDeg: 10, offsetCount: 0, groupOffsetCount: 0 };
    expect(simulatedCaption({ ...facts, hCut: 'horizon' }, 'weighted')).toBe(
      'Simulated: electrical Δ 4°, mechanical −2°, azimuth 10°, weighted method, horizontal cut at the horizon',
    );
    expect(simulatedCaption({ ...facts, hCut: 'beam' }, 'summation')).toBe(
      'Simulated: electrical Δ 4°, mechanical −2°, azimuth 10°, summation method, horizontal cut through the beam peak',
    );
    expect(simulatedCaption({ ...facts, hCut: 'horizon', offsetCount: 2 }, 'summation')).toBe(
      'Simulated: electrical Δ 4°, mechanical −2°, azimuth 10°, summation method, horizontal cut at the horizon; offsets on 2 files',
    );
    // An azimuth-only simulation tilts nothing: through the beam peak every file shows its file cut, at the horizon every file its horizon cut.
    const turned = { ...facts, tiltActive: false, tilt: { electricalDeg: 0, mechanicalDeg: 0 } };
    expect(simulatedCaption({ ...turned, hCut: 'beam' }, 'summation')).toBe('Simulated: electrical Δ 0°, mechanical 0°, azimuth 10°');
    expect(simulatedCaption({ ...turned, hCut: 'horizon' }, 'summation')).toBe(
      'Simulated: electrical Δ 0°, mechanical 0°, azimuth 10°, summation method, horizontal cut at the horizon',
    );
    // The horizon cut alone is a simulation (a reconstructed cut); a picture that does not show it (no cut named) is not.
    const still = { ...turned, azimuthDeg: 0 };
    expect(simulationActive({ ...still, hCut: 'horizon' })).toBe(true);
    expect(simulationActive({ ...still, hCut: 'beam' })).toBe(false);
    expect(simulationActive(still)).toBe(false);
    expect(simulatedCaption({ ...still, hCut: 'horizon' }, 'weighted')).toBe('Simulated: electrical Δ 0°, mechanical 0°, azimuth 0°, weighted method, horizontal cut at the horizon');
    expect(simulatedCaption(still, 'weighted')).toBeUndefined();
    // The image of the vertical cut does not name the horizontal cut: it does not depend on it.
    expect(simulatedCaption({ ...facts, hCut: undefined }, 'weighted')).toBe('Simulated: electrical Δ 4°, mechanical −2°, azimuth 10°, weighted method');
    // As the last line of an exported image's caption.
    const lines = exportCaptionLines(withSimulated({ file: 'a.msi', items: [] }, simulatedCaption({ ...facts, hCut: 'horizon' }, 'weighted'))!);
    expect(lines[lines.length - 1]).toContain('horizontal cut at the horizon');
  });

  it('table note', () => {
    expect(hCutLabel('horizon')).toBe('horizontal cut at the horizon');
    expect(hCutLabel('beam')).toBe('horizontal cut through the beam peak');
    // The table names the cut in a note of its own after this label (see MetricsTable); the label does not carry it.
    expect(simulationLabel(MECH6, 0, 0)).toBe('Simulated: Δe 0°, mech +6°');
    // @ts-expect-error the label takes no horizontal cut (the type check fails here if the parameter comes back)
    expect(simulationLabel(MECH6, 0, 0, 'horizon')).toBe('Simulated: Δe 0°, mech +6°');
    expect(simulationLabel(MECH6, 1, 2)).not.toContain('cut');
    expect(simulationLabel(MECH6, 1, 0)).toBe('Simulated: Δe 0°, mech +6° + offsets on 1 file');
  });
});

describe('the horizontal plot of a simulated file', () => {
  it('flags the horizon cut on every live series of the horizontal cut, tilted or not, and only there', () => {
    const sim = simFor({ electricalDeg: 0, mechanicalDeg: 0 }, 'horizon', { a: { electricalDeg: 2, mechanicalDeg: 0, azimuthDeg: 0 } });
    const h = buildCutSeries(items, sim, original, colors, 'H');
    // a (electrical tilt only) and b (no tilt) are both horizon cuts; each has its file cut as the dashed original.
    expect(h.map((s) => [s.id, !!s.horizonCut, !!s.coneCut])).toEqual([['a', true, false], ['b', true, false], ['a#original', false, false], ['b#original', false, false]]);
    expect(h[1].cut).toBe(sim.patterns.get('b')!.horizontal);
    expect(h[1].cut).not.toBe(b.pattern.horizontal);
    expect(h[3].cut).toBe(b.pattern.horizontal);
    const v = buildCutSeries(items, sim, original, colors, 'V');
    expect(v.some((s) => s.horizonCut)).toBe(false);
    // The vertical cut of the untilted file is the file's own, and has no dashed original: nothing about it changed.
    expect(v.map((s) => s.id)).toEqual(['a', 'b', 'a#original']);
    expect(v[1].cut).toBe(b.pattern.vertical);
    expect(v[1].metrics.v).toEqual(original.get('b')!.v);
    // No tilt at all: every horizontal series is a horizon cut with its original; the vertical plot is the files'.
    const none = simFor({ electricalDeg: 0, mechanicalDeg: 0 }, 'horizon');
    expect(buildCutSeries(items, none, original, colors, 'H').map((s) => [s.id, !!s.horizonCut])).toEqual([['a', true], ['b', true], ['a#original', false], ['b#original', false]]);
    expect(buildCutSeries(items, none, original, colors, 'V').map((s) => s.id)).toEqual(['a', 'b']);
    expect(titleOf(figureOptions(none))).toContain(' · cut at the horizon');
    // Through the beam peak without a tilt nothing is simulated.
    const beamNone = simFor({ electricalDeg: 0, mechanicalDeg: 0 }, 'beam');
    expect(buildCutSeries(items, beamNone, original, colors, 'H').map((s) => [s.id, !!s.horizonCut, s.cut === (s.id === 'a' ? a : b).pattern.horizontal])).toEqual([['a', false, true], ['b', false, true]]);
    // The other choice: the cut through the beam peak is flagged for a mechanical tilt, as before.
    const beam = buildCutSeries(items, simFor(MECH6, 'beam'), original, colors, 'H');
    expect(beam.map((s) => [!!s.horizonCut, !!s.coneCut])).toEqual([[false, true], [false, true], [false, false], [false, false]]);
    const horizon = buildCutSeries(items, simFor(MECH6, 'horizon'), original, colors, 'H');
    expect(horizon.map((s) => [!!s.horizonCut, !!s.coneCut])).toEqual([[true, false], [true, false], [false, false], [false, false]]);
  });

  it('draws another trace than the cut through the beam peak, never above 0 dB', () => {
    const r = (hCut: HCutMode) => (buildCutFigure(figureOptions(simFor(MECH6, hCut))).data[0] as Partial<PlotData>).r as number[];
    expect(r('horizon')).not.toEqual(r('beam'));
    expect(Math.max(...r('horizon'))).toBeLessThanOrEqual(0);
    // This beam is 6° down already: with 6° more the horizon lies far above it, and the cut is well below the 3D peak.
    expect(Math.max(...r('horizon'))).toBeLessThan(-10);
    expect(Math.max(...r('beam'))).toBeCloseTo(0, 6);
  });

  it('names the cut in the title', () => {
    expect(titleOf(figureOptions(simFor(MECH6, 'horizon')))).toContain(' · cut at the horizon');
    expect(titleOf(figureOptions(simFor(MECH6, 'horizon')))).not.toContain('beam peak');
    expect(titleOf(figureOptions(simFor(MECH6, 'beam')))).toContain(' · cut through the tilted beam peak');
    expect(titleOf(figureOptions(simFor(MECH6, 'beam')))).not.toContain('horizon');
    // Electrical tilt only: the cut through the beam peak is the file cut (no note); the horizon cut is not.
    const e = { electricalDeg: 3, mechanicalDeg: 0 };
    expect(titleOf(figureOptions(simFor(e, 'beam')))).not.toContain(' · ');
    expect(titleOf(figureOptions(simFor(e, 'horizon')))).toContain(' · cut at the horizon');
    const v = (sim: SimulationResult) => titleOf(figureOptions(sim, { cut: 'V', series: buildCutSeries(items, sim, original, colors, 'V') }));
    expect(v(simFor(MECH6, 'horizon'))).not.toContain('horizon');
  });

  it('says in the read-out how far the highlighted file\'s horizon cut lies below the 3D peak, whatever markers are on', () => {
    const sim = simFor(MECH6, 'horizon');
    const below = sim.metrics.get('a')!.hCutPeakDb!;
    expect(below).toBeGreaterThan(10);
    const readout = markerReadout(figureOptions(sim, { markerTarget: 'a' }));
    expect(readout).toEqual([`Horizon cut: maximum ${below.toFixed(1)} dB below the 3D peak`]);
    expect(markerReadout(figureOptions(sim, { markerTarget: 'a', markers: { ...NO_MARKERS, hpbw: true } }))).toContain(readout[0]);
    // Not for the dashed original, not on the vertical cut, not for the other choice.
    expect(markerReadout(figureOptions(sim, { markerTarget: 'a#original' }))).toEqual([]);
    expect(markerReadout(figureOptions(sim, { cut: 'V', series: buildCutSeries(items, sim, original, colors, 'V'), markerTarget: 'a' }))).toEqual([]);
    expect(markerReadout(figureOptions(simFor(MECH6, 'beam'), { markerTarget: 'a' }))).toEqual([]);
  });

  it('puts the F/B and sidelobe crosses on the trace, and the beamwidth ring 3 dB under the cut\'s own maximum', () => {
    const sim = simFor(MECH6, 'horizon');
    const m = sim.metrics.get('a')!;
    const raw = sim.patterns.get('a')!.horizontal.atten;
    const f = buildCutFigure(figureOptions(sim, { markerTarget: 'a', markers: { ...NO_MARKERS, fb: true, hpbw: true } }));
    const data = f.data as Partial<PlotData>[];
    const cross = data.find((t) => typeof t.name === 'string' && t.name.startsWith('F/B ±30°'))!;
    // The value is the level below the 3D peak, and that is where the trace is at that angle.
    expect(cross.name).toBe(`F/B ±30° ${m.fbWindow.value!.toFixed(1)} dB`);
    expect((cross.r as number[])[0]).toBeCloseTo(-m.fbWindow.value!, 9);
    expect((cross.r as number[])[0]).toBeCloseTo(-raw[((m.fbWindow.angle! % 360) + 360) % 360], 9);
    const ring = data.find((t) => t.name === '−3 dB')!;
    expect((ring.r as number[])[0]).toBeCloseTo(-(m.hCutPeakDb! + 3), 9);
  });
});

describe('exports name the horizon cut on the tilted horizontal columns', () => {
  const HORIZONTAL = ['H-HPBW', 'H-BW 10 dB', 'Squint', 'Peak az', 'F/B 180°', 'F/B ±30°', 'H-SLS', 'P2P tracking', 'SPR', 'AIR', 'Roll-off', 'D/U 16QAM', 'D/U 64QAM', 'D/U 256QAM'];
  const VERTICAL = ['V-HPBW', 'V-BW 10 dB', 'Tilt', 'Peak tilt', 'Tilt error', 'First USLS', 'USLS peak to 20°', 'USLS horizon to 20°', 'USLS max', 'Null fill', 'First LSLS'];
  const rowsFor = (hCut: HCutMode) => {
    const sim = simFor(MECH6, hCut);
    return { sim, rows: buildRows(groupPatterns(items), original, 'dBd', sim.metrics, sim.isTiltedId) };
  };
  const all = csvColumns({ ...DEFAULT_TABLE_GROUPS, are: true });

  it('CSV: "[horizon cut]" on the tilted column of every horizontal metric, nowhere else, and no comma', () => {
    const { sim, rows } = rowsFor('horizon');
    const header = toCsv(rows, 'dBd', 30, sim.effective, 20, 3, undefined, false, all, 'summation', true).split('\r\n')[0];
    expect(HORIZON_TAG).toBe('[horizon cut]');
    for (const label of HORIZONTAL) {
      const unit = header.match(new RegExp(`${label.replace(/[/±°]/g, (c) => `\\${c}`)} original \\(([^)]*)\\)`))![1];
      expect(header).toContain(`${label} original (${unit}),${label} tilted [horizon cut] (${unit})`);
    }
    for (const label of VERTICAL) expect(header).toMatch(new RegExp(`${label.replace(/[/±°]/g, (c) => `\\${c}`)} tilted \\(`));
    // The angular-region estimate does not follow the choice: its columns carry the 3D method only.
    expect(header).toContain('Sector eff. est. [Summation] tilted (%)');
    expect(header.split(HORIZON_TAG)).toHaveLength(HORIZONTAL.length + 1);
    expect(header).not.toContain('"');
    // The values under those headers are the horizon cut's.
    const beamCsv = toCsv(rowsFor('beam').rows, 'dBd', 30, sim.effective, 20, 3, undefined, false, all, 'summation', false);
    const col = header.split(',').indexOf('H-HPBW tilted [horizon cut] (°)');
    const line = toCsv(rows, 'dBd', 30, sim.effective, 20, 3, undefined, false, all, 'summation', true).split('\r\n')[1].split(',');
    expect(col).toBe(beamCsv.split('\r\n')[0].split(',').indexOf('H-HPBW tilted (°)'));
    expect(line[col]).not.toBe(beamCsv.split('\r\n')[1].split(',')[col]);
    expect(line[col - 1]).toBe(beamCsv.split('\r\n')[1].split(',')[col - 1]);
  });

  it('CSV: nothing changes for the cut through the beam peak, or without the flag', () => {
    const { sim, rows } = rowsFor('beam');
    const plain = toCsv(rows, 'dBd', 30, sim.effective, 20, 3, undefined, false, all, 'summation');
    expect(toCsv(rows, 'dBd', 30, sim.effective, 20, 3, undefined, false, all, 'summation', false)).toBe(plain);
    expect(plain).not.toContain('horizon cut'); // ("USLS horizon to 20°" is a column of its own)
    // Without a tilted row there is no tilted column to mark.
    const untilted = buildRows(groupPatterns(items), original, 'dBd');
    expect(toCsv(untilted, 'dBd', 30, undefined, 20, 3, undefined, false, all, 'summation', true)).not.toContain('horizon cut');
  });

  it('difference view: "tilted values [horizon cut]" on the horizontal columns', () => {
    const { rows } = rowsFor('horizon');
    const header = toCsv(rows, 'dBd', 30, undefined, 20, 3, 'ref.msi', true, all, 'summation', true).split('\r\n')[0];
    expect(header).toContain('"H-HPBW Δ vs ref.msi, tilted values [horizon cut] (°)"');
    expect(header).toContain('"V-HPBW Δ vs ref.msi, tilted values (°)"');
    const tsv = toTsv(rows, visibleColumns(DEFAULT_TABLE_GROUPS), 'dBd', 30, 20, 3, 'ref.msi', true, 'summation', true).split('\r\n')[0].split('\t');
    expect(tsv).toContain('H-HPBW Δ vs ref.msi, tilted values [horizon cut] (°)');
    expect(tsv).toContain('V-HPBW Δ vs ref.msi, tilted values (°)');
  });

  it('copied table: the horizontal headers say whose tilted value follows the arrow', () => {
    const { rows } = rowsFor('horizon');
    const columns = visibleColumns(DEFAULT_TABLE_GROUPS);
    const header = toTsv(rows, columns, 'dBd', 30, 20, 3, undefined, false, 'summation', true).split('\r\n')[0].split('\t');
    expect(header).toContain('H-HPBW [tilted: horizon cut] (°)');
    expect(header).toContain('V-HPBW (°)');
    expect(toTsv(rows, columns, 'dBd', 30, 20, 3, undefined, false, 'summation').split('\r\n')[0]).not.toContain('horizon cut');
    expect(toTsv(rows, columns, 'dBd', 30, 20, 3, undefined, false, 'summation', false).split('\r\n')[0]).not.toContain('horizon cut');
  });

  it('band statistics: the State of the tilted lines, and the first header of the copied table', () => {
    const ctx = { gainUnit: 'dBi' as const, settings: DEFAULT_SETTINGS };
    const band = [{ name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 }];
    const set = bandItems();
    const columns = bandTable(set, analyzeAll(set), band, ctx);
    const sheets = [{ label: 'Array Y1', columns, tilted: columns }];
    const lines = bandCsv(sheets, DEFAULT_SETTINGS, true).split('\r\n');
    expect(lines[1].startsWith('Array Y1,original,')).toBe(true);
    // The first parameter (gain) is not read from the horizontal cut: its tilted line is plain "tilted"; the azimuth beamwidth's names the cut.
    expect(lines[2].startsWith('Array Y1,tilted,')).toBe(true);
    expect(lines.filter((l) => l.includes(',Azimuth beamwidth,'))[1].startsWith('Array Y1,tilted [H cut at the horizon],')).toBe(true);
    expect(bandCsv(sheets, DEFAULT_SETTINGS, false)).toBe(bandCsv(sheets, DEFAULT_SETTINGS));
    expect(bandCsv(sheets, DEFAULT_SETTINGS)).not.toContain('at the horizon');
    // No tilted run: no State column, nothing to name.
    expect(bandCsv([{ label: 'Array Y1', columns }], DEFAULT_SETTINGS, true)).toBe(bandCsv([{ label: 'Array Y1', columns }], DEFAULT_SETTINGS));
    expect(bandTsv(columns, columns, DEFAULT_SETTINGS, true).split('\r\n')[0].split('\t')[0]).toBe('Parameter [tilted: H cut at the horizon]');
    expect(bandTsv(columns, columns, DEFAULT_SETTINGS).split('\r\n')[0].split('\t')[0]).toBe('Parameter');
    expect(bandTsv(columns, null, DEFAULT_SETTINGS, true).split('\r\n')[0].split('\t')[0]).toBe('Parameter');
  });
});

describe('useSimulation follows the stored choice', () => {
  function mount(withAre: boolean): { latest: () => SimulationResult; unmount: () => void } {
    const container = document.createElement('div');
    let root: Root;
    let latest: SimulationResult;
    function Probe() {
      const metrics = useMemo(() => analyzeAll(items, DEFAULT_SETTINGS, withAre ? { areMethod: 'summation' } : {}), []);
      latest = useSimulation(items, metrics, DEFAULT_SETTINGS, withAre);
      return null;
    }
    act(() => {
      root = createRoot(container);
      root.render(createElement(Probe));
    });
    return { latest: () => latest, unmount: () => act(() => root.unmount()) };
  }

  it('tilts with the chosen horizontal cut and says which', () => {
    act(() => useStore.getState().updateSimulation({ mechanicalDeg: 6 }));
    const probe = mount(false);
    const beam = probe.latest();
    expect(beam.hCut).toBe('beam');
    expect(beam.metrics.get('a')!.hCutPeakDb).toBeUndefined();
    act(() => useStore.getState().updateSimulation({ hCut: 'horizon' }));
    const horizon = probe.latest();
    expect(horizon.hCut).toBe('horizon');
    expect(horizon.patterns.get('a')!.horizontal.atten).not.toEqual(beam.patterns.get('a')!.horizontal.atten);
    expect(horizon.patterns.get('a')!.vertical.atten).toEqual(beam.patterns.get('a')!.vertical.atten);
    expect(horizon.metrics.get('a')!.h.hpbw.value).not.toBe(beam.metrics.get('a')!.h.hpbw.value);
    expect(horizon.metrics.get('a')!.hCutPeakDb).toBeGreaterThan(10);
    expect(horizon.metrics.get('a')!.v).toEqual(beam.metrics.get('a')!.v);
    // Back again: the same tilted copies as before (each mode keeps its own).
    act(() => useStore.getState().updateSimulation({ hCut: 'beam' }));
    expect(probe.latest().patterns.get('a')).toBe(beam.patterns.get('a'));
    probe.unmount();
  });

  it('without a tilt: through the beam peak the file cuts and the original metrics; at the horizon every file\'s horizon cut', () => {
    const probe = mount(false);
    const before = probe.latest();
    expect(before.simActive).toBe(false);
    expect(before.patterns.get('a')).toBe(a.pattern);
    expect(before.showsSimulatedH('a')).toBe(false);
    expect(before.simulatedAmong(['a'])).toBe(false);
    act(() => useStore.getState().updateSimulation({ hCut: 'horizon' }));
    const after = probe.latest();
    expect(after.tiltActive).toBe(false);
    expect(after.simActive).toBe(true);
    expect(after.metrics).not.toBe(before.metrics);
    for (const item of items) {
      const id = item.pattern.id;
      expect(after.isTiltedId(id)).toBe(false);
      expect(after.showsSimulatedH(id)).toBe(true);
      expect(after.patterns.get(id)).not.toBe(item.pattern);
      expect(after.patterns.get(id)!.vertical).toBe(item.pattern.vertical);
      // Built-in tilt of 6°: the horizon cut lies 7.5 dB below the 3D peak.
      expect(after.metrics.get(id)!.hCutPeakDb).toBeCloseTo(7.5, 6);
      expect(after.metrics.get(id)!.v).toEqual(before.metrics.get(id)!.v);
      expect(after.metrics.get(id)!.tilt).toEqual(before.metrics.get(id)!.tilt);
    }
    // What shows the horizontal cut is simulated; a picture that does not (the vertical cut, the 3D view) is not.
    expect(after.simulatedAmong(['a'])).toBe(true);
    expect(after.simulatedAmong(['a'], false)).toBe(false);
    expect(after.simulatedAmong([])).toBe(false);
    // Back: the files themselves again.
    act(() => useStore.getState().updateSimulation({ hCut: 'beam' }));
    expect(probe.latest().patterns.get('a')).toBe(a.pattern);
    expect(probe.latest().metrics).toBe(before.metrics);
    probe.unmount();
  });

  it('leaves the angular-region estimate alone', () => {
    act(() => useStore.getState().updateSimulation({ mechanicalDeg: 6, electricalDeg: 1 }));
    const probe = mount(true);
    const beam = probe.latest().metrics;
    expect(beam.get('a')!.are.sector.value).not.toBeNull();
    act(() => useStore.getState().updateSimulation({ hCut: 'horizon' }));
    const horizon = probe.latest().metrics;
    expect(horizon).not.toBe(beam);
    for (const id of ['a', 'b']) expect(horizon.get(id)!.are).toEqual(beam.get(id)!.are);
    probe.unmount();
  });
});

describe('at the horizon every file is simulated, with or without a tilt', () => {
  const HORIZONTAL_CELLS = ['hHpbw', 'hBw10', 'squint', 'hPeak', 'fb180', 'fbWindow', 'hSls', 'tracking', 'spr', 'air', 'rollOff', 'du16', 'du64', 'du256', 'dH', 'dFb'];
  const rowsOf = (sim: SimulationResult, list = items, base = original) =>
    buildRows(groupPatterns(list), base, 'dBd', sim.simActive ? sim.metrics : undefined, sim.isTiltedId, sim.showsSimulatedH);

  it('an untilted file gets arrow cells for what is read from the horizontal cut, and none for the vertical cut', () => {
    const rows = rowsOf(simFor({ electricalDeg: 0, mechanicalDeg: 0 }, 'horizon'));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(Object.keys(r.tilted ?? {}).sort()).toEqual([...HORIZONTAL_CELLS].sort());
      // The file has 6° of built-in tilt: its horizon cut is 7.5 dB below the peak, so F/B at 180° rises by that.
      expect(r.tilted!.fb180!.value! - r.cells.fb180.value!).toBeCloseTo(7.5, 6);
      // The declared H beamwidth and F/B describe the file cut, not the horizon cut.
      expect(r.tilted!.dH).toEqual({ value: null, reason: 'Declared values describe the measured pattern' });
      expect(r.tilted!.dFb).toEqual({ value: null, reason: 'Declared values describe the measured pattern' });
      for (const key of ['vHpbw', 'vBw10', 'tilt', 'vPeak', 'tiltError', 'firstUsls', 'usls', 'uslsHorizon', 'uslsMax', 'nullFill', 'firstLsls', 'dV', 'areSector'] as const) {
        expect(r.tilted![key], key).toBeUndefined();
      }
    }
    // Through the beam peak without a tilt there is no simulated run at all.
    expect(rowsOf(simFor({ electricalDeg: 0, mechanicalDeg: 0 }, 'beam')).every((r) => r.tilted === undefined)).toBe(true);
    // A tilted file still compares every cell.
    const mixed = rowsOf(simFor({ electricalDeg: 0, mechanicalDeg: 0 }, 'horizon', { a: { electricalDeg: 0, mechanicalDeg: 1, azimuthDeg: 0 } }));
    expect(mixed[0].tilted!.vHpbw).toBeDefined();
    expect(mixed[1].tilted!.vHpbw).toBeUndefined();
    expect(mixed[1].tilted!.hHpbw).toBeDefined();
  });

  it('the CSV has the horizon cut of an untilted port under the horizon-cut header, not its cut through the beam peak', () => {
    // Two ports of one array with 6° of built-in tilt; one is given 1° of mechanical tilt.
    const plus: TaggedPattern = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'plus', fileName: 'plus.msi' }), tags: { polarization: '+45', tiltDeg: 6 } };
    const minus: TaggedPattern = { pattern: patternFrom(quadBeam(64), vBeamWithLobes, { id: 'minus', fileName: 'minus.msi' }), tags: { polarization: '-45', tiltDeg: 6 } };
    const pair = [plus, minus];
    const base = analyzeAll(pair);
    const effective = (id: string) => ({ electricalDeg: 0, mechanicalDeg: id === 'plus' ? 1 : 0, azimuthDeg: 0 });
    const metrics = analyzeTilted(tiltEach(pair, effective, 'summation', 'horizon'), DEFAULT_SETTINGS, effective);
    const rows = buildRows(groupPatterns(pair), base, 'dBd', metrics, (id) => id === 'plus', () => true);
    const lines = toCsv(rows, 'dBd', 30, effective, 20, 3, undefined, false, csvColumns(DEFAULT_TABLE_GROUPS), 'summation', true).split('\r\n').map((l) => l.split(','));
    const col = (name: string) => lines[0].indexOf(name);
    const untilted = lines.find((l) => l[0] === 'minus.msi')!;
    const fb = col('F/B 180° tilted [horizon cut] (dB)');
    expect(fb).toBeGreaterThan(0);
    // Original: the file cut. Tilted column: the horizon cut, 7.5 dB lower, so the level behind is 7.5 dB further below the 3D peak.
    expect(Number(untilted[fb]) - Number(untilted[fb - 1])).toBeCloseTo(7.5, 2);
    expect(Number(untilted[fb])).toBeCloseTo(metrics.get('minus')!.fb180.value!, 2);
    // The vertical columns of the untilted port repeat the file's value.
    const v = col('V-HPBW tilted (°)');
    expect(untilted[v]).toBe(untilted[v - 1]);
    // Tracking compares horizon cut with horizon cut: a fraction of a dB to a few dB, on both rows the same.
    const before = base.get('plus')!.beamTracking.value!;
    const after = metrics.get('plus')!.beamTracking.value!;
    expect(metrics.get('minus')!.beamTracking.value).toBeCloseTo(after, 9);
    expect(Math.abs(after - before)).toBeLessThan(5);
    // Against the partner's cut through the beam peak it would be the level of the cut itself (over 7.5 dB).
    expect(metrics.get('minus')!.hCutPeakDb).toBeCloseTo(7.5, 6);
  });
});

describe('column tooltips say which peak a level is below while the cut is the one at the horizon', () => {
  const settings = { sectorEdgeDeg: 60, siteSectors: 3 };
  const at = (key: Parameters<typeof columnTitle>[0]) => columnTitle(key, { ...settings, horizonCut: true })!;

  it('levels: below the 3D peak', () => {
    for (const key of ['fb180', 'fbWindow', 'hSls'] as const) expect(at(key), key).toContain('On a horizon cut: below the 3D peak of the pattern, not the maximum of the cut');
    expect(at('tracking')).toContain('On a horizon cut: each port against its own 3D peak');
  });

  it('roll-off and the 10 dB beamwidth read the same curve against different references', () => {
    expect(at('rollOff')).toContain('On a horizon cut: the level at the sector edge below the 3D peak; subtract the Horizon level for the shape of the cut');
    expect(at('hBw10')).toContain('On a horizon cut: 10 dB below the maximum of that cut, not the 3D peak');
    expect(at('hHpbw')).toContain('On a horizon cut: below the maximum of that cut, not the 3D peak');
    for (const key of ['squint', 'hPeak'] as const) expect(at(key), key).toContain('On a horizon cut: of that cut');
  });

  it('nothing is added to a column that does not follow the cut, or through the beam peak', () => {
    for (const c of METRIC_COLUMNS) {
      const plain = columnTitle(c.key, settings);
      expect(columnTitle(c.key, { ...settings, horizonCut: false }), c.key).toBe(plain);
      expect(plain, c.key).not.toContain('On a horizon cut');
    }
    for (const key of ['vHpbw', 'vBw10', 'tilt', 'usls', 'uslsHorizon', 'nullFill', 'spr', 'air', 'du16', 'dV', 'areSector'] as const) {
      expect(at(key), key).toBe(columnTitle(key, settings));
    }
  });
});
