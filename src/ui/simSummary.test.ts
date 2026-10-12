import { describe, expect, it } from 'vitest';
import { anySimulated, exportName, H_CUT_HINT, hCutAnnouncement, METHOD_UNUSED_NOTE, methodUseNote, offsetCountsAmong, simSummary, simulatedCaption, simulationActive, summaryMethod, WEIGHTED_HORIZON_NOTE, weightedHorizonNote } from './simSummary';
import { exportCaptionLines, withSimulated } from './exportFigure';
import { FEATURE_HELP, GLOSSARY } from './glossary';

describe('simSummary', () => {
  it('shows the global values', () => {
    expect(simSummary({ electricalDeg: 3, mechanicalDeg: 0, azimuthDeg: -10 }, 0, 0)).toBe('Tilt Δ 3° · Mech 0° · Az −10°');
    expect(simSummary({ electricalDeg: -2.5, mechanicalDeg: -1, azimuthDeg: 0 }, 0, 0)).toBe('Tilt Δ −2.5° · Mech −1° · Az 0°');
  });
  it('counts per-file and group offsets', () => {
    expect(simSummary({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 }, 1, 2)).toBe(
      'Tilt Δ 0° · Mech 0° · Az 0° · 1 file offset · 2 group offsets',
    );
  });
  it('names the 3D method when a tilt is active', () => {
    expect(simSummary({ electricalDeg: 3, mechanicalDeg: 2, azimuthDeg: 0 }, 0, 0, 'weighted')).toBe(
      'Tilt Δ 3° · Mech 2° · Az 0° · 3D method: Weighted',
    );
    expect(simSummary({ electricalDeg: 3, mechanicalDeg: 2, azimuthDeg: 0 }, 0, 0, 'summation')).toContain('3D method: Summation');
  });
  it('names the 3D method whenever it changes a number on screen: under a tilt, or while the angular-region estimate is shown or plotted', () => {
    expect(summaryMethod('weighted', false, false)).toBeUndefined();
    expect(summaryMethod('weighted', true, false)).toBe('weighted');
    expect(summaryMethod('summation', false, true)).toBe('summation');
    expect(simSummary({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 }, 0, 0, summaryMethod('summation', false, true))).toBe(
      'Tilt Δ 0° · Mech 0° · Az 0° · 3D method: Summation',
    );
  });
});

describe('simulatedCaption and exportName', () => {
  const none = { tiltActive: false, tilt: { electricalDeg: 0, mechanicalDeg: 0 }, azimuthDeg: 0, offsetCount: 0, groupOffsetCount: 0 };
  it('is empty without a simulation', () => {
    expect(simulationActive(none)).toBe(false);
    expect(simulatedCaption(none, 'summation')).toBeUndefined();
  });
  it('lists the electrical, mechanical and azimuth values and the method when a tilt is active', () => {
    const s = { ...none, tiltActive: true, tilt: { electricalDeg: 4, mechanicalDeg: -2 }, azimuthDeg: 10 };
    expect(simulatedCaption(s, 'weighted')).toBe('Simulated: electrical Δ 4°, mechanical −2°, azimuth 10°, weighted method');
  });
  it('leaves the method out for an azimuth-only simulation and counts the offsets', () => {
    expect(simulatedCaption({ ...none, azimuthDeg: 15 }, 'summation')).toBe('Simulated: electrical Δ 0°, mechanical 0°, azimuth 15°');
    expect(simulatedCaption({ ...none, offsetCount: 2, groupOffsetCount: 1, tiltActive: true }, 'summation')).toBe(
      'Simulated: electrical Δ 0°, mechanical 0°, azimuth 0°, summation method; offsets on 2 files and 1 group',
    );
  });
  it('adds -simulated to an export name only while a simulation is active', () => {
    expect(exportName('horizontal-cut', false)).toBe('horizontal-cut');
    expect(exportName('horizontal-cut', true)).toBe('horizontal-cut-simulated');
    expect(exportName('pattern-metrics', true, '.csv')).toBe('pattern-metrics-simulated.csv');
    expect(exportName('pattern-metrics', false, '.csv')).toBe('pattern-metrics.csv');
  });
});

describe('anySimulated', () => {
  const effective = (map: Record<string, [number, number, number]>) => (id: string) => {
    const [electricalDeg, mechanicalDeg, azimuthDeg] = map[id] ?? [0, 0, 0];
    return { electricalDeg, mechanicalDeg, azimuthDeg };
  };
  it('counts only the files given: an offset on a file that is not drawn does not count', () => {
    const e = effective({ a: [0, 3, 0], b: [0, 0, 0] });
    expect(anySimulated(e, ['b'])).toBe(false);
    expect(anySimulated(e, ['a', 'b'])).toBe(true);
    expect(anySimulated(e, [])).toBe(false);
  });
  it('sees a tilt, a mechanical tilt or an azimuth', () => {
    const e = effective({ t: [2, 0, 0], m: [0, -1, 0], z: [0, 0, 15] });
    for (const id of ['t', 'm', 'z']) expect(anySimulated(e, [id])).toBe(true);
  });
});

