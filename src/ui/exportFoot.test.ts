import { describe, expect, it } from 'vitest';
import { exportFootLine, methodInUse, type FootView } from './exportFoot';
import { DEFAULT_TABLE_GROUPS } from '../state/store';
import { DEFAULT_SETTINGS } from '../core/analysis/metrics';

const zero = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
const view = (over: Partial<FootView> = {}, sim: Partial<FootView['simulation']> = {}): FootView => ({
  dimension: '2d',
  method3d: 'summation',
  tableGroups: DEFAULT_TABLE_GROUPS,
  freqMetric: 'hHpbw',
  ...over,
  simulation: { ...zero, hCut: 'beam', offsets: {}, groupOffsets: {}, ...sim },
});
const day = new Date(2026, 9, 3, 23, 30);

describe('the foot line of an exported image', () => {
  it('names the settings that shape the numbers, the date and the app', () => {
    expect(exportFootLine(DEFAULT_SETTINGS, view(), day)).toBe('Beamwidth level 3 dB · Sector edge ±60° · F/B window ±30° · 2026-10-03 · Lobe-Story');
  });

  it('follows the settings', () => {
    const line = exportFootLine({ ...DEFAULT_SETTINGS, levelDb: 10, sectorEdgeDeg: 45, fbWindowDeg: 20 }, view(), day);
    expect(line).toContain('Beamwidth level 10 dB · Sector edge ±45° · F/B window ±20°');
  });

  it('writes a value as the plot labels do: at most two decimals, an integer as it is', () => {
    const line = exportFootLine({ ...DEFAULT_SETTINGS, levelDb: 19.123456789012344, sectorEdgeDeg: 178.12345678901235, fbWindowDeg: 22.5 }, view(), day);
    expect(line).toContain('Beamwidth level 19.12 dB · Sector edge ±178.12° · F/B window ±22.5°');
    expect(exportFootLine({ ...DEFAULT_SETTINGS, levelDb: 9.999 }, view(), day)).toContain('Beamwidth level 10 dB');
  });

  it('names the 3D method only while something uses it', () => {
    expect(exportFootLine(DEFAULT_SETTINGS, view({ dimension: '3d', method3d: 'weighted' }), day)).toBe(
      'Beamwidth level 3 dB · Sector edge ±60° · F/B window ±30° · 3D method: Weighted · 2026-10-03 · Lobe-Story',
    );
    expect(exportFootLine(DEFAULT_SETTINGS, view({}, { mechanicalDeg: 2 }), day)).toContain(' · 3D method: Summation · ');
    expect(exportFootLine(DEFAULT_SETTINGS, view({ method3d: 'weighted' }), day)).not.toContain('3D method');
  });

  it('the date is the day on the user’s clock, not the UTC day', () => {
    expect(exportFootLine(DEFAULT_SETTINGS, view(), new Date(2026, 0, 1, 0, 5))).toContain(' · 2026-01-01 · ');
    expect(exportFootLine(DEFAULT_SETTINGS, view(), new Date(2026, 11, 31, 23, 55))).toContain(' · 2026-12-31 · ');
  });
});

describe('methodInUse', () => {
  it('is false for an untouched 2D page', () => {
    expect(methodInUse(view())).toBe(false);
  });
  it('is true in the 3D view, under a tilt (global, per file or per group), for the horizon cut, and for the angular regions', () => {
    expect(methodInUse(view({ dimension: '3d' }))).toBe(true);
    expect(methodInUse(view({}, { electricalDeg: -1 }))).toBe(true);
    expect(methodInUse(view({}, { offsets: { a: { ...zero, mechanicalDeg: 1 } } }))).toBe(true);
    expect(methodInUse(view({}, { groupOffsets: { g: { ...zero, electricalDeg: 1 } } }))).toBe(true);
    expect(methodInUse(view({}, { hCut: 'horizon' }))).toBe(true);
    expect(methodInUse(view({ tableGroups: { ...DEFAULT_TABLE_GROUPS, are: true } }))).toBe(true);
  });
  it('an azimuth alone turns the drawing and uses no method', () => {
    expect(methodInUse(view({}, { azimuthDeg: 20, offsets: { a: { ...zero, azimuthDeg: 5 } } }))).toBe(false);
  });
});
