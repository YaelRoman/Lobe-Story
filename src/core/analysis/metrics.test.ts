import { describe, expect, it } from 'vitest';
import { analyzeAll, analyzePattern, DEFAULT_SETTINGS, findTrackingPartner, type TaggedPattern } from './metrics';
import { hBeamWithLobes, patternFrom, pwl, quadBeam, vBeamWithLobes } from '../../test/synthetic';
import type { Pattern, Tags } from '../types';

const item = (over: Partial<Pattern> = {}, tags: Tags = {}): TaggedPattern => ({
  pattern: patternFrom(quadBeam(65), vBeamWithLobes, over),
  tags,
});

describe('analyzePattern', () => {
  it('computes H and V metrics', () => {
    const m = analyzePattern(item({}, { tiltDeg: 6 }));
    expect(m.h.hpbw.value).toBeCloseTo(65, 1);
    expect(m.squint.value).toBeCloseTo(0, 5);
    expect(m.v.hpbw.value).toBeCloseTo(8, 5);
    expect(m.tilt.value).toBeCloseTo(6, 5);
    expect(m.tiltError.value).toBeCloseTo(0, 5);
    expect(m.fb180.value).toBe(40);
    expect(m.usls.value).toBe(18);
    expect(m.nullFill.value).toBe(22);
    expect(m.firstUsls.value).toBe(18);
    expect(m.uslsHorizon.value).toBe(18);
    expect(m.uslsMax.value).toBe(18);
    expect(m.firstLsls.value).toBe(15);
    expect(m.hSls.value).toBeNull();
    expect(m.beamTracking).toEqual({ value: null, reason: 'Not computed' });
  });

  it('explains missing nominal tilt and undeclared values', () => {
    const m = analyzePattern(item());
    expect(m.tiltError).toEqual({ value: null, reason: 'Nominal tilt unknown' });
    expect(m.delta.hHpbw).toEqual({ value: null, reason: 'Not declared in file' });
  });

  it('computes deltas against declared values', () => {
    const m = analyzePattern(item({ declared: { hBeamwidth: 64, vBeamwidth: 8.5, frontToBack: 38 } }));
    expect(m.delta.hHpbw.value).toBeCloseTo(1, 1);
    expect(m.delta.vHpbw.value).toBeCloseTo(-0.5, 5);
    expect(m.delta.fb.value).toBeCloseTo(2, 5);
  });

  it('ignores a constant offset on the V cut', () => {
    const shifted = patternFrom(quadBeam(65), (a) => vBeamWithLobes(a) + 2);
    const m = analyzePattern({ pattern: shifted, tags: {} });
    expect(m.v.hpbw.value).toBeCloseTo(8, 5);
    expect(m.usls.value).toBe(18);
  });
});

describe('sidelobe settings', () => {
  const withH = patternFrom(hBeamWithLobes, vBeamWithLobes);

  it('reports the horizontal sidelobe inside the sector', () => {
    const m = analyzePattern({ pattern: withH, tags: {} });
    expect(m.hSls.value).toBeCloseTo(12, 6);
    expect(m.hSls.angle).toBeCloseTo(35, 6);
    const edge = analyzePattern({ pattern: withH, tags: {} }, { ...DEFAULT_SETTINGS, sectorEdgeDeg: 33 });
    expect(edge.hSls.value).toBeCloseTo(14.6, 6);
  });

  it('uslsRangeDeg sizes the peak window; levelDb does not matter', () => {
    const narrow = analyzePattern({ pattern: withH, tags: {} }, { ...DEFAULT_SETTINGS, uslsRangeDeg: 8 });
    expect(narrow.usls.notAvailable).toBe(true);
    const level = analyzePattern({ pattern: withH, tags: {} }, { ...DEFAULT_SETTINGS, levelDb: 10 });
    expect(level.firstUsls.value).toBeCloseTo(18, 6);
    expect(level.firstUsls.angle).toBeCloseTo(-8, 6);
  });

  it('no longer has a null search range', () => {
    expect('nullSearchDeg' in DEFAULT_SETTINGS).toBe(false);
  });
});

