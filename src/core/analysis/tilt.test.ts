import { describe, expect, it } from 'vitest';
import {
  analyzeTilted,
  anyTilted,
  baseGrids,
  beamPeakElevation,
  combineOffsets,
  coneInAntenna,
  DECLARED_REASON,
  effectiveFor,
  electricalShift,
  interp,
  isTilted,
  NO_SIM,
  NO_TILT,
  reconstructTilted3d,
  rotateToAntenna,
  shiftCircle,
  tiltEach,
  tiltPattern,
  tiltTagged,
} from './tilt';
import { analyzePattern, DEFAULT_SETTINGS, findTrackingPartner } from './metrics';
import { nameOf } from '../names';
import { mod360, rawGrid, signed, toGrid } from './grid';
import { combine, reconstruct3d, type Method3d } from './pattern3d';
import { cutFrom, gridFrom, patternFrom, quadBeam, vBeamWithLobes } from '../../test/synthetic';

const deg = Array.from({ length: 360 }, (_, i) => i);
const p = patternFrom(quadBeam(65), vBeamWithLobes);
const METHODS: Method3d[] = ['summation', 'weighted'];

describe('rawGrid', () => {
  it('keeps offsets that toGrid removes', () => {
    const cut = cutFrom((a) => 2 + Math.abs(a));
    expect(rawGrid(cut)[0]).toBe(2);
    expect(toGrid(cut)[0]).toBe(0);
  });
});

describe('interp and shiftCircle', () => {
  const g = deg.map((a) => a);

  it('interpolates and wraps', () => {
    expect(interp(g, 10.5)).toBeCloseTo(10.5, 9);
    expect(interp(g, -1)).toBe(359);
    expect(interp(g, 359.5)).toBeCloseTo(179.5, 9);
    expect(Number.isNaN(interp(g, 720.25))).toBe(false);
  });

  it('shifts a circle by whole and half degrees', () => {
    const s = shiftCircle(g, 5);
    expect(s[10]).toBe(5);
    expect(s[2]).toBe(357);
    expect(shiftCircle(g, 0.5)[10]).toBeCloseTo(9.5, 9);
  });
});

describe('rotateToAntenna', () => {
  it('maps the check directions from the spec', () => {
    const m = 6;
    const down = rotateToAntenna(0, m, m);
    expect(down.phi).toBeCloseTo(0, 9);
    expect(down.theta).toBeCloseTo(0, 9);
    const horizon = rotateToAntenna(0, 0, m);
    expect(horizon.phi).toBeCloseTo(0, 9);
    expect(horizon.theta).toBeCloseTo(-m, 9);
    const back = rotateToAntenna(180, 0, m);
    expect(Math.abs(back.phi)).toBeCloseTo(180, 9);
    expect(back.theta).toBeCloseTo(m, 9);
    const side = rotateToAntenna(90, 0, m);
    expect(side.phi).toBeCloseTo(90, 9);
    expect(side.theta).toBeCloseTo(0, 9);
  });

  it('is the identity without mechanical tilt', () => {
    expect(rotateToAntenna(37, -12, 0)).toEqual({ phi: 37, theta: -12 });
  });
});

