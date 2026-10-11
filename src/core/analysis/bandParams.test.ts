import { describe, expect, it } from 'vitest';
import {
  BAND_PARAMS,
  bandCell,
  bandParamLabel,
  bandParamTitle,
  bandTable,
  collectSamples,
  columnSummary,
  gainTilts,
  VALIDATION_LABEL,
  type BandParam,
  type BandParamKey,
} from './bandParams';
import { analyzeAll, DEFAULT_SETTINGS, type PatternMetrics, type TaggedPattern } from './metrics';
import { patternFrom } from '../../test/synthetic';
import { bandItems } from '../../test/bandFixture';
import type { GainUnit } from '../types';

const items = bandItems();
const metrics = analyzeAll(items, DEFAULT_SETTINGS);
const ctx = { gainUnit: 'dBi' as GainUnit, settings: DEFAULT_SETTINGS };
const full = { name: '1800–1900 MHz', minMHz: 1800, maxMHz: 1900 };
const [col] = bandTable(items, metrics, [full], ctx);
const param = (key: BandParamKey): BandParam => BAND_PARAMS.find((p) => p.key === key)!;
const cellWith = (m: Map<string, PatternMetrics>, key: BandParamKey, its = items, c = ctx) => bandCell(param(key), its, m, c);
const withMetrics = (edit: (m: Map<string, PatternMetrics>) => void) => {
  const copy = new Map([...metrics].map(([id, m]) => [id, { ...m }]));
  edit(copy);
  return copy;
};
const NA = { value: null, notAvailable: true as const, reason: 'x' };

describe('BAND_PARAMS', () => {
  it('has 20 unique keys with the documented flags', () => {
    expect(new Set(BAND_PARAMS.map((p) => p.key)).size).toBe(20);
    expect(BAND_PARAMS.filter((p) => p.type === 'double' || p.type === 'mean').every((p) => p.mean)).toBe(true);
    // Null fill is a pure 84th percentile (D33): the only single-sided dB row without the excursion rule.
    expect(BAND_PARAMS.filter((p) => p.excursion).map((p) => p.key)).toEqual(
      BAND_PARAMS.filter((p) => (p.type === 'max' || p.type === 'min') && p.unit === 'dB' && p.key !== 'nullFill').map((p) => p.key),
    );
    expect(param('tiltDeviation').description).toContain('beam peak');
    expect(BAND_PARAMS.filter((p) => p.substitute).map((p) => p.key)).toEqual(['usls', 'uslsHorizon', 'uslsMax']);
  });
});

describe('labels and titles', () => {
  const s = { ...DEFAULT_SETTINGS, fbWindowDeg: 45, uslsRangeDeg: 15 };
  it('follow the settings', () => {
    expect(bandParamLabel(param('fbWindow'), s)).toBe('F/B ±45°');
    expect(bandParamLabel(param('usls'), s)).toBe('USLS peak to 15°');
    expect(bandParamLabel(param('uslsHorizon'), s)).toBe('USLS horizon to 15°');
    expect(bandParamLabel(param('hHpbw'), s)).toBe('Azimuth beamwidth');
    expect(bandParamTitle(param('hHpbw'), s)).toBe(
      'Azimuth beamwidth of the co-polar cut (BASTA 7.2.5.1) — double-sided: mean ± tolerance',
    );
    expect(bandParamTitle(param('usls'), s)).toContain('beam peak to 15° above it');
    expect(VALIDATION_LABEL.absolute).toBe('nominal range');
  });
});