describe('findTrackingPartner', () => {
  const mk = (id: string, tags: Tags, over: Partial<Pattern> = {}): TaggedPattern => ({
    pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id, fileName: id, ...over }),
    tags,
  });

  it('pairs +45 with −45 at the same frequency, tilt and array', () => {
    const p = mk('p', { polarization: '+45', tiltDeg: 8, array: 'Y2' });
    const m = mk('m', { polarization: '-45', tiltDeg: 8, array: 'Y2' });
    const other = mk('o', { polarization: '-45', tiltDeg: 8, array: 'Y2' }, { frequencyMHz: 1900 });
    expect(findTrackingPartner(p, [p, m, other])).toEqual({ partner: m });
  });

  it('requires adjacent odd/even numeric ports', () => {
    const p1 = mk('p1', { polarization: '+45', tiltDeg: 5, port: '1' });
    const m2 = mk('m2', { polarization: '-45', tiltDeg: 5, port: '2' });
    const p3 = mk('p3', { polarization: '+45', tiltDeg: 5, port: '3' });
    expect(findTrackingPartner(p1, [p1, m2, p3])).toEqual({ partner: m2 });
    expect(findTrackingPartner(p3, [p1, m2, p3])).toEqual({ reason: 'No opposite-polarization partner loaded' });
  });

  it('requires the same MAKE when both files declare one', () => {
    const p = mk('p', { polarization: '+45', tiltDeg: 0, port: '1' }, { make: 'Vendor B' });
    const m = mk('m', { polarization: '-45', tiltDeg: 0, port: '2' }, { make: 'ACME' });
    expect(findTrackingPartner(p, [p, m])).toEqual({ reason: 'No opposite-polarization partner loaded' });
  });

  it("doesn't let a duplicate steal its source's partner: an original prefers another original", () => {
    const plus = mk('plus', { polarization: '+45', tiltDeg: 8, array: 'Y2' });
    const minus = mk('minus', { polarization: '-45', tiltDeg: 8, array: 'Y2' });
    const minusCopy: TaggedPattern = { ...mk('minus#copy-2', { polarization: '-45', tiltDeg: 8, array: 'Y2' }), copyOf: 'minus' };
    expect(findTrackingPartner(plus, [plus, minus, minusCopy])).toEqual({ partner: minus });
    // and a copy prefers pairing with the sibling copy over the (already-claimed) original
    const plusCopy: TaggedPattern = { ...mk('plus#copy-2', { polarization: '+45', tiltDeg: 8, array: 'Y2' }), copyOf: 'plus' };
    expect(findTrackingPartner(plusCopy, [plus, minus, minusCopy])).toEqual({ partner: minusCopy });
  });

  it('reports ambiguity and non-±45 polarizations', () => {
    const p = mk('p', { polarization: '+45', tiltDeg: 8 });
    const m1 = mk('m1', { polarization: '-45', tiltDeg: 8 });
    const m2 = mk('m2', { polarization: '-45', tiltDeg: 8 });
    expect(findTrackingPartner(p, [p, m1, m2])).toEqual({ reason: 'Ambiguous: 2 possible partners' });
    expect(findTrackingPartner(mk('x', {}), [])).toEqual({ reason: 'Polarization is not ±45' });
    expect(findTrackingPartner(mk('y', { polarization: '+45' }), [])).toEqual({ reason: 'Nominal tilt unknown' });
  });
});

describe('analyzeAll', () => {
  it('fills beam tracking for pairs and keys results by id', () => {
    const p: TaggedPattern = {
      pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'p' }),
      tags: { polarization: '+45', tiltDeg: 8 },
    };
    const m: TaggedPattern = {
      pattern: patternFrom((a) => quadBeam(65)(a) + (a === 20 ? 1.5 : 0), vBeamWithLobes, { id: 'm' }),
      tags: { polarization: '-45', tiltDeg: 8 },
    };
    const all = analyzeAll([p, m]);
    expect(all.get('p')!.beamTracking).toEqual({ value: 1.5, angle: 20 });
    expect(all.get('m')!.beamTracking).toEqual({ value: 1.5, angle: 20 });
  });
});