describe('tiltPattern', () => {
  it('returns the same pattern object at zero tilt', () => {
    expect(isTilted(NO_TILT)).toBe(false);
    expect(tiltPattern(p, NO_TILT, 'summation')).toBe(p);
  });

  it('rotates the V cut exactly by the mechanical tilt (front down, back up)', () => {
    const raw = rawGrid(p.vertical);
    const t = tiltPattern(p, { electricalDeg: 0, mechanicalDeg: 4 }, 'summation');
    expect(t.vertical.angles).toEqual(deg);
    expect(t.vertical.atten).toEqual(deg.map((a) => raw[mod360(a - 4)]));
  });

  it('interpolates half-degree tilts', () => {
    const raw = rawGrid(p.vertical);
    const t = tiltPattern(p, { electricalDeg: 0, mechanicalDeg: 0.5 }, 'summation');
    expect(t.vertical.atten[10]).toBeCloseTo((raw[9] + raw[10]) / 2, 9);
  });

  it('moves the front and back halves of the V cut down by the electrical tilt (cone model)', () => {
    const raw = rawGrid(p.vertical);
    const t = tiltPattern(p, { electricalDeg: 3, mechanicalDeg: 0 }, 'weighted');
    const front = deg.filter((a) => a <= 90 || a >= 270);
    const back = deg.filter((a) => a >= 91 && a <= 269);
    expect(front.map((a) => t.vertical.atten[a])).toEqual(front.map((a) => raw[mod360(a - 3)]));
    expect(back.map((a) => t.vertical.atten[a])).toEqual(back.map((a) => raw[mod360(a + 3)]));
  });

  it('moves the back lobe down (towards 90°) under electrical tilt', () => {
    // Front beam at 0°, back lobe peak (minimum attenuation) at 175°.
    const withBackLobe = patternFrom(quadBeam(10), (a) =>
      Math.min(quadBeam(10)(a), 10 + 0.5 * Math.abs(signed(a - 175))),
    );
    const backPeak = (g: number[]) =>
      deg.filter((a) => a >= 91 && a <= 269).reduce((best, a) => (g[a] < g[best] ? a : best), 91);
    expect(backPeak(rawGrid(withBackLobe.vertical))).toBe(175);
    const t = tiltPattern(withBackLobe, { electricalDeg: 6, mechanicalDeg: 0 }, 'summation');
    expect(backPeak(t.vertical.atten)).toBe(169);
  });

  it('reads the H cut on the cone through the tilted beam peak', () => {
    // Ground direction (φ, θpeak + Δe + m) → antenna frame → H at φa, V at θa − Δe (cone model).
    const e = 2.5;
    const m = 4;
    const hN = toGrid(p.horizontal);
    const vN = toGrid(p.vertical);
    const hOff = Math.min(...rawGrid(p.horizontal));
    for (const method of METHODS) {
      const t = tiltPattern(p, { electricalDeg: e, mechanicalDeg: m }, method);
      expect(t.horizontal.angles).toEqual(deg);
      for (const phi of [0, 30, 90, 135, 180, 270, 333]) {
        const a = rotateToAntenna(phi, 6 + e + m, m);
        const want = hOff + combine(interp(hN, a.phi), interp(vN, a.theta - e), method);
        expect(t.horizontal.atten[phi]).toBeCloseTo(want, 9);
      }
    }
  });

  it('keeps boresight at the file level under any tilt (the cone passes through the beam peak)', () => {
    const raw = rawGrid(p.horizontal);
    for (const method of METHODS) {
      for (const m of [-10, -2.5, 0.5, 4, 15]) {
        const t = tiltPattern(p, { electricalDeg: 1.5, mechanicalDeg: m }, method);
        expect(t.horizontal.atten[0]).toBeCloseTo(raw[0], 9);
      }
    }
  });

  it('keeps the other pattern fields', () => {
    const t = tiltPattern({ ...p, name: 'X', frequencyMHz: 900 }, { electricalDeg: 2, mechanicalDeg: 0 }, 'summation');
    expect(t.name).toBe('X');
    expect(t.frequencyMHz).toBe(900);
  });
});

