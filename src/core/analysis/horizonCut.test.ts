import { describe, expect, it } from 'vitest';
import { analyzeAll, analyzePattern, DEFAULT_SETTINGS, type TaggedPattern } from './metrics';
import { analyzeTilted, baseGrids, DECLARED_REASON, horizonCutPeakDb, tiltEach, tiltPattern, tiltTagged, type TiltSettings } from './tilt';
import { rawGrid, toGrid } from './grid';
import type { Method3d } from './pattern3d';
import type { Pattern } from '../types';
import { exampleFiles } from '../exampleSet';
import { parsePlanet } from '../parse/planet';
import { inferTags } from '../grouping';
import { patternFrom, quadBeam, vBeamWithLobes } from '../../test/synthetic';

const METHODS: Method3d[] = ['summation', 'weighted'];
const RAD = Math.PI / 180;
const maxAbsDiff = (a: number[], b: number[]) => a.reduce((d, v, i) => Math.max(d, Math.abs(v - b[i])), 0);

/** A 65° × 8° panel whose beam peak is at the horizon. */
const level0 = patternFrom(quadBeam(65), quadBeam(8, 0, 30));
/** The same panel with 6° of built-in electrical tilt and sidelobes. */
const builtIn6 = patternFrom(quadBeam(65), vBeamWithLobes);
/** A file whose cuts carry an offset of their own. */
const withOffset = patternFrom((a) => 0.25 + quadBeam(65)(a), quadBeam(8, 0, 30));

const mech = (m: number): TiltSettings => ({ electricalDeg: 0, mechanicalDeg: m });
const elec = (e: number): TiltSettings => ({ electricalDeg: e, mechanicalDeg: 0 });

/** dB level of a 1° circle at any angle, linear in dB between the samples. */
function level(g: number[], angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  const i = Math.floor(a) % 360;
  const f = a - Math.floor(a);
  return g[i] * (1 - f) + g[(i + 1) % 360] * f;
}

/**
 * This test's own model, written without the app's rotation code: the level of the tilted antenna towards the ground
 * direction at azimuth `azDeg` on the horizon. The unit vector (x forward, y left, z up) is turned about the y axis
 * into the frame of an antenna whose boresight points `mechDeg` below the horizon; there the H cut is read at the
 * azimuth and the V cut at the elevation less the electrical tilt.
 */
function horizonLevel(p: Pattern, t: TiltSettings, method: Method3d, azDeg: number): number {
  const h = toGrid(p.horizontal);
  const v = toGrid(p.vertical);
  const x = Math.cos(azDeg * RAD);
  const y = Math.sin(azDeg * RAD);
  const cm = Math.cos(t.mechanicalDeg * RAD);
  const sm = Math.sin(t.mechanicalDeg * RAD);
  // Boresight is (cos m, 0, −sin m); the antenna's "down" axis is (−sin m, 0, −cos m). The horizon vector has z = 0.
  const forward = x * cm;
  const down = -x * sm;
  const aH = level(h, Math.atan2(y, forward) / RAD);
  const aV = level(v, Math.asin(down) / RAD - t.electricalDeg);
  if (method === 'summation') return aH + aV;
  const ph = 10 ** (-aH / 10);
  const pv = 10 ** (-aV / 10);
  const w1 = pv * (1 - ph);
  const w2 = ph * (1 - pv);
  return w1 + w2 < 1e-12 ? aH + aV : (aH * w1 + aV * w2) / (w1 + w2);
}

const analysed = (p: Pattern, t: TiltSettings, method: Method3d, hCut: 'beam' | 'horizon') =>
  analyzeTilted(tiltTagged([{ pattern: p, tags: {} }], t, method, hCut), DEFAULT_SETTINGS, t).get(p.id)!;