describe('gainTilts', () => {
  const at = (tilts: (number | undefined)[]): TaggedPattern[] =>
    tilts.map((t, i) => ({ pattern: patternFrom((a) => a, (a) => a, { id: `g${i}` }), tags: { tiltDeg: t } }));
  it('picks the middle tilt nearest the midpoint, lower on a tie', () => {
    expect(gainTilts(at([2.5, 3, 4, 5, 6, 7, 8]))).toEqual({ min: 2.5, mid: 5, max: 8 });
    expect(gainTilts(at([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))!.mid).toBe(5);
    expect(gainTilts(at([2, 6, 2, 6]))!.mid).toBe(2);
    expect(gainTilts(at([4]))).toEqual({ min: 4, mid: 4, max: 4 });
    expect(gainTilts(at([0, 2, 3, 10]))!.mid).toBe(3);
    expect(gainTilts(at([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))!.mid).toBe(7);
    expect(gainTilts(at([undefined, NaN]))).toBeNull();
  });
  it('leaves the gain-at-tilt rows empty without nominal tilts', () => {
    const noTilt = items.map((i) => ({ ...i, tags: { ...i.tags, tiltDeg: undefined } }));
    const c = cellWith(metrics, 'gainMinTilt', noTilt);
    expect(c.state).toBe('empty');
    expect(c.missing).toBe(12);
    expect(c.tiltDeg).toBeUndefined();
  });
});

describe('the full sub-band', () => {
  const near = (key: BandParamKey, text: string, n: number, state = 'ok') => {
    const c = col.cells[key];
    expect(c.state).toBe(state);
    expect(c.n).toBe(n);
    expect(c.text).toBe(text);
    return c;
  };
  const stat = (key: BandParamKey) => col.cells[key].stat as unknown as Record<string, number>;

  it('summarises the column', () => {
    expect(col.files).toBe(12);
    expect(col.frequencies).toBe(3);
    expect(col.tilts).toEqual([2, 6]);
    expect(columnSummary(col)).toBe('12 files · 3 frequencies · 2 nominal tilts (2°–6°)');
    expect(Object.keys(col.cells)).toEqual(BAND_PARAMS.map((p) => p.key));
  });

  it('gain rows', () => {
    near('gainAll', '17.6 dBi ± 0.5 dB', 12);
    expect(stat('gainAll').mean).toBeCloseTo(17.563711, 4);
    expect(stat('gainAll').lower).toBeCloseTo(17.0737, 4);
    expect(stat('gainAll').upper).toBeCloseTo(18.0263, 4);
    expect(stat('gainAll').tolerance).toBeCloseTo(0.4763, 4);
    near('gainMinTilt', '17.5 dBi @ 2°', 6);
    expect(stat('gainMinTilt').mean).toBeCloseTo(17.46256, 4);
    expect(col.cells.gainMinTilt.tiltDeg).toBe(2);
    near('gainMidTilt', '17.5 dBi @ 2°', 6);
    expect(col.cells.gainMidTilt.tiltDeg).toBe(2);
    near('gainMaxTilt', '17.7 dBi @ 6°', 6);
    expect(stat('gainMaxTilt').mean).toBeCloseTo(17.66256, 4);
    expect(col.cells.gainMaxTilt.tiltDeg).toBe(6);
    const t = near('tiltRange', '2° – 6°', 2);
    expect(t.stat).toBeNull();
  });

  it('beam rows', () => {
    near('hHpbw', '71.0° ± 9.5°', 12);
    expect(stat('hHpbw').mean).toBeCloseTo(71, 4);
    expect(stat('hHpbw').lower).toBeCloseTo(61.474, 3);
    expect(stat('hHpbw').upper).toBeCloseTo(80.526, 3);
    expect(stat('hHpbw').tolerance).toBeCloseTo(9.526, 3);
    near('vHpbw', '8.0° ± 0.0°', 12);
    near('squint', '0.0° ± 1.0°', 12);
    expect(stat('squint').lower).toBeCloseTo(-1, 4);
    expect(stat('squint').upper).toBeCloseTo(1, 4);
    near('tiltDeviation', '< 0.2°', 12);
    expect(stat('tiltDeviation').value).toBeCloseTo(0.24, 4);
    near('fbWindow', '> 26.8 dB', 12);
    expect(stat('fbWindow').value).toBeCloseTo(26.76, 4);
    expect(stat('fbWindow').adjusted).toBe(false);
  });

  it('sidelobe rows', () => {
    for (const k of ['firstUsls', 'usls', 'uslsHorizon', 'uslsMax'] as const) {
      near(k, '> 18.0 dB', 12);
      expect(col.cells[k].substituted).toBe(0);
    }
    near('nullFill', '< 22.0 dB', 12);
    near('firstLsls', '> 15.0 dB', 12);
    const h = near('hSls', '—', 0, 'empty');
    expect(h.missing).toBe(12);
  });

  it('sector rows', () => {
    near('tracking', '< 0.6 dB', 12);
    expect(stat('tracking').value).toBeCloseTo(0.648, 4);
    expect([...col.cells.tracking.values].sort((a, b) => a - b)).toEqual(
      [0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0].map((x) => expect.closeTo(x, 4)),
    );
    near('rollOff', '10.2 dB ± 0.9 dB', 24);
    expect(stat('rollOff').mean).toBeCloseTo(10.236898, 4);
    expect(stat('rollOff').lower).toBeCloseTo(9.3082, 4);
    expect(stat('rollOff').upper).toBeCloseTo(11.0459, 4);
    expect(stat('rollOff').tolerance).toBeCloseTo(0.86885, 4);
    near('air', '12.8 dB ± 1.6 dB', 12);
    expect(stat('air').mean).toBeCloseTo(12.8233, 3);
    expect(stat('air').tolerance).toBeCloseTo(1.592, 3);
  });

  it('converts the gain unit but not its tolerance', () => {
    const [d] = bandTable(items, metrics, [full], { ...ctx, gainUnit: 'dBd' });
    expect(d.cells.gainAll.text).toBe('15.4 dBd ± 0.5 dB');
    expect((d.cells.gainAll.stat as { mean: number }).mean).toBeCloseTo(15.413711, 4);
    expect((d.cells.gainAll.stat as { tolerance: number }).tolerance).toBeCloseTo(0.4763, 4);
  });

  it('has the documented titles', () => {
    const lines = col.cells.hHpbw.title.split('\n');
    expect(lines[0]).toMatch(/^Double-sided \(BASTA 12\.4\.2\)/);
    expect(lines[1]).toBe('N = 12 · min 60.00 · max 82.00 · mean 71.00 · P6.7 61.47 · P93.3 80.53');
    expect(col.cells.gainMinTilt.title).toContain('at 2° nominal tilt');
    expect(col.cells.gainMinTilt.title).toContain('repeatability margin: 16.7 dBi');
    expect(col.cells.gainAll.title).toContain('Declared gain from the file headers; repeatability margin 0.8 dB');
    expect(col.cells.gainAll.title).toContain('The mean is taken over the linear values');
    expect(col.cells.hHpbw.title).not.toContain('linear');
    expect(col.cells.hSls.title).toBe('No values in this sub-band: 12 files without a value');
    expect(col.cells.tiltRange.title).toBe('Nominal electrical tilts of the files (BASTA 7.2.7): 2, 6');
  });
});

describe('other sub-bands', () => {
  it('shows the range when fewer than 10 samples', () => {
    const [c] = bandTable(items, metrics, [{ name: 'low', minMHz: 1800, maxMHz: 1850 }], ctx);
    expect(c.cells.hHpbw.state).toBe('few');
    expect(c.cells.hHpbw.n).toBe(8);
    expect(c.cells.hHpbw.text).toBe('60.0 … 74.0°');
    expect(c.cells.hHpbw.stat).toBeNull();
    expect(c.cells.hHpbw.title).toMatch(/Only 8 values/);
    expect(c.cells.rollOff.state).toBe('ok');
    expect(c.cells.rollOff.n).toBe(16);
    expect(c.cells.gainMinTilt.state).toBe('ok');
    expect(c.cells.gainMinTilt.n).toBe(4);
    expect(c.cells.gainMinTilt.text).toBe('17.3 dBi @ 2°');
    expect((c.cells.gainMinTilt.stat as { mean: number }).mean).toBeCloseTo(17.254891, 4);
    expect(c.cells.tracking.state).toBe('few');
    expect(c.cells.tracking.n).toBe(8);
  });

  it('keeps an empty column', () => {
    const [c] = bandTable(items, metrics, [{ name: 'none', minMHz: 700, maxMHz: 800 }], ctx);
    expect(c.files).toBe(0);
    for (const cell of Object.values(c.cells)) {
      expect(cell.state).toBe('empty');
      expect(cell.text).toBe('—');
    }
  });
});

describe('not available values', () => {
  const usls = (edit: (k: number) => unknown) =>
    withMetrics((m) => {
      for (let k = 0; k < 12; k++) m.get(`f${k}`)!.usls = edit(k) as never;
    });

  it('substitutes 22 dB up to half', () => {
    const c = cellWith(usls((k) => (k < 6 ? { value: 15 + k } : NA)), 'usls');
    expect(c.state).toBe('ok');
    expect(c.n).toBe(12);
    expect(c.substituted).toBe(6);
    expect((c.stat as { value: number }).value).toBeCloseTo(16.76, 4);
    expect(c.text).toBe('> 16.8 dB');
    expect(c.title).toMatch(/6 of 12 values were "not available" and count as 22 dB/);
  });

  it('is not applicable above half', () => {
    const c = cellWith(usls((k) => (k < 5 ? { value: 15 + k } : NA)), 'usls');
    expect(c.state).toBe('notApplicable');
    expect(c.text).toBe('n/a');
    expect(c.n).toBe(12);
    expect(c.values).toEqual([]);
    expect(c.title).toMatch(/7 of 12/);
  });

  it('excludes plain nulls', () => {
    const c = cellWith(usls((k) => (k === 0 ? { value: null, reason: 'HPBW undefined' } : { value: 15 + k })), 'usls');
    expect(c.n).toBe(11);
    expect(c.missing).toBe(1);
    expect(c.title).toMatch(/1 file without a value/);
  });

  it('counts flagged nulls as missing where there is no substitution', () => {
    const m = withMetrics((mm) => {
      for (let k = 0; k < 12; k++) mm.get(`f${k}`)!.firstUsls = k === 0 ? (NA as never) : { value: 16 };
    });
    const c = cellWith(m, 'firstUsls');
    expect(c.n).toBe(11);
    expect(c.missing).toBe(1);
    expect(c.substituted).toBe(0);
  });
});

describe('other rules', () => {
  it('applies the 3 dB excursion rule to dB rows only', () => {
    const m = withMetrics((mm) => {
      for (let k = 0; k < 12; k++) mm.get(`f${k}`)!.fbWindow = { value: k === 0 ? 10 : 18 };
    });
    const c = cellWith(m, 'fbWindow');
    expect((c.stat as { value: number; adjusted: boolean }).value).toBeCloseTo(13, 6);
    expect((c.stat as { adjusted: boolean }).adjusted).toBe(true);
    expect(c.adjusted).toBe(true);
    expect(c.text).toBe('> 13.0 dB*');
    expect(c.title).toMatch(/3 dB excursion rule/);
    expect(c.title.split('\n').filter((l) => l.startsWith('* '))).toEqual([
      '* Lowered to the lowest value + 3 dB (3 dB excursion rule, BASTA 12.2)',
    ]);
    expect(cellWith(metrics, 'fbWindow').adjusted).toBe(false);
    expect(cellWith(metrics, 'fbWindow').text).not.toContain('*');
    const hi = withMetrics((mm) => {
      for (let k = 0; k < 12; k++) mm.get(`f${k}`)!.firstUsls = { value: k === 0 ? 40 : 20 };
    });
    expect(cellWith(hi, 'firstUsls').adjusted).toBe(false);
    const t = withMetrics((mm) => {
      for (let k = 0; k < 12; k++) mm.get(`f${k}`)!.vPeak = { value: k === 0 ? 11 : mm.get(`f${k}`)!.nominalTiltDeg! };
    });
    const td = cellWith(t, 'tiltDeviation');
    expect((td.stat as { value: number; adjusted: boolean }).value).toBeCloseTo(0, 9);
    expect((td.stat as { adjusted: boolean }).adjusted).toBe(false);
    expect(td.adjusted).toBe(false);
  });

  it('keeps null fill a pure 84th percentile and marks only excursion-adjusted cells', () => {
    const m = withMetrics((mm) => {
      for (let k = 0; k < 12; k++) mm.get(`f${k}`)!.nullFill = { value: k === 0 ? 40 : 20 };
    });
    const c = cellWith(m, 'nullFill');
    expect((c.stat as { value: number }).value).toBeCloseTo(20, 9);
    expect(c.adjusted).toBe(false);
    expect(c.text).toBe('< 20.0 dB');
    expect(c.title).not.toContain('excursion');
    // The excursion rule would have raised it to 40 - 3 = 37 dB.
    const raised = withMetrics((mm) => {
      for (let k = 0; k < 12; k++) mm.get(`f${k}`)!.firstUsls = { value: k === 0 ? 5 : 20 };
    });
    expect(cellWith(raised, 'firstUsls').text).toBe('> 8.0 dB*');
  });

  it('guards tracking', () => {
    const m = withMetrics((mm) => {
      for (const id of ['f0', 'f1']) mm.get(id)!.beamTracking = { value: null, reason: 'x' };
    });
    const c = cellWith(m, 'tracking');
    expect(c.n).toBe(10);
    expect(c.missing).toBe(2);
    const none = withMetrics((mm) => {
      for (const v of mm.values()) delete v.trackingEdges;
    });
    const e = cellWith(none, 'tracking');
    expect(e.state).toBe('empty');
    expect(e.missing).toBe(12);
  });

  it('samples the absolute distance of the beam peak from the nominal tilt', () => {
    const m = withMetrics((mm) => {
      mm.get('f0')!.vPeak = { value: 0.5 }; // nominal 2 -> 1.5
      mm.get('f1')!.vPeak = { value: 5 }; // nominal 2 -> 3, above the nominal
      mm.get('f2')!.tiltError = { value: 9 }; // the half-power tilt error is not used any more
    });
    const s = collectSamples('tiltDeviation', items, m, 'dBi');
    expect(s.values).toHaveLength(12);
    expect(s.values.slice(0, 3)).toEqual([1.5, 3, 0]);
  });

  it('measures against the simulated nominal tilt', () => {
    // electrical + mechanical offset 1.5: nominal 3.5 (tilt 2), 7.5 (tilt 6); the peaks sit at 2, 6, and 7 (f10, f11).
    const m = analyzeAll(items, DEFAULT_SETTINGS, { nominalOffsetDeg: 1.5 });
    const s = collectSamples('tiltDeviation', items, m, 'dBi');
    expect(s.values.filter((v) => Math.abs((v as number) - 1.5) < 1e-9)).toHaveLength(10);
    expect(s.values.filter((v) => Math.abs((v as number) - 0.5) < 1e-9)).toHaveLength(2);
  });

  it('leaves files without a nominal tilt or beam peak out', () => {
    const noTilt = items.map((i, k) => (k === 0 ? { ...i, tags: { ...i.tags, tiltDeg: undefined } } : i));
    const m = analyzeAll(noTilt, DEFAULT_SETTINGS);
    expect(collectSamples('tiltDeviation', noTilt, m, 'dBi')).toMatchObject({ missing: 1 });
    const noPeak = withMetrics((mm) => {
      mm.get('f3')!.vPeak = { value: null, reason: 'x' };
    });
    expect(collectSamples('tiltDeviation', items, noPeak, 'dBi')).toMatchObject({ missing: 1 });
  });
});

describe('few samples keep the notes of a full cell (G3)', () => {
  const low = [{ name: 'low', minMHz: 1800, maxMHz: 1850 }];
  it('names files without a value and substituted values', () => {
    const m = withMetrics((mm) => {
      mm.get('f0')!.h = { ...mm.get('f0')!.h, hpbw: { value: null, reason: 'x' } };
      for (const id of ['f1', 'f2']) mm.get(id)!.usls = NA as never;
    });
    const [c] = bandTable(items, m, low, ctx);
    expect(c.cells.hHpbw.state).toBe('few');
    expect(c.cells.hHpbw.n).toBe(7);
    expect(c.cells.hHpbw.title).toContain('1 file without a value');
    expect(c.cells.usls.state).toBe('few');
    expect(c.cells.usls.substituted).toBe(2);
    expect(c.cells.usls.title).toContain('2 of 8 values were "not available" and count as 22 dB (BASTA 12.5.3)');
    expect(c.cells.usls.title).not.toContain('without a value');
    expect(c.cells.firstUsls.title).not.toContain('count as 22 dB');
  });
});

describe('tracking pairs (G4)', () => {
  it('counts a pair only when both files are in the list and name each other', () => {
    const gone = items.filter((i) => i.pattern.id !== 'f1');
    const outside = cellWith(metrics, 'tracking', gone);
    expect(outside.n).toBe(10);
    expect(outside.missing).toBe(1); // f0: its partner f1 is not in this dataset
    const crossed = withMetrics((mm) => {
      mm.get('f0')!.trackingEdges = { partnerId: 'f3', values: [9, 9] };
    });
    const c = cellWith(crossed, 'tracking');
    expect(c.n).toBe(10);
    expect(c.missing).toBe(2); // f0 -> f3 is not mutual, so f1 (-> f0) is left over too
    expect(c.values).not.toContain(9);
  });

  it('counts a duplicate file once and a copy as missing', () => {
    const twice = cellWith(metrics, 'tracking', [...items, items[0]]);
    expect(twice.n).toBe(12);
    expect(twice.missing).toBe(0);
    const copy: TaggedPattern = {
      ...items[0],
      pattern: { ...items[0].pattern, id: 'f0c' },
      copyOf: 'f0',
    };
    const m = withMetrics((mm) => {
      mm.set('f0c', { ...mm.get('f0')!, trackingEdges: { partnerId: 'f1', values: [9, 9] } });
    });
    const c = cellWith(m, 'tracking', [...items, copy]);
    expect(c.n).toBe(12);
    expect(c.missing).toBe(1);
    expect(c.values).not.toContain(9);
  });
});