describe('beam-following H cut: invariants', () => {
  const maxAbsDiff = (a: number[], b: number[]) => a.reduce((d, v, i) => Math.max(d, Math.abs(v - b[i])), 0);
  const hpbwOf = (q: typeof p) => analyzePattern({ pattern: q, tags: { tiltDeg: 6 } }).h.hpbw.value!;
  const fbOf = (q: typeof p) => analyzePattern({ pattern: q, tags: { tiltDeg: 6 } }).fb180.value!;
  // `halfDeg`: bound on the HPBW change at m = 0.5°. vBeamWithLobes has a cusp at its peak
  // (0.75 dB/° from the very first fraction of a degree), so the cone, which at the half-power
  // azimuths lies m·(1 − cos φ) ≈ 0.08° off the antenna-frame peak cone, already loses 0.06 dB
  // there and the HPBW moves 0.57° (summation). A rounded V peak on the 1° grid moves it 0.1–0.23°.
  const cases = [
    { name: 'V peak at 6° with sidelobes', pat: p, halfDeg: 0.6 },
    // 8° beam peaking 12° below the horizon: the old horizon model drew this up to +27 dB above the peak.
    { name: 'V peak far off the horizon (12°)', pat: patternFrom(quadBeam(65), quadBeam(8, 12, 30)), halfDeg: 0.5 },
    { name: 'file with an H offset', pat: patternFrom((a) => 0.25 + quadBeam(65)(a), quadBeam(8, 6, 30)), halfDeg: 0.5 },
  ];

  for (const { name, pat, halfDeg } of cases) {
    for (const method of METHODS) {
      describe(`${name}, ${method}`, () => {
        const raw = rawGrid(pat.horizontal);
        const hOff = Math.min(...raw);

        it('returns the file H cut at zero tilt', () => {
          expect(maxAbsDiff(rawGrid(tiltPattern(pat, NO_TILT, method).horizontal), raw)).toBeLessThan(1e-9);
          // Also through the formula (a vanishing tilt does not take the early-return path).
          const t = tiltPattern(pat, { electricalDeg: 1e-12, mechanicalDeg: 0 }, method);
          expect(maxAbsDiff(t.horizontal.atten, raw)).toBeLessThan(1e-9);
        });

        it('returns the file H cut under pure electrical tilt', () => {
          const hpbw0 = hpbwOf(pat);
          for (let e = -10; e <= 15; e += 0.5) {
            if (e === 0) continue;
            const t = tiltPattern(pat, { electricalDeg: e, mechanicalDeg: 0 }, method);
            expect(maxAbsDiff(t.horizontal.atten, raw)).toBeLessThan(0.05);
            expect(Math.abs(hpbwOf(t) - hpbw0)).toBeLessThan(0.05);
          }
        });

        it('never rises above the file peak', () => {
          for (let e = -10; e <= 15; e += 2.5) {
            for (let m = -10; m <= 15; m += 2.5) {
              const t = tiltPattern(pat, { electricalDeg: e, mechanicalDeg: m }, method);
              expect(Math.min(...t.horizontal.atten)).toBeGreaterThanOrEqual(hOff - 1e-9);
            }
          }
        });

        it('changes continuously with mechanical tilt', () => {
          const hpbw0 = hpbwOf(pat);
          const tiny = tiltPattern(pat, { electricalDeg: 0, mechanicalDeg: 0.01 }, method);
          expect(maxAbsDiff(tiny.horizontal.atten, raw)).toBeLessThan(0.02);
          expect(Math.abs(hpbwOf(tiny) - hpbw0)).toBeLessThan(0.02);
          const half = tiltPattern(pat, { electricalDeg: 0, mechanicalDeg: 0.5 }, method);
          expect(Math.abs(hpbwOf(half) - hpbw0)).toBeLessThan(halfDeg);
        });
      });
    }
  }

  it('pins the mechanical-tilt distortion of the synthetic 65° × 8° pattern', () => {
    const at = (m: number, method: Method3d) => {
      const t = tiltPattern(p, { electricalDeg: 0, mechanicalDeg: m }, method);
      return [hpbwOf(t), fbOf(t)];
    };
    expect(hpbwOf(p)).toBeCloseTo(64.99, 2);
    expect(fbOf(p)).toBeCloseTo(40, 2);
    const pins: [number, Method3d, number, number][] = [
      [4, 'summation', 60.96, 52],
      [-10, 'summation', 55.01, 65],
      [4, 'weighted', 68.59, 39.96],
      [-10, 'weighted', 70.07, 39.54],
    ];
    for (const [m, method, hpbw, fb] of pins) {
      const [gotHpbw, gotFb] = at(m, method);
      expect(gotHpbw).toBeCloseTo(hpbw, 2);
      expect(gotFb).toBeCloseTo(fb, 2);
    }
  });
});

describe('beamPeakElevation', () => {
  it('is the strongest sample, or the centre of a flat top', () => {
    expect(beamPeakElevation(toGrid(p.vertical))).toBe(6);
    expect(beamPeakElevation(gridFrom(quadBeam(8, -3)))).toBe(-3);
    // Peak half-way between two samples: both are 0 dB after normalisation.
    expect(beamPeakElevation(gridFrom(quadBeam(8, 5.5)))).toBe(5.5);
  });

  it('stays on a sample where the reconstruction is 0 dB when the true peak is between samples', () => {
    const vN = gridFrom(quadBeam(4, 5.25));
    const peak = beamPeakElevation(vN);
    expect(peak).toBe(5);
    expect(interp(vN, peak)).toBe(0);
  });
});

describe('tiltTagged', () => {
  const items = [{ pattern: p, tags: { tiltDeg: 6 } }];

  it('returns the same array without tilt and keeps tags otherwise', () => {
    expect(tiltTagged(items, NO_TILT, 'summation')).toBe(items);
    const t = tiltTagged(items, { electricalDeg: 1, mechanicalDeg: 0 }, 'summation');
    expect(t[0].tags).toBe(items[0].tags);
    expect(t[0].pattern).not.toBe(p);
  });
});