describe('the simulated horizontal cut at the horizon', () => {
  it('at zero tilt is a copy with the horizon cut and the file\'s own vertical cut; through the beam peak it is the file itself', () => {
    for (const method of METHODS) {
      for (const p of [level0, builtIn6, withOffset]) {
        expect(tiltPattern(p, mech(0), method, 'beam')).toBe(p);
        const copy = tiltPattern(p, mech(0), method, 'horizon');
        expect(copy).not.toBe(p);
        expect(copy.vertical).toBe(p.vertical);
        expect(tiltPattern(p, mech(0), method, 'horizon')).toBe(copy);
        // The same model as under a tilt: this test's own rotation, with no rotation left.
        const hOff = baseGrids(p).hOff;
        expect(maxAbsDiff(copy.horizontal.atten, copy.horizontal.atten.map((_, az) => hOff + horizonLevel(p, mech(0), method, az)))).toBeLessThan(1e-9);
      }
      // A beam peak at 0° elevation: the horizon cut is the file's H cut, value for value.
      for (const p of [level0, withOffset]) {
        expect(maxAbsDiff(tiltPattern(p, mech(0), method, 'horizon').horizontal.atten, rawGrid(p.horizontal))).toBeLessThan(1e-12);
        expect(horizonCutPeakDb(tiltPattern(p, mech(0), method, 'horizon'))).toBeCloseTo(0, 12);
      }
    }
    // Built-in tilt of 6°: the horizon is 6° above the peak, where the V cut is 7.5 dB down; Summation lowers the whole cut by that.
    const h = toGrid(builtIn6.horizontal);
    expect(maxAbsDiff(tiltPattern(builtIn6, mech(0), 'summation', 'horizon').horizontal.atten, h.map((a) => a + 7.5))).toBeLessThan(1e-9);
    expect(horizonCutPeakDb(tiltPattern(builtIn6, mech(0), 'summation', 'horizon'))).toBeCloseTo(7.5, 9);
  });

  it('has no jump at the first slider step: the cut at zero tilt is the limit of the cut at a small tilt', () => {
    for (const method of METHODS) {
      for (const p of [level0, builtIn6, withOffset]) {
        const zero = tiltPattern(p, mech(0), method, 'horizon').horizontal.atten;
        for (const t of [mech(1e-9), elec(1e-9), mech(-1e-9)]) expect(maxAbsDiff(tiltPattern(p, t, method, 'horizon').horizontal.atten, zero)).toBeLessThan(1e-6);
      }
    }
  });

  it('is made for every file of a list, tilted or not; through the beam peak untilted files keep their object', () => {
    const items: TaggedPattern[] = [{ pattern: { ...level0, id: 'first' }, tags: {} }, { pattern: { ...builtIn6, id: 'second' }, tags: {} }];
    const tiltFor = (id: string) => (id === 'first' ? mech(3) : mech(0));
    const none = () => mech(0);
    expect(tiltEach(items, none, 'summation', 'beam')).toBe(items);
    expect(tiltEach(items, tiltFor, 'summation', 'beam')[1]).toBe(items[1]);
    const horizon = tiltEach(items, none, 'summation', 'horizon');
    expect(horizon.map((i) => horizonCutPeakDb(i.pattern) !== undefined)).toEqual([true, true]);
    expect(tiltEach(items, tiltFor, 'summation', 'horizon').map((i) => horizonCutPeakDb(i.pattern) !== undefined)).toEqual([true, true]);
  });

  it('tends to the file H cut as the tilt goes to zero when the beam peak is at elevation 0°', () => {
    for (const method of METHODS) {
      for (const p of [level0, withOffset]) {
        const raw = rawGrid(p.horizontal);
        for (const t of [mech(1e-9), elec(1e-9)]) {
          expect(maxAbsDiff(tiltPattern(p, t, method, 'horizon').horizontal.atten, raw)).toBeLessThan(1e-6);
          expect(maxAbsDiff(tiltPattern(p, t, method, 'beam').horizontal.atten, raw)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('of a file with built-in tilt is, from the smallest offset on, the cut above the beam (not the file cut)', () => {
    // The file's H cut lies on the cone through its beam peak, 6° below the horizon. The horizon cut is read 6° above
    // the peak, where the V cut is 7.5 dB down (3 dB at 4° and 12 dB at 8° off the peak, linear in between): Summation
    // lowers the whole cut by that much, with or without an offset.
    const vAtHorizon = toGrid(builtIn6.vertical)[0];
    expect(vAtHorizon).toBeCloseTo(7.5, 9);
    const h = toGrid(builtIn6.horizontal);
    const tiny = tiltPattern(builtIn6, elec(1e-9), 'summation', 'horizon').horizontal.atten;
    expect(maxAbsDiff(tiny, h.map((a) => a + vAtHorizon))).toBeLessThan(1e-6);
    // The cut through the beam peak does not jump.
    expect(maxAbsDiff(tiltPattern(builtIn6, elec(1e-9), 'summation', 'beam').horizontal.atten, h)).toBeLessThan(1e-6);
    // Weighted: the same direction, combined by its own rule; boresight (H at 0 dB) is the V level alone.
    expect(tiltPattern(builtIn6, elec(1e-9), 'weighted', 'horizon').horizontal.atten[0]).toBeCloseTo(vAtHorizon, 6);
  });

  it('is never above the 3D peak (0 dB, or the file\'s own H offset)', () => {
    for (const method of METHODS) {
      for (const p of [level0, builtIn6, withOffset]) {
        const hOff = baseGrids(p).hOff;
        for (let e = -10; e <= 15; e += 2.5) {
          for (let m = -10; m <= 15; m += 2.5) {
            if (e === 0 && m === 0) continue;
            const t = tiltPattern(p, { electricalDeg: e, mechanicalDeg: m }, method, 'horizon');
            expect(Math.min(...t.horizontal.atten)).toBeGreaterThanOrEqual(hOff - 1e-9);
            expect(t.horizontal.atten.every(Number.isFinite)).toBe(true);
          }
        }
      }
    }
  });

  it('equals an independent rotation of the 3D reconstruction, sampled on the horizon', () => {
    const cases: [Pattern, TiltSettings][] = [
      [level0, mech(6)],
      [builtIn6, mech(6)],
      [builtIn6, mech(-4.5)],
      [builtIn6, { electricalDeg: 2, mechanicalDeg: 3 }],
      [withOffset, mech(10)],
    ];
    for (const method of METHODS) {
      for (const [p, t] of cases) {
        const hOff = baseGrids(p).hOff;
        const cut = tiltPattern(p, t, method, 'horizon').horizontal.atten;
        const own = cut.map((_, az) => hOff + horizonLevel(p, t, method, az));
        expect(maxAbsDiff(cut, own)).toBeLessThan(1e-6);
      }
    }
  });

  it('leaves the vertical cut as in the other mode', () => {
    const t = { electricalDeg: 2, mechanicalDeg: 3 };
    expect(tiltPattern(builtIn6, t, 'weighted', 'horizon').vertical).toEqual(tiltPattern(builtIn6, t, 'weighted', 'beam').vertical);
  });

  it('keeps one copy per mode, so asking for the other mode does not rebuild the first', () => {
    const t = mech(3.5);
    const horizon = tiltPattern(level0, t, 'summation', 'horizon');
    const beam = tiltPattern(level0, t, 'summation', 'beam');
    expect(beam).not.toBe(horizon);
    expect(tiltPattern(level0, t, 'summation', 'horizon')).toBe(horizon);
    expect(tiltPattern(level0, t, 'summation', 'beam')).toBe(beam);
  });
});

describe('the default mode (through the beam peak)', () => {
  it('is what a call without a mode gives, value for value', () => {
    for (const method of METHODS) {
      for (const t of [mech(4), elec(4), { electricalDeg: -2, mechanicalDeg: 7.5 }]) {
        const fresh = () => patternFrom(quadBeam(65), vBeamWithLobes);
        expect(tiltPattern(fresh(), t, method, 'beam')).toEqual(tiltPattern(fresh(), t, method));
        const items: TaggedPattern[] = [{ pattern: fresh(), tags: {} }];
        expect(tiltEach(items, () => t, method, 'beam')).toEqual(tiltEach(items, () => t, method));
      }
    }
  });

  it('keeps the pinned distortion of the synthetic 65° × 8° pattern, and its metrics carry no horizon level', () => {
    // The same figures as the pin in tilt.test.ts, asked for with the mode named.
    const pins: [number, Method3d, number, number][] = [
      [4, 'summation', 60.96, 52],
      [-10, 'summation', 55.01, 65],
      [4, 'weighted', 68.59, 39.96],
      [-10, 'weighted', 70.07, 39.54],
    ];
    for (const [m, method, hpbw, fb] of pins) {
      const got = analysed(builtIn6, mech(m), method, 'beam');
      expect(got.h.hpbw.value).toBeCloseTo(hpbw, 2);
      expect(got.fb180.value).toBeCloseTo(fb, 2);
      expect(got.hCutPeakDb).toBeUndefined();
      expect('hCutPeakDb' in got).toBe(false);
    }
    expect(horizonCutPeakDb(builtIn6)).toBeUndefined();
    expect(horizonCutPeakDb(tiltPattern(builtIn6, mech(4), 'summation'))).toBeUndefined();
  });
});

describe('what the model gives on the horizon cut', () => {
  const hpbw = (p: Pattern, t: TiltSettings, method: Method3d) => analysed(p, t, method, 'horizon').h.hpbw.value!;

  it('mechanical tilt widens the horizon cut of a 65° panel whose beam is at the horizon (Weighted)', () => {
    expect(analyzePattern({ pattern: level0, tags: {} }).h.hpbw.value).toBeCloseTo(64.99, 2);
    const widths = [2, 4, 6].map((m) => hpbw(level0, mech(m), 'weighted'));
    expect(widths[0]).toBeCloseTo(73.92, 1);
    expect(widths[1]).toBeCloseTo(90.03, 1);
    expect(widths[2]).toBeCloseTo(104.78, 1);
    // Up-tilt and down-tilt are the same on the horizon cut of a symmetric elevation beam.
    expect(hpbw(level0, mech(-6), 'weighted')).toBeCloseTo(widths[2], 6);
  });

  it('Summation widens it too, a little less at first, and keeps the maximum at boresight (Weighted splits it in two)', () => {
    const widths = [2, 4, 6].map((m) => hpbw(level0, mech(m), 'summation'));
    expect(widths[0]).toBeCloseTo(66.95, 1);
    expect(widths[1]).toBeCloseTo(75.98, 1);
    expect(widths[2]).toBeCloseTo(97.71, 1);
    expect(analysed(level0, mech(6), 'summation', 'horizon').hPeak.value).toBeCloseTo(0, 6);
    // With Weighted the strongest direction of the horizon cut moves off boresight: the sides of a tilted panel look
    // at the horizon while its boresight looks below it.
    expect(Math.abs(analysed(level0, mech(6), 'weighted', 'horizon').hPeak.value!)).toBeCloseTo(35.5, 0);
  });

  it('on the cut through the beam peak the same tilt does not widen with Summation', () => {
    expect(analysed(level0, mech(6), 'summation', 'beam').h.hpbw.value!).toBeLessThan(65);
  });

  it('electrical tilt alone lowers the horizon cut: by the V cut\'s level at the horizon with Summation', () => {
    const h = toGrid(level0.horizontal);
    const v = toGrid(level0.vertical);
    for (const e of [2, 4, 6]) {
      // The beam moved down by e: the horizon is e above the peak.
      const drop = v[360 - e];
      const cut = tiltPattern(level0, elec(e), 'summation', 'horizon').horizontal.atten;
      expect(maxAbsDiff(cut, h.map((a) => a + drop))).toBeLessThan(1e-9);
      const m = analysed(level0, elec(e), 'summation', 'horizon');
      expect(m.hCutPeakDb).toBeCloseTo(drop, 9);
      // The shape is the file's: same beamwidth.
      expect(m.h.hpbw.value).toBeCloseTo(64.99, 2);
      // Weighted lowers the maximum as well (by less: its level at the sides falls more slowly).
      const w = analysed(level0, elec(e), 'weighted', 'horizon').hCutPeakDb!;
      expect(w).toBeGreaterThan(0.5);
      expect(w).toBeLessThanOrEqual(drop + 1e-9);
    }
    expect(analysed(level0, elec(4), 'summation', 'horizon').hCutPeakDb).toBeCloseTo(3, 9);
    // The cut through the beam peak does not move under electrical tilt.
    expect(maxAbsDiff(tiltPattern(level0, elec(4), 'summation', 'beam').horizontal.atten, h)).toBeLessThan(0.05);
  });
});

describe('metrics of a horizon cut', () => {
  it('measure widths against the cut\'s own maximum and levels against the 3D peak', () => {
    for (const method of METHODS) {
      const t = { electricalDeg: 1, mechanicalDeg: 5 };
      const tilted = tiltPattern(builtIn6, t, method, 'horizon');
      const raw = tilted.horizontal.atten; // the file has no H offset: these are levels below the 3D peak
      const own = toGrid(tilted.horizontal);
      const below = Math.min(...raw);
      const m = analysed(builtIn6, t, method, 'horizon');
      expect(below).toBeGreaterThan(3);
      expect(m.hCutPeakDb).toBeCloseTo(below, 9);
      // Levels: below the 3D peak.
      expect(m.fb180.value).toBeCloseTo(raw[180], 9);
      expect(m.fbWindow.value).toBeCloseTo(Math.min(...raw.slice(150, 211)), 9);
      expect(m.rollOffEdges[0]).toBeCloseTo(raw[300], 9);
      expect(m.rollOffEdges[1]).toBeCloseTo(raw[60], 9);
      expect(m.rollOff.value).toBeCloseTo(Math.max(raw[300], raw[60]), 9);
      // Widths, directions and power ratios: those of the cut as a cut (its own maximum is the reference).
      const plain = analyzePattern({ pattern: { ...tilted }, tags: {} });
      expect(m.h).toEqual(plain.h);
      expect(m.hBw10).toEqual(plain.hBw10);
      expect(m.squint).toEqual(plain.squint);
      expect(m.hPeak).toEqual(plain.hPeak);
      expect(m.spr).toEqual(plain.spr);
      expect(m.air).toEqual(plain.air);
      expect(m.du).toEqual(plain.du);
      expect(plain.fb180.value).toBeCloseTo(own[180], 9);
      expect(m.fb180.value! - plain.fb180.value!).toBeCloseTo(below, 9);
      if (plain.hSls.value !== null) expect(m.hSls.value! - plain.hSls.value).toBeCloseTo(below, 9);
      // The vertical metrics do not know about the choice.
      const beam = analysed(builtIn6, t, method, 'beam');
      expect(m.v).toEqual(beam.v);
      expect(m.tilt).toEqual(beam.tilt);
      expect(m.usls).toEqual(beam.usls);
      expect(m.nullFill).toEqual(beam.nullFill);
    }
  });

  it('compare two ports at the horizon, each against its own 3D peak', () => {
    // Two ports with the same H cut; one has its elevation beam 2° lower. Their H cuts through the beam peak agree
    // (tracking 0), but at the horizon the lower beam is weaker everywhere.
    const plus: TaggedPattern = { pattern: patternFrom(quadBeam(65), quadBeam(8, 0, 30), { id: 'plus' }), tags: { polarization: '+45', tiltDeg: 0 } };
    const minus: TaggedPattern = { pattern: patternFrom(quadBeam(65), quadBeam(8, 2, 30), { id: 'minus' }), tags: { polarization: '-45', tiltDeg: 0 } };
    const items = [plus, minus];
    expect(analyzeAll(items).get('plus')!.beamTracking.value).toBeCloseTo(0, 9);
    const t = elec(2);
    const beam = analyzeTilted(tiltTagged(items, t, 'summation', 'beam'), DEFAULT_SETTINGS, t);
    expect(beam.get('plus')!.beamTracking.value).toBeLessThan(0.05);
    const horizon = analyzeTilted(tiltTagged(items, t, 'summation', 'horizon'), DEFAULT_SETTINGS, t);
    // Horizon is 2° above one peak (0.75 dB down) and 4° above the other (3 dB down).
    expect(horizon.get('plus')!.hCutPeakDb).toBeCloseTo(0.75, 9);
    expect(horizon.get('minus')!.hCutPeakDb).toBeCloseTo(3, 9);
    expect(horizon.get('plus')!.beamTracking.value).toBeCloseTo(2.25, 9);
    expect(horizon.get('minus')!.beamTracking.value).toBeCloseTo(2.25, 9);
    expect(horizon.get('plus')!.trackingEdges!.values[0]).toBeCloseTo(2.25, 9);
    expect(horizon.get('plus')!.trackingEdges!.values[1]).toBeCloseTo(2.25, 9);
  });

  it('a tilted file is compared with an untilted partner\'s horizon cut', () => {
    const plus: TaggedPattern = { pattern: patternFrom(quadBeam(65), quadBeam(8, 0, 30), { id: 'plus' }), tags: { polarization: '+45', tiltDeg: 0 } };
    const minus: TaggedPattern = { pattern: patternFrom(quadBeam(65), quadBeam(8, 0, 30), { id: 'minus' }), tags: { polarization: '-45', tiltDeg: 0 } };
    const tiltFor = (id: string) => (id === 'plus' ? elec(4) : elec(0));
    const m = analyzeTilted(tiltEach([plus, minus], tiltFor, 'summation', 'horizon'), DEFAULT_SETTINGS, tiltFor);
    // The partner's beam peak is at the horizon: its horizon cut is its file cut, 0 dB below the 3D peak.
    expect(m.get('minus')!.hCutPeakDb).toBeCloseTo(0, 12);
    expect(m.get('plus')!.beamTracking.value).toBeCloseTo(3, 9);
    expect(m.get('minus')!.beamTracking.value).toBeCloseTo(3, 9);
  });

  it('two ports with built-in tilt, one given 1° of mechanical tilt: horizon cut against horizon cut, no jump', () => {
    // Two ports of an example antenna with 8° of built-in tilt (synthetic data). Their horizon cuts are both far
    // below the 3D peak; one more degree on one port changes the difference by a fraction of a dB, not by the level
    // of the cut (which a comparison with the partner's cut through the beam peak would give).
    const ports = exampleFiles().slice(16, 18).map((f): TaggedPattern => {
      const r = parsePlanet(f.text, f.name);
      if (!r.ok) throw new Error(r.error);
      return { pattern: r.pattern, tags: inferTags(r.pattern) };
    });
    const [p0, p1] = ports.map((i) => i.pattern.id);
    const file = analyzeAll(ports).get(p0)!.beamTracking.value!;
    expect(file).toBeCloseTo(0.48, 2);
    const run = (mechDeg: number) => {
      const tiltFor = (id: string) => mech(id === p0 ? mechDeg : 0);
      return analyzeTilted(tiltEach(ports, tiltFor, 'summation', 'horizon'), DEFAULT_SETTINGS, tiltFor);
    };
    const none = run(0);
    const one = run(1);
    // Both ports are horizon cuts, about as far down as each other.
    for (const m of [none, one]) for (const id of [p0, p1]) expect(m.get(id)!.hCutPeakDb).toBeGreaterThan(9);
    expect(Math.abs(none.get(p0)!.hCutPeakDb! - none.get(p1)!.hCutPeakDb!)).toBeLessThan(1);
    expect(none.get(p0)!.beamTracking.value).toBeCloseTo(0.48, 2);
    expect(one.get(p0)!.beamTracking.value).toBeCloseTo(3.05, 2);
    expect(one.get(p1)!.beamTracking.value).toBeCloseTo(3.05, 2);
    // Not the 12.9 dB of a horizon cut compared with a cut through the beam peak.
    expect(one.get(p0)!.beamTracking.value!).toBeLessThan(6);
    expect(Math.abs(one.get(p0)!.beamTracking.value! - none.get(p0)!.beamTracking.value!)).toBeLessThan(5);
  });

  it('of an untilted file leave everything read from the vertical cut exactly the file\'s own', () => {
    for (const method of METHODS) {
      const item: TaggedPattern = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { declared: { hBeamwidth: 65, vBeamwidth: 8, frontToBack: 30 } }), tags: { tiltDeg: 6 } };
      const file = analyzeAll([item], DEFAULT_SETTINGS, { areMethod: method }).get(item.pattern.id)!;
      const none = () => mech(0);
      const m = analyzeTilted(tiltEach([item], none, method, 'horizon'), DEFAULT_SETTINGS, none, method).get(item.pattern.id)!;
      for (const key of ['v', 'vBw10', 'vPeak', 'tilt', 'tiltError', 'nominalTiltDeg', 'usls', 'nullFill', 'firstUsls', 'uslsHorizon', 'uslsMax', 'firstLsls', 'are'] as const) {
        expect(m[key], key).toEqual(file[key]);
      }
      // The declared V beamwidth still describes the cut shown; the declared H beamwidth and F/B do not describe a horizon cut.
      expect(file.delta.vHpbw.value).not.toBeNull();
      expect(m.delta.vHpbw).toEqual(file.delta.vHpbw);
      expect(m.delta.hHpbw).toEqual({ value: null, reason: DECLARED_REASON });
      expect(m.delta.fb).toEqual({ value: null, reason: DECLARED_REASON });
      expect(m.hCutPeakDb).toBeGreaterThan(5);
      // Under a tilt all three are blank, as before.
      const t = () => mech(2);
      expect(analyzeTilted(tiltEach([item], t, method, 'horizon'), DEFAULT_SETTINGS, t).get(item.pattern.id)!.delta.vHpbw).toEqual({ value: null, reason: DECLARED_REASON });
    }
  });
});

describe('the angular-region estimate does not depend on the horizontal cut shown', () => {
  const example = (index: number): Pattern => {
    const f = exampleFiles()[index];
    const r = parsePlanet(f.text, f.name);
    if (!r.ok) throw new Error(r.error);
    return r.pattern;
  };

  it('gives the same three ratios in both modes: mechanical, electrical and both', () => {
    for (const method of METHODS) {
      for (const t of [mech(4), mech(10), elec(3), { electricalDeg: 2, mechanicalDeg: 6 }]) {
        for (const index of [0, 9]) {
          const are = (hCut: 'beam' | 'horizon') => {
            const items: TaggedPattern[] = [{ pattern: example(index), tags: {} }];
            return analyzeTilted(tiltTagged(items, t, method, hCut), DEFAULT_SETTINGS, t, method).get(items[0].pattern.id)!.are;
          };
          const beam = are('beam');
          expect(beam.sector.value).not.toBeNull();
          expect(are('horizon')).toEqual(beam);
        }
      }
    }
  });
});
