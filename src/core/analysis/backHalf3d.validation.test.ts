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

/**
 * A deep, narrow null straight behind the antenna on the beam's cone (`depthDb` at its centre, about 6° wide): both
 * cuts cross it, so they agree there and both show it. A truth to catch back lobes the model would invent from it.
 */
function withBackNull(truth: Truth, coneDeg: number, depthDb: number): Truth {
  const centre = [-Math.cos(coneDeg * RAD), 0, -Math.sin(coneDeg * RAD)];
  return (phi, theta) => {
    const d = [Math.cos(theta * RAD) * Math.cos(phi * RAD), Math.cos(theta * RAD) * Math.sin(phi * RAD), -Math.sin(theta * RAD)];
    const angle = Math.acos(Math.max(-1, Math.min(1, d[0] * centre[0] + d[1] * centre[1] + d[2] * centre[2]))) / RAD;
    return truth(phi, theta) * (1 - (1 - 10 ** (-depthDb / 10)) * Math.exp(-((angle / 3) ** 2)));
  };
}

const TRUTHS: [string, Truth][] = [
  ['no tilt, back lobe 15° up', panel(0, 15, 25, 3)],
  ['6° tilt, back lobe 15° up', panel(6, 15, 25, 3)],
  ['4° tilt, back lobe 20° down', panel(4, -20, 22, 4)],
  ['4° tilt, 40 dB null straight behind', withBackNull(panel(4, -20, 22, 4), 4, 40)],
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
  // The strongest level either cut measured behind the antenna, and how much stronger than it the model gets there.
  let strongestBack = Infinity;
  for (let i = 91; i <= 269; i++) strongestBack = Math.min(strongestBack, h[i], v[i]);
  let excess = -Infinity;
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
      if (Math.abs(a) > 90) excess = Math.max(excess, strongestBack - now);
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
    excess,
  };
}

describe('validation against a known 3D pattern', () => {
  for (const [name, truth] of TRUTHS) {
    it(`${name}: closer to the truth behind the antenna, not further in front, single-valued at the poles`, () => {
      const sum = errors(truth, 'summation');
      const wtd = errors(truth, 'weighted');
      // Measured (dB RMS, back old → new, the four truths in order): Summation 8.4 → 2.8, 8.6 → 2.9, 8.8 → 2.9,
      // 8.8 → 2.8; Weighted 8.1 → 6.0, 7.5 → 5.6, 8.4 → 6.2, 8.4 → 6.2 (ratios 0.32–0.34 and 0.74–0.76).
      expect(sum.back.now).toBeLessThan(0.4 * sum.back.old);
      expect(wtd.back.now).toBeLessThan(0.8 * wtd.back.old);
      // Front (old → new): Summation 4.6 → 2.5 (the pole term), Weighted 5.3 → 5.3.
      expect(sum.front.now).toBeLessThan(sum.front.old + 0.1);
      expect(wtd.front.now).toBeLessThan(wtd.front.old + 0.1);
      expect(sum.poleSpread).toBeLessThan(1e-9);
      expect(wtd.poleSpread).toBeLessThan(1e-9);
      // No back direction stronger than the strongest level either cut measured behind the antenna (measured: 0 dB
      // Summation, at most 0.3 dB Weighted).
      expect(sum.excess).toBeLessThan(0.5);
      expect(wtd.excess).toBeLessThan(1);
    });

    it(`${name}: F/B under mechanical tilt, straight behind and over the ±30° window`, () => {
      const { h, v, peak } = cutsOf(truth);
      const p = patternFrom((a) => h[(a + 360) % 360], (a) => v[(a + 360) % 360]);
      for (const mech of [4, 10]) {
        const truthDb = (phi: number, theta: number) => {
          const r = rotateToAntenna(phi, theta, mech);
          return db(truth(r.phi, r.theta));
        };
        const cone = peak + mech;
        const front = truthDb(0, cone);
        // Straight behind, the ground cone is the vertical cut's plane: read from that cut, so this is a check of the
        // identity and of the tilt geometry, not of the reconstruction.
        const trueFb180 = truthDb(180, cone) - front;
        // Over 180° ± 30° the azimuths between the cut planes are interpolated: this is the reconstruction's accuracy.
        let strongest = Infinity;
        for (let a = 150; a <= 210; a++) strongest = Math.min(strongest, truthDb(a, cone));
        const trueFbWindow = strongest - front;
        for (const method of ['summation', 'weighted'] as const) {
          const fb = (backHalf: boolean) => {
            const cut = tiltPattern(p, { electricalDeg: 0, mechanicalDeg: mech }, method, 'beam', backHalf).horizontal.atten;
            const peakLevel = Math.min(...cut);
            return { at180: cut[180] - peakLevel, window: Math.min(...cut.slice(150, 211)) - peakLevel };
          };
          const on = fb(true);
          const off = fb(false);
          expect(Math.abs(on.at180 - trueFb180)).toBeLessThan(0.2);
          // Measured error over the window (on, off): Summation 0–4.6 dB (off 2.3–18), on worse than off by up to
          // 1.3 dB in the 6° truth; Weighted 0.1–10.6 dB (off 0.7–16), always closer than off.
          if (method === 'summation') expect(Math.abs(on.window - trueFbWindow)).toBeLessThan(5);
          else expect(Math.abs(on.window - trueFbWindow)).toBeLessThan(Math.abs(off.window - trueFbWindow));
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