describe('caching (drag performance with many files)', () => {
  const many = Array.from({ length: 234 }, (_, i) => ({
    pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: String(i) }),
    tags: { tiltDeg: 6 },
  }));

  it('tilts 234 patterns and reuses each pattern\'s cached grids on the next tilt value', () => {
    const first = tiltTagged(many, { electricalDeg: 0, mechanicalDeg: 6 }, 'summation');
    expect(first).toHaveLength(234);
    const cached = many.map((i) => baseGrids(i.pattern));
    const second = tiltTagged(many, { electricalDeg: 0, mechanicalDeg: 7 }, 'summation');
    expect(second).toHaveLength(234);
    many.forEach((i, k) => {
      const g = baseGrids(i.pattern);
      expect(g).toBe(cached[k]);
      expect(g.H).toBe(cached[k].H);
      expect(g.V).toBe(cached[k].V);
    });
    // The cache returns what the uncached code computes.
    expect(cached[0].V).toEqual(rawGrid(many[0].pattern.vertical));
    expect(cached[0].vN).toEqual(toGrid(many[0].pattern.vertical));
  });

  it('computes the cone rotation once per peak elevation and mechanical tilt value', () => {
    const a = coneInAntenna(12, 6);
    expect(coneInAntenna(12, 6)).toBe(a);
    expect(a[0].phi).toBeCloseTo(0, 9);
    expect(a[0].theta).toBeCloseTo(6, 9);
    expect(coneInAntenna(13, 6)).not.toBe(a);
    expect(coneInAntenna(12, 6)).toBe(a);
    expect(coneInAntenna(12, 7)).not.toBe(a);
  });

  it('caches the H offset and the beam-peak elevation with the grids', () => {
    const g = baseGrids(patternFrom((a) => 0.3 + quadBeam(65)(a), vBeamWithLobes));
    expect(g.hOff).toBeCloseTo(0.3, 9);
    expect(g.peakTheta).toBe(6);
  });
});

describe('electricalShift', () => {
  it('is the identity at zero', () => {
    const g = deg.map((a) => a * 0.1);
    expect(electricalShift(g, 0)).toEqual(g);
  });
});

describe('reconstructTilted3d', () => {
  const h = gridFrom(quadBeam(65));
  const v = gridFrom(quadBeam(10));
  const base = reconstruct3d(h, v, 'summation');
  const row = (el: number) => base.el.indexOf(el);
  const col = (az: number) => base.az.indexOf(az);

  it('equals the Layer 1 reconstruction with everything at zero', () => {
    expect(reconstructTilted3d(h, v, NO_TILT, 0, 'summation')).toEqual(base);
  });

  it('moves boresight to the azimuth', () => {
    const s = reconstructTilted3d(h, v, NO_TILT, 30, 'summation');
    expect(s.atten[row(0)][col(30)]).toBeCloseTo(base.atten[row(0)][col(0)], 9);
  });

  it('points the beam down by the mechanical tilt', () => {
    const s = reconstructTilted3d(h, v, { electricalDeg: 0, mechanicalDeg: 6 }, 0, 'summation');
    expect(s.atten[row(6)][col(0)]).toBeCloseTo(base.atten[row(0)][col(0)], 9);
  });
});