describe('sector metrics', () => {
  it('analyzePattern exposes SPR, AIR, roll-off and D/U', () => {
    const m = analyzePattern(item());
    expect(m.spr.value).not.toBeNull();
    expect(m.air.value).not.toBeNull();
    expect(m.rollOff.value).toBeCloseTo(3 * (60 / 32.5) ** 2, 6);
    expect(Object.keys(m.du)).toEqual(['qam16', 'qam64', 'qam256']);
    expect(m.du.qam16.value).toBeGreaterThan(m.du.qam64.value!);
  });

  it('keeps the aperture edges on the D/U entries', () => {
    const m = analyzePattern(item());
    for (const l of ['qam16', 'qam64', 'qam256'] as const) {
      const r = m.du[l];
      expect(r.edges).toBeDefined();
      expect(r.edges![1] - r.edges![0]).toBeCloseTo(r.value!, 9);
    }
  });

  const pair = (gp?: Pattern['gain'], gm?: Pattern['gain']) => {
    const p: TaggedPattern = {
      pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'p', gain: gp }),
      tags: { polarization: '+45', tiltDeg: 8 },
    };
    const m: TaggedPattern = {
      pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'm', gain: gm }),
      tags: { polarization: '-45', tiltDeg: 8 },
    };
    return analyzeAll([p, m]);
  };

  it('makes port tracking gain-aware when both gains are declared', () => {
    const all = pair({ value: 15, unit: 'dBd' }, { value: 14.2, unit: 'dBd' });
    expect(all.get('p')!.beamTracking.value).toBeCloseTo(0.8, 9);
    expect(all.get('m')!.beamTracking.value).toBeCloseTo(0.8, 9);
  });

  it('converts dBi to dBd before subtracting', () => {
    const all = pair({ value: 17.15, unit: 'dBi' }, { value: 14.2, unit: 'dBd' });
    expect(all.get('p')!.beamTracking.value).toBeCloseTo(0.8, 9);
  });

  it('ignores gain when one is missing', () => {
    const all = pair({ value: 15, unit: 'dBd' }, undefined);
    expect(all.get('p')!.beamTracking.value).toBeCloseTo(0, 9);
  });
});

describe('10 dB beamwidths and beam peak directions', () => {
  const withH = (h: (a: number) => number): TaggedPattern => ({
    pattern: patternFrom(h, vBeamWithLobes),
    tags: {},
  });

  it('computes both 10 dB beamwidths and peak angles', () => {
    const m = analyzePattern(item());
    expect(m.hBw10.value).toBeCloseTo(118.669, 2);
    expect(m.vBw10.value).toBeCloseTo(14.222, 2);
    expect(m.hPeak.value).toBeCloseTo(0, 2);
    expect(m.vPeak.value).toBeCloseTo(6, 2);
  });

  it('uses the 1 degree linear interpolation', () => {
    expect(analyzePattern(withH(quadBeam(60))).hBw10.value).toBeCloseTo(109.541, 2);
  });

  it('reports a steered peak as peak and squint', () => {
    const m = analyzePattern(withH(quadBeam(65, 10)));
    expect(m.hPeak.value).toBeCloseTo(10, 2);
    expect(m.squint.value).toBeCloseTo(10, 2);
  });

  it('separates the peak from the bisector on an asymmetric cut', () => {
    const m = analyzePattern(
      withH(pwl([[-180, 30], [-60, 30], [-20, 3], [0, 0], [40, 3], [80, 30], [180, 30]])),
    );
    expect(m.h.hpbw.value).toBeCloseTo(60, 2);
    expect(m.squint.value).toBeCloseTo(10, 2);
    expect(m.hBw10.value).toBeCloseTo(80.741, 2);
    expect(m.hPeak.value).toBeCloseTo(0.1667, 3);
  });

  it('explains a cut that never drops 10 dB', () => {
    const m = analyzePattern(withH((a) => Math.min(3 * (a / 30) ** 2, 8)));
    expect(m.hBw10.value).toBeNull();
    expect(m.hBw10.reason).toMatch(/never drops 10 dB/);
  });

  it('does not depend on the level setting', () => {
    const m = analyzePattern(item(), { ...DEFAULT_SETTINGS, levelDb: 6 });
    expect(m.hBw10.value).toBeCloseTo(118.669, 2);
  });
});
