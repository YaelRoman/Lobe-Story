import { describe, expect, it } from 'vitest';
import { clampFloor, clampSetting, FLOOR_LIMITS, SETTING_LIMITS } from './settingLimits';
import { DEFAULT_SETTINGS, type AnalysisSettings } from './metrics';

const keys = Object.keys(DEFAULT_SETTINGS) as (keyof AnalysisSettings)[];

describe('SETTING_LIMITS', () => {
  it('covers exactly the analysis settings, with every default inside its range', () => {
    expect(Object.keys(SETTING_LIMITS).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(clampSetting(k, DEFAULT_SETTINGS[k]), k).toBe(DEFAULT_SETTINGS[k]);
    }
  });

  it('pins the bounds', () => {
    expect(SETTING_LIMITS).toEqual({
      levelDb: { min: 0.5, max: 20, step: 0.5 },
      fbWindowDeg: { min: 1, max: 180, step: 1 },
      uslsRangeDeg: { min: 1, max: 90, step: 1 },
      sectorEdgeDeg: { min: 1, max: 179, step: 1 },
      siteSectors: { min: 2, max: 12, step: 1, integer: true },
      lobeLimitFactor: { min: 1, max: 10, step: 0.01 },
    });
    expect(FLOOR_LIMITS).toMatchObject({ min: 10, max: 80 });
  });
});

describe('clampSetting', () => {
  it('accepts both bounds and rejects values just outside them', () => {
    for (const k of keys) {
      const { min, max } = SETTING_LIMITS[k];
      expect(clampSetting(k, min), k).toBe(min);
      expect(clampSetting(k, max), k).toBe(max);
      expect(clampSetting(k, min - 0.01), k).toBeNull();
      expect(clampSetting(k, max + 0.01), k).toBeNull();
    }
  });

  it('rejects non-finite numbers, zero and negatives', () => {
    for (const k of keys) {
      for (const v of [NaN, Infinity, -Infinity, 0, -5]) expect(clampSetting(k, v), `${k} ${v}`).toBeNull();
    }
  });

  it('rejects fractional site sectors', () => {
    expect(clampSetting('siteSectors', 3.5)).toBeNull();
    expect(clampSetting('siteSectors', 6)).toBe(6);
  });

  it('rejects the plot-breaking values seen in the field', () => {
    expect(clampSetting('fbWindowDeg', 400)).toBeNull();
    expect(clampSetting('levelDb', 0.1)).toBeNull();
    expect(clampSetting('uslsRangeDeg', 100)).toBeNull();
  });
});

describe('clampFloor', () => {
  it('accepts the range and rejects outside it', () => {
    expect(clampFloor(10, 3)).toBe(10);
    expect(clampFloor(80, 3)).toBe(80);
    expect(clampFloor(500, 3)).toBeNull();
    expect(clampFloor(9.9, 3)).toBeNull();
    expect(clampFloor(NaN, 3)).toBeNull();
  });

  it('keeps the floor at least one dB below the beamwidth level', () => {
    expect(clampFloor(10, 20)).toBe(21);
  });
});