describe('analyzeTilted', () => {
  const items = [
    {
      pattern: patternFrom(quadBeam(65), vBeamWithLobes, { declared: { vBeamwidth: 8 } }),
      tags: { tiltDeg: 6 },
    },
  ];
  const run = (t: { electricalDeg: number; mechanicalDeg: number }) =>
    analyzeTilted(tiltTagged(items, t, 'summation'), DEFAULT_SETTINGS, t).get('syn')!;

  it('reads the tilt as original + Δe and keeps the tilt error at 0', () => {
    const m = run({ electricalDeg: 4, mechanicalDeg: 0 });
    expect(m.tilt.value).toBeCloseTo(10, 5);
    expect(m.tiltError.value).toBeCloseTo(0, 5);
  });

  it('adds electrical and mechanical tilt', () => {
    const m = run({ electricalDeg: 2, mechanicalDeg: 2 });
    expect(m.tilt.value).toBeCloseTo(10, 5);
    expect(m.tiltError.value).toBeCloseTo(0, 5);
  });

  it('nulls Δ-declared cells with a fixed reason', () => {
    const m = run({ electricalDeg: 4, mechanicalDeg: 0 });
    expect(m.delta.vHpbw).toEqual({ value: null, reason: DECLARED_REASON });
    expect(DECLARED_REASON).toBe('Declared values describe the measured pattern');
  });

  it('computes every H-cut metric at any tilt (no horizon guard)', () => {
    // V peak at +6°, HPBW 8°: 8° of mechanical downtilt puts the horizon far outside the main beam.
    const m = run({ electricalDeg: 0, mechanicalDeg: 8 });
    for (const r of [m.h.hpbw, m.h.direction, m.squint, m.fb180, m.fbWindow, m.rollOff, m.spr]) {
      expect(typeof r.value).toBe('number');
    }
    expect(m.h.edges).not.toBeNull();
    expect(m.v.hpbw.value).toBeCloseTo(8, 5);
    expect(m.tilt.value).toBeCloseTo(14, 5);
  });

  it('never throws across the full slider range', () => {
    for (let e = -10; e <= 15; e += 2.5) {
      for (let mech = -10; mech <= 15; mech += 2.5) {
        const m = run({ electricalDeg: e, mechanicalDeg: mech });
        for (const r of [m.h.hpbw, m.v.hpbw, m.tilt, m.usls, m.nullFill, m.fb180]) {
          if (r.value === null) expect(r.reason).toBeTruthy();
          else expect(Number.isFinite(r.value)).toBe(true);
        }
      }
    }
  });
});

