import { describe, expect, it } from 'vitest';
import { combine, type Method3d } from './pattern3d';
import { backHalfAtt, backHalfModelOf } from './backHalf3d';
import { toGrid, type Grid } from './grid';
import { NO_TILT, rotateToAntenna, tiltPattern } from './tilt';
import { patternFrom } from '../../test/synthetic';

/**
 * Validation against a known 3D pattern. The truth is an analytic panel-like antenna, front and back different: a
 * vertical array of 8 elements (0.7 λ apart, beam steered `tiltDeg` down) times a cardioid element and a horizontal
 * element factor, plus a back lobe from a short array of its own pointing `backDeg` up (negative = down). Its two cuts
 * are sampled as a file gives them (the azimuth cut on the cone of the beam peak, the vertical cut over the full
 * circle), both reconstructions are built from them, and each is compared with the truth on the 1° sphere.
 */

const RAD = Math.PI / 180;
type Truth = (phiDeg: number, thetaDeg: number) => number;

const arrayFactor = (n: number, spacing: number, z: number, z0: number): number => {
  const psi = 2 * Math.PI * spacing * (z - z0);
  const s = Math.sin(psi / 2);
  return Math.abs(s) < 1e-12 ? 1 : (Math.sin((n * psi) / 2) / (n * s)) ** 2;
};

function panel(tiltDeg: number, backDeg: number, backDb: number, backElements: number): Truth {
  return (phi, theta) => {
    const x = Math.cos(theta * RAD) * Math.cos(phi * RAD);
    const y = Math.cos(theta * RAD) * Math.sin(phi * RAD);
    const z = -Math.sin(theta * RAD);
    const front = ((1 + x) / 2) ** 2 * arrayFactor(8, 0.7, z, -Math.sin(tiltDeg * RAD)) * (0.02 + 0.98 * (1 - y * y) ** 1.5);
    const back = 10 ** (-backDb / 10) * ((1 - x) / 2) ** 2 * arrayFactor(backElements, 0.5, z, Math.sin(backDeg * RAD));
    return front + back;
  };
}

const TRUTHS: [string, Truth][] = [
  ['no tilt, back lobe 15° up', panel(0, 15, 25, 3)],
  ['6° tilt, back lobe 15° up', panel(6, 15, 25, 3)],
  ['4° tilt, back lobe 20° down', panel(4, -20, 22, 4)],
];

const db = (lin: number): number => -10 * Math.log10(lin);
const grid = (raw: number[]): Grid => toGrid({ angles: raw.map((_, i) => i), atten: raw });

/** The truth's two cuts as a file gives them, and the elevation of its beam peak. */
function cutsOf(truth: Truth): { h: Grid; v: Grid; peak: number } {
  const v = Array.from({ length: 360 }, (_, t) => (t <= 90 ? db(truth(0, t)) : t >= 270 ? db(truth(0, t - 360)) : db(truth(180, 180 - t))));
  let peak = 0;
  for (let e = -90; e <= 90; e++) if (v[(e + 360) % 360] < v[(peak + 360) % 360]) peak = e;
  const h = Array.from({ length: 360 }, (_, a) => db(truth(a > 180 ? a - 360 : a, peak)));
  return { h: grid(h), v: grid(v), peak };
}

const FLOOR = 40;

/** RMS dB error of both reconstructions against the truth (both clipped at 40 dB, weighted by cos elevation), front and back hemispheres. */
function errors(truth: Truth, method: Method3d) {
  const { h, v } = cutsOf(truth);
  let max = 0;
  for (let e = -90; e <= 90; e++) for (let a = -179; a <= 180; a++) max = Math.max(max, truth(a, e));
  const m = backHalfModelOf(h, v, method);
  const sum = { front: { old: 0, now: 0, w: 0 }, back: { old: 0, now: 0, w: 0 } };
  let poleSpread = 0;
  for (let e = -90; e <= 90; e++) {
    const w = Math.max(Math.cos(e * RAD), 1e-3);
    const atPole: number[] = [];
    for (let a = -179; a <= 180; a++) {
      const truthDb = Math.min(FLOOR, db(truth(a, e) / max));
      const aH = h[(a + 360) % 360];
      const aF = v[(e + 360) % 360];
      const old = combine(aH, aF, method);
      const now = backHalfAtt(m, a, e, aH, aF, v[(180 - e + 360) % 360]);
      if (Math.abs(e) === 90) atPole.push(now);
      const side = Math.abs(a) < 90 ? sum.front : Math.abs(a) > 90 ? sum.back : null;
      if (!side) continue;
      side.old += w * (Math.min(FLOOR, old) - truthDb) ** 2;
      side.now += w * (Math.min(FLOOR, now) - truthDb) ** 2;
      side.w += w;
    }
    if (atPole.length) poleSpread = Math.max(poleSpread, Math.max(...atPole) - Math.min(...atPole));
  }
  const rms = (x: number, w: number) => Math.sqrt(x / w);
  return {
    front: { old: rms(sum.front.old, sum.front.w), now: rms(sum.front.now, sum.front.w) },
    back: { old: rms(sum.back.old, sum.back.w), now: rms(sum.back.now, sum.back.w) },
    poleSpread,
  };
}

describe('validation against a known 3D pattern', () => {
  for (const [name, truth] of TRUTHS) {
    it(`${name}: closer to the truth behind the antenna, not further in front, single-valued at the poles`, () => {
      const sum = errors(truth, 'summation');
      const wtd = errors(truth, 'weighted');
      // Measured (dB RMS, back old → new): summation 8.4 → 3.3, 8.6 → 3.4, 8.8 → 3.7; weighted 8.1 → 5.5, 7.5 → 5.7, 8.4 → 5.6.
      expect(sum.back.now).toBeLessThan(0.5 * sum.back.old);
      expect(wtd.back.now).toBeLessThan(0.8 * wtd.back.old);
      // Front (old → new): summation 4.6 → 2.5 (the pole term), weighted 5.3 → 5.3.
      expect(sum.front.now).toBeLessThan(sum.front.old + 0.1);
      expect(wtd.front.now).toBeLessThan(wtd.front.old + 0.1);
      expect(sum.poleSpread).toBeLessThan(1e-9);
      expect(wtd.poleSpread).toBeLessThan(1e-9);
    });

    it(`${name}: F/B under mechanical tilt follows the truth`, () => {
      const { h, v, peak } = cutsOf(truth);
      const p = patternFrom((a) => h[(a + 360) % 360], (a) => v[(a + 360) % 360]);
      for (const mech of [4, 10]) {
        const truthDb = (phi: number, theta: number) => {
          const r = rotateToAntenna(phi, theta, mech);
          return db(truth(r.phi, r.theta));
        };
        const cone = peak + mech;
        const trueFb = truthDb(180, cone) - truthDb(0, cone);
        for (const method of ['summation', 'weighted'] as const) {
          const fb = (backHalf: boolean) => {
            const cut = tiltPattern(p, { electricalDeg: 0, mechanicalDeg: mech }, method, 'beam', backHalf).horizontal.atten;
            return cut[180] - Math.min(...cut);
          };
          expect(Math.abs(fb(true) - trueFb)).toBeLessThan(0.2);
          expect(Math.abs(fb(true) - trueFb)).toBeLessThan(Math.abs(fb(false) - trueFb));
        }
      }
      // With no tilt, a horizon cut reads the back of the vertical cut at the horizon.
      for (const method of ['summation', 'weighted'] as const) {
        const cut = tiltPattern(p, NO_TILT, method, 'horizon', true).horizontal.atten;
        expect(cut[180]).toBeCloseTo(v[180], 6);
      }
    });
  }
});