describe('offsets counted among the files a picture shows', () => {
  const fileOffsets = { a: {}, b: {}, c: {} };
  const groupOffsets = { g1: {}, g2: {} };
  const membership = { a: 'g1', b: 'g1', c: 'g3', d: 'g2' };
  it('counts a file offset for a shown file only, and a group once', () => {
    expect(offsetCountsAmong(['a', 'b', 'c', 'd'], fileOffsets, groupOffsets, membership)).toEqual({ files: 3, groups: 2 });
    expect(offsetCountsAmong(['a', 'b'], fileOffsets, groupOffsets, membership)).toEqual({ files: 2, groups: 1 });
    expect(offsetCountsAmong(['d', 'x'], fileOffsets, groupOffsets, membership)).toEqual({ files: 0, groups: 1 });
    expect(offsetCountsAmong([], fileOffsets, groupOffsets, membership)).toEqual({ files: 0, groups: 0 });
  });
  it('is what the caption says when given: offsets on files that are not drawn are not mentioned', () => {
    const s = { tiltActive: false, tilt: { electricalDeg: 0, mechanicalDeg: 0 }, azimuthDeg: 15, offsetCount: 2, groupOffsetCount: 0 };
    expect(simulatedCaption(s, 'summation')).toBe('Simulated: electrical Δ 0°, mechanical 0°, azimuth 15°; offsets on 2 files');
    expect(simulatedCaption(s, 'summation', { files: 0, groups: 0 })).toBe('Simulated: electrical Δ 0°, mechanical 0°, azimuth 15°');
    expect(simulatedCaption(s, 'summation', { files: 1, groups: 0 })).toBe('Simulated: electrical Δ 0°, mechanical 0°, azimuth 15°; offsets on 1 file');
  });
});

describe('the horizontal-cut control explains and announces itself', () => {
  it('has a one-line hint that says what each choice shows', () => {
    expect(H_CUT_HINT).toContain('Through the beam peak: ');
    expect(H_CUT_HINT).toContain('At the horizon: ');
    expect(H_CUT_HINT).toContain('0° elevation');
    expect(H_CUT_HINT).not.toContain('\n');
    expect(H_CUT_HINT.length).toBeLessThan(170);
  });

  it('says what changed when the choice is switched', () => {
    expect(hCutAnnouncement('horizon')).toBe('Horizontal cut at the horizon: every file shows its horizon cut. Horizon level column added.');
    expect(hCutAnnouncement('beam')).toBe('Horizontal cut through the beam peak. Horizon level column removed.');
  });
});

describe('Weighted with the cut at the horizon', () => {
  it('is flagged only for that combination, in words that match the metric definitions', () => {
    expect(weightedHorizonNote('horizon', 'weighted')).toBe(WEIGHTED_HORIZON_NOTE);
    expect(weightedHorizonNote('horizon', 'summation')).toBeUndefined();
    expect(weightedHorizonNote('beam', 'weighted')).toBeUndefined();
    expect(weightedHorizonNote(undefined, 'weighted')).toBeUndefined();
    for (const text of ['Weighted distorts the shape of a horizon cut', 'read its level, not its width', 'Summation is the reference for this cut']) expect(WEIGHTED_HORIZON_NOTE).toContain(text);
  });

  it('is the last line of an exported image, after the simulation line', () => {
    const lines = exportCaptionLines(withSimulated({ file: 'a.msi', items: ['x'] }, 'Simulated: y', WEIGHTED_HORIZON_NOTE)!);
    expect(lines.slice(0, 3)).toEqual(['a.msi', 'x', 'Simulated: y']);
    expect(lines.slice(3).join(' ')).toBe(WEIGHTED_HORIZON_NOTE);
    expect(withSimulated({ items: [] }, undefined, WEIGHTED_HORIZON_NOTE)).toEqual({ items: [] });
    expect(exportCaptionLines(withSimulated(undefined, 'Simulated: y')!)).toEqual(['Simulated: y']);
  });

  it('Help says the same in the Horizon cut entry and the feature line', () => {
    const entry = GLOSSARY.find((g) => g.term === 'Horizon cut')!;
    const line = FEATURE_HELP.find((l) => l.startsWith('Tilt simulation, horizontal cut'))!;
    for (const text of [entry.text, line]) {
      expect(text).toContain('Weighted');
      expect(text).toContain('Summation is the reference');
      expect(text).toMatch(/level, not its width/);
    }
  });
});

describe('the line beside the 3D method control', () => {
  const none = { view3d: false, tilt: false, horizonCut: false, angularRegions: false };
  it('gives the reason while nothing uses the method', () => {
    expect(methodUseNote(none)).toBe(METHOD_UNUSED_NOTE);
  });
  it('names what uses it otherwise, so the line is never an empty place', () => {
    expect(methodUseNote({ ...none, tilt: true })).toBe('In use by a tilt.');
    expect(methodUseNote({ ...none, horizonCut: true, tilt: true })).toBe('In use by a tilt and the horizon cut.');
    expect(methodUseNote({ view3d: true, tilt: true, horizonCut: true, angularRegions: true })).toBe('In use by the 3D view, a tilt, the horizon cut and the angular regions.');
  });
  it('is never longer than the reason: the reason sets the size of the place both share', () => {
    expect(methodUseNote({ view3d: true, tilt: true, horizonCut: true, angularRegions: true }).length).toBeLessThan(METHOD_UNUSED_NOTE.length);
  });
});