describe('per-file settings', () => {
  const a = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a' }), tags: { tiltDeg: 6 } };
  const b = { pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b' }), tags: { tiltDeg: 6 } };
  const items = [a, b];

  it('adds offsets to the global settings', () => {
    const global = { electricalDeg: 1, mechanicalDeg: 2, azimuthDeg: 10 };
    expect(effectiveFor(global, { electricalDeg: 0.5, mechanicalDeg: -2, azimuthDeg: 20 })).toEqual({
      electricalDeg: 1.5,
      mechanicalDeg: 0,
      azimuthDeg: 30,
    });
    expect(effectiveFor(global)).toBe(global);
    expect(effectiveFor(NO_SIM)).toBe(NO_SIM);
  });

  it('treats a cancelling offset as untilted', () => {
    const e = effectiveFor({ electricalDeg: 0, mechanicalDeg: 3, azimuthDeg: 0 }, { electricalDeg: 0, mechanicalDeg: -3, azimuthDeg: 0 });
    expect(isTilted(e)).toBe(false);
  });

  describe('anyTilted (M1: one definition of "tilted")', () => {
    it('ignores a cancelling global + offset combination, but still catches a plain global tilt', () => {
      const global = { electricalDeg: 3, mechanicalDeg: 0, azimuthDeg: 0 };
      const offsets = { a: { electricalDeg: -3, mechanicalDeg: 0, azimuthDeg: 0 } };
      expect(anyTilted(['a'], global, offsets)).toBe(false);
      // 'b' has no offset of its own, so it still carries the global +3° electrical tilt.
      expect(anyTilted(['a', 'b'], global, offsets)).toBe(true);
      expect(anyTilted([], global, offsets)).toBe(false);
      expect(anyTilted(['a'], NO_SIM, {})).toBe(false);
    });
  });

  it('tilts only the items that have a tilt and keeps the others', () => {
    const t = tiltEach(items, (id) => (id === 'b' ? { electricalDeg: 0, mechanicalDeg: 4 } : NO_TILT), 'summation');
    expect(t[0]).toBe(a);
    expect(t[1].pattern).not.toBe(b.pattern);
    expect(t[1].tags).toBe(b.tags);
    expect(tiltEach(items, () => NO_TILT, 'summation')).toBe(items);
  });

  it('re-tilts only the changed item', () => {
    const first = tiltEach(items, (id) => ({ electricalDeg: 0, mechanicalDeg: id === 'a' ? 2 : 3 }), 'summation');
    const again = tiltEach(items, (id) => ({ electricalDeg: 0, mechanicalDeg: id === 'a' ? 2 : 3 }), 'summation');
    expect(again[0].pattern).toBe(first[0].pattern);
    expect(again[1].pattern).toBe(first[1].pattern);
    const changed = tiltEach(items, (id) => ({ electricalDeg: 0, mechanicalDeg: id === 'a' ? 2 : 5 }), 'summation');
    expect(changed[0].pattern).toBe(first[0].pattern);
    expect(changed[1].pattern).not.toBe(first[1].pattern);
  });

  it('analyses each item with its own nominal offset', () => {
    const tiltFor = (id: string) => (id === 'a' ? { electricalDeg: 4, mechanicalDeg: 0 } : NO_TILT);
    const m = analyzeTilted(tiltEach(items, tiltFor, 'summation'), DEFAULT_SETTINGS, tiltFor);
    expect(m.get('a')!.tilt.value).toBeCloseTo(10, 5);
    expect(m.get('a')!.tiltError.value).toBeCloseTo(0, 5);
    expect(m.get('b')!.tilt.value).toBeCloseTo(6, 5);
    expect(m.get('b')!.tiltError.value).toBeCloseTo(0, 5);
  });

  it('nulls Δ-declared cells only for the tilted file in a mixed batch (M8)', () => {
    const a2 = {
      pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a2', declared: { vBeamwidth: 8 } }),
      tags: { tiltDeg: 6 },
    };
    const b2 = {
      pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b2', declared: { vBeamwidth: 8 } }),
      tags: { tiltDeg: 6 },
    };
    const tiltFor = (id: string) => (id === 'a2' ? { electricalDeg: 4, mechanicalDeg: 0 } : NO_TILT);
    const m = analyzeTilted(tiltEach([a2, b2], tiltFor, 'summation'), DEFAULT_SETTINGS, tiltFor);
    expect(m.get('a2')!.delta.vHpbw).toEqual({ value: null, reason: DECLARED_REASON });
    expect(m.get('b2')!.delta.vHpbw.value).toBeCloseTo(0, 5);
  });

  it('keeps H metrics numeric for the tilted and the untilted file of a mixed batch', () => {
    const tiltFor = (id: string) => (id === 'a' ? { electricalDeg: 0, mechanicalDeg: 8 } : NO_TILT);
    const m = analyzeTilted(tiltEach(items, tiltFor, 'summation'), DEFAULT_SETTINGS, tiltFor);
    for (const id of ['a', 'b']) {
      expect(typeof m.get(id)!.h.hpbw.value).toBe('number');
      expect(typeof m.get(id)!.squint.value).toBe('number');
      expect(typeof m.get(id)!.fb180.value).toBe('number');
    }
  });
});

describe('pattern management core', () => {
  it('names a pattern by its display name or file name', () => {
    const p = patternFrom(quadBeam(65), vBeamWithLobes, { fileName: 'a.MSI' });
    expect(nameOf(p)).toBe('a.MSI');
    expect(nameOf({ ...p, displayName: 'North' })).toBe('North');
  });

  it('adds group offsets to member files and omits zero totals', () => {
    const z = { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 };
    const out = combineOffsets(
      ['a', 'b', 'c', 'd'],
      { a: { ...z, azimuthDeg: -30 }, c: { ...z, mechanicalDeg: 2 } },
      { g: { ...z, azimuthDeg: 30 }, h: { ...z, electricalDeg: 1 } },
      { a: 'g', b: 'g', d: 'x' },
    );
    expect(out).toEqual({ b: { ...z, azimuthDeg: 30 }, c: { ...z, mechanicalDeg: 2 } });
  });

  it('pairs tracking partners only within the same scope', () => {
    const mk = (id: string, pol: string, scope?: string) => ({
      pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id }),
      tags: { polarization: pol, tiltDeg: 6 },
      ...(scope ? { scope } : {}),
    });
    const p = mk('p', '+45', 'g1');
    const m1 = mk('m1', '-45', 'g1');
    const m2 = mk('m2', '-45');
    expect(findTrackingPartner(p, [p, m1, m2])).toEqual({ partner: m1 });
    expect(findTrackingPartner(m2, [p, m1, m2])).toEqual({ reason: 'No opposite-polarization partner loaded' });
  });

  it('keeps the scope when tilting', () => {
    const item = { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 's' }), tags: { tiltDeg: 6 }, scope: 'g1' };
    const [t] = tiltEach([item], () => ({ electricalDeg: 0, mechanicalDeg: 3 }), 'summation');
    expect(t.scope).toBe('g1');
    expect(t.pattern).not.toBe(item.pattern);
  });
});
