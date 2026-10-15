import { describe, expect, it } from 'vitest';
import { backHalfAtt, backHalfIntensity, backHalfModelOf, backWeight, mismatchWeight, poleWeight, reconstructBack3d } from './backHalf3d';
import { combine, reconstruct3d } from './pattern3d';
import { mod360, signed, type Grid } from './grid';
import { gridFrom, patternFrom } from '../../test/synthetic';
import { NO_TILT, reconstructTilted3d, tiltPattern } from './tilt';
import { gridsFor } from './metrics';

const METHODS = ['summation', 'weighted'] as const;
const CONE = 4;

/** Back of the vertical cut at elevation θ behind the antenna: a lobe pointing 15° up, 22 dB at its strongest. */
const backProfile = (theta: number): number => Math.min(40, 22 + 0.02 * (theta + 15) ** 2);

/** A vertical cut: a 10° beam peaking 4° below the horizon in front, `backProfile` behind (V angle 180° − θ). */
const vFn = (a: number): number => (Math.abs(a) <= 90 ? Math.min(35, 3 * ((a - CONE) / 5) ** 2) : backProfile(a > 0 ? 180 - a : -180 - a));

/** An azimuth cut with a 65° beam whose level behind the antenna is `back` (dB) at 180°. */
const hWithBack =
  (back: number) =>
  (a: number): number =>
    Math.abs(a) <= 150 ? Math.min(25, 3 * (a / 32.5) ** 2) : 25 + ((Math.abs(a) - 150) / 30) * (back - 25);

/** Cuts that agree where they cross behind the antenna: H(180°) = V(180° − θc). */
const consistent = { h: gridFrom(hWithBack(backProfile(CONE))), v: gridFrom(vFn) };
/** Cuts that do not: H(180°) is 4 dB below what the vertical cut says behind the antenna on the cone. */
const mismatched = { h: gridFrom(hWithBack(backProfile(CONE) + 4)), v: gridFrom(vFn) };

/** The surface on the 1° grid, read at (azimuth, elevation). */
const reader = (h: Grid, v: Grid, method: (typeof METHODS)[number]) => {
  const s = reconstructBack3d(h, v, method, 1);
  return (az: number, el: number): number => s.atten[el + 90][signed(az) + 180];
};

describe('backHalf3d model', () => {
  it('the cuts used are as designed: cone at 4°, consistent behind the antenna', () => {
    expect(consistent.v[CONE]).toBe(0);
    expect(consistent.h[180]).toBeCloseTo(consistent.v[180 - CONE], 12);
    expect(backHalfModelOf(consistent.h, consistent.v, 'summation').coneDeg).toBe(CONE);
  });

  for (const method of METHODS) {
    describe(method, () => {
      it('reproduces the azimuth cut on its cone at every azimuth, exactly', () => {
        for (const cuts of [consistent, mismatched]) {
          const at = reader(cuts.h, cuts.v, method);
          for (let a = 0; a < 360; a++) {
            // The existing model's own value there (exactly), which is the azimuth cut (weighted: to rounding).
            expect(at(a, CONE)).toBe(combine(cuts.h[a], 0, method));
            expect(at(a, CONE)).toBeCloseTo(cuts.h[a], 12);
          }
        }
      });

      it('reproduces the back half of the vertical cut at azimuth 180° (samples 91…269 and the poles)', () => {
        const at = reader(consistent.h, consistent.v, method);
        for (let e = -90; e <= 90; e++) {
          expect(at(180, e)).toBeCloseTo(consistent.v[mod360(180 - e)], 9);
          expect(at(-180, e)).toBe(at(180, e));
        }
      });

      it('reproduces the front half of the vertical cut at azimuth 0° (samples 270…359, 0…90)', () => {
        const at = reader(consistent.h, consistent.v, method);
        for (let e = -90; e <= 90; e++) expect(at(0, e)).toBeCloseTo(consistent.v[mod360(e)], 9);
      });

      it('when the cuts disagree behind the antenna, the back meridian is the back half moved to meet the azimuth cut within 10° of the cone, and the back half as measured beyond', () => {
        const { h, v } = mismatched;
        const at = reader(h, v, method);
        const m = backHalfModelOf(h, v, method);
        const shift = combine(h[180], 0, method) - v[180 - CONE];
        expect(m.mismatch).toBeCloseTo(shift, 12);
        expect(shift).toBeCloseTo(4, 9);
        for (let e = -90; e <= 90; e++) {
          const expected = v[mod360(180 - e)] + mismatchWeight(CONE, e) * shift;
          expect(at(180, e)).toBeCloseTo(Math.max(0, expected), 9);
          if (Math.abs(e - CONE) >= 10) expect(at(180, e)).toBeCloseTo(v[mod360(180 - e)], 9);
        }
        expect(at(180, 90)).toBeCloseTo(v[90], 9);
        expect(at(180, -90)).toBeCloseTo(v[270], 9);
      });

      it('is single-valued at the poles: every azimuth gives the vertical cut there', () => {
        for (const cuts of [consistent, mismatched]) {
          const at = reader(cuts.h, cuts.v, method);
          for (let a = 0; a < 360; a++) {
            expect(at(a, 90)).toBeCloseTo(cuts.v[90], 9);
            expect(at(a, -90)).toBeCloseTo(cuts.v[270], 9);
          }
        }
      });

      it('is the existing model on the whole front hemisphere of the cone and wherever both weights are 0', () => {
        const { h, v } = mismatched;
        const m = backHalfModelOf(h, v, method);
        for (let a = -90; a <= 90; a++) expect(backHalfAtt(m, a, CONE, h[mod360(a)], v[CONE], v[180 - CONE])).toBe(combine(h[mod360(a)], v[CONE], method));
      });

      it('peaks at 0 dB, is never negative, finite and continuous', () => {
        for (const cuts of [consistent, mismatched]) {
          const s = reconstructBack3d(cuts.h, cuts.v, method, 1);
          const all = s.atten.flat();
          expect(Math.min(...all)).toBe(0);
          expect(all.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
          // No step between neighbouring 1° directions larger than the two cuts' steepest steps together.
          const steepest = (g: Grid) => Math.max(...g.map((x, i) => Math.abs(g[(i + 1) % 360] - x)));
          const steep = steepest(cuts.h) + steepest(cuts.v);
          let largest = 0;
          for (let i = 0; i < s.el.length; i++)
            for (let j = 0; j < s.az.length - 1; j++) {
              largest = Math.max(largest, Math.abs(s.atten[i][j + 1] - s.atten[i][j]));
              if (i + 1 < s.el.length) largest = Math.max(largest, Math.abs(s.atten[i + 1][j] - s.atten[i][j]));
            }
          expect(largest).toBeLessThanOrEqual(steep + 1e-9);
        }
      });

      it('a level the cuts give as infinite does not make a value that is not a number', () => {
        const h = consistent.h.map((x, a) => (a === 120 ? Infinity : x));
        const v = consistent.v.map((x, a) => (a === 150 ? Infinity : x));
        const s = reconstructBack3d(h, v, method, 1);
        expect(s.atten.flat().some((x) => Number.isNaN(x))).toBe(false);
        expect(Array.from(backHalfIntensity(h, v, method)).some((x) => Number.isNaN(x))).toBe(false);
      });

      it('the sampled intensity of the angular-region estimate is the power of the same values (power table: within 2e-6)', () => {
        const { h, v } = mismatched;
        const s = reconstructBack3d(h, v, method, 1);
        const p = backHalfIntensity(h, v, method);
        for (let row = 0; row <= 180; row += 7)
          for (let a = 0; a < 360; a += 11) expect(p[row * 360 + a]).toBeCloseTo(10 ** (-s.atten[row][signed(a) + 180] / 10), 5);
      });

      it('the 3D view path: untilted it is this surface, tilted electrically it is the same model with the moved cut', () => {
        const { h, v } = consistent;
        expect(reconstructTilted3d(h, v, NO_TILT, 0, method, 3, true)).toEqual(reconstructBack3d(h, v, method));
        const tilted = reconstructTilted3d(h, v, { electricalDeg: 3, mechanicalDeg: 0 }, 0, method, 1, true);
        const row = (e: number) => tilted.atten[e + 90];
        // The cone moves down with the beam and still carries the azimuth cut; behind the antenna the back half moves down too.
        for (let a = -180; a <= 180; a += 5) expect(row(CONE + 3)[a + 180]).toBeCloseTo(h[mod360(a)], 9);
        for (let e = -80; e <= 80; e += 5) expect(row(e)[0]).toBeCloseTo(v[mod360(180 - e + 3)], 9);
      });
    });
  }

  it('weights: b is 0 in front (also exactly at ±90°) and 1 behind; q is 0 on the cone and 1 at the poles', () => {
    expect(backWeight(0)).toBe(0);
    expect(backWeight(90)).toBe(0);
    expect(backWeight(-90)).toBe(0);
    expect(backWeight(270)).toBe(0);
    expect(backWeight(180)).toBe(1);
    expect(backWeight(135)).toBeCloseTo(0.5, 12);
    expect(poleWeight(CONE, CONE)).toBe(0);
    expect(poleWeight(CONE, 90)).toBe(1);
    expect(poleWeight(CONE, -90)).toBe(1);
    expect(poleWeight(0, 60)).toBeCloseTo(1 - Math.cos((60 * Math.PI) / 180), 12);
    expect(poleWeight(90, 90)).toBe(1);
    expect(poleWeight(90, 80)).toBeGreaterThan(0);
    expect(mismatchWeight(CONE, CONE)).toBe(1);
    expect(mismatchWeight(CONE, CONE + 5)).toBeCloseTo(0.5, 12);
    expect(mismatchWeight(CONE, CONE - 10)).toBe(0);
    expect(mismatchWeight(CONE, 90)).toBe(0);
  });

  it('the existing reconstruction is unchanged by it', () => {
    const { h, v } = mismatched;
    expect(reconstructTilted3d(h, v, NO_TILT, 0, 'summation')).toEqual(reconstruct3d(h, v, 'summation'));
  });
});

describe('a deep narrow null straight behind the antenna', () => {
  // Both cuts 25 dB behind the antenna with a 6° wide null at 180° (behind the antenna on the cone), so they agree
  // where they cross. In dB the back correction transferred the null's depth to the whole back: up to a second
  // 0 dB direction behind the antenna.
  const cutsWithNull = (depth: number) => {
    const behind = (x: number) => (Math.abs(x) <= 3 ? depth : 25);
    const h = gridFrom((a) => (Math.abs(a) <= 90 ? Math.min(25, 3 * (a / 32.5) ** 2) : behind(180 - Math.abs(a))));
    const v = gridFrom((a) => (Math.abs(a) <= 90 ? Math.min(25, 3 * (a / 5) ** 2) : behind(180 - Math.abs(a))));
    return { h, v };
  };
  const strongestBehind = (h: Grid, v: Grid): number => Math.min(...h.slice(91, 270), ...v.slice(91, 270));

  for (const depth of [35, 45, 60])
    for (const method of METHODS)
      it(`${method}, ${depth} dB: no direction behind the antenna more than 3 dB stronger than either cut measured there`, () => {
        const { h, v } = cutsWithNull(depth);
        expect(h[180]).toBe(depth);
        expect(v[180]).toBe(depth);
        const limit = strongestBehind(h, v) - 3;
        const s = reconstructBack3d(h, v, method, 1);
        let strongest = Infinity;
        s.az.forEach((a, j) => {
          if (Math.abs(a) > 90) for (let i = 0; i < s.el.length; i++) strongest = Math.min(strongest, s.atten[i][j]);
        });
        expect(strongest).toBeGreaterThan(limit);
        // The angular-region estimate's sampled intensity, and the cuts the tilt simulation reads.
        const p = backHalfIntensity(h, v, method);
        for (let row = 0; row <= 180; row++)
          for (let a = 91; a <= 269; a++) expect(-10 * Math.log10(p[row * 360 + a])).toBeGreaterThan(limit);
        const pattern = patternFrom((a) => h[mod360(a)], (a) => v[mod360(a)]);
        for (const t of [NO_TILT, { electricalDeg: 0, mechanicalDeg: 6 }])
          for (const hCut of ['beam', 'horizon'] as const) {
            if (t === NO_TILT && hCut === 'beam') continue;
            const cut = tiltPattern(pattern, t, method, hCut, true).horizontal.atten;
            expect(Math.min(...cut.slice(91, 270))).toBeGreaterThan(limit);
          }
      });
});

describe('tilt simulation with the back of the vertical cut', () => {
  const p = patternFrom(hWithBack(backProfile(CONE)), vFn);

  for (const method of METHODS) {
    it(`${method}: electrical tilt alone leaves the cut through the beam peak the file's own`, () => {
      const t = tiltPattern(p, { electricalDeg: 3, mechanicalDeg: 0 }, method, 'beam', true);
      t.horizontal.atten.forEach((x, a) => expect(x).toBeCloseTo(gridsFor(p).h[a], 9));
    });

    it(`${method}: under mechanical tilt the back of the beam-peak cut is read from the back half of the vertical cut`, () => {
      const m = 6;
      const t = tiltPattern(p, { electricalDeg: 0, mechanicalDeg: m }, method, 'beam', true);
      // Straight behind, the ground cone at θc + m is the antenna's elevation θc + 2m in the plane of the vertical cut.
      expect(t.horizontal.atten[180]).toBeCloseTo(vFn(180 - (CONE + 2 * m)), 6);
      const old = tiltPattern(p, { electricalDeg: 0, mechanicalDeg: m }, method, 'beam');
      expect(old.horizontal.atten[0]).toBeCloseTo(t.horizontal.atten[0], 9);
    });

    it(`${method}: a horizon cut with no tilt reads the back half at the horizon`, () => {
      const t = tiltPattern(p, NO_TILT, method, 'horizon', true);
      expect(t.horizontal.atten[180]).toBeCloseTo(vFn(180), 6);
      expect(t.vertical).toBe(p.vertical);
    });

    it(`${method}: copies are cached per setting, and the setting is part of the key`, () => {
      const t = { electricalDeg: 1, mechanicalDeg: 2 };
      const on = tiltPattern(p, t, method, 'beam', true);
      expect(tiltPattern(p, t, method, 'beam', true)).toBe(on);
      const off = tiltPattern(p, t, method, 'beam');
      expect(off).not.toBe(on);
      expect(off.horizontal.atten).not.toEqual(on.horizontal.atten);
    });
  }
});
