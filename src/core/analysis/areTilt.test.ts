import { describe, expect, it } from 'vitest';
import { exampleFiles } from '../exampleSet';
import { parsePlanet } from '../parse/planet';
import { analyzeAll, DEFAULT_SETTINGS, type TaggedPattern } from './metrics';
import { analyzeTilted, sphereTablesBuilt, tiltEach, tiltTagged, type TiltSettings } from './tilt';
import { toGrid } from './grid';
import { beamwidth } from './beamwidth';
import type { Method3d } from './pattern3d';
import type { Pattern } from '../types';

/** Integrates the 3D reconstruction many times: about 1 s alone, up to ~15 s when the whole suite runs in parallel on a busy machine. */
const HEAVY_TEST_MS = 30_000;

const RAD = Math.PI / 180;

const example = (index: number): Pattern => {
  const f = exampleFiles()[index];
  const r = parsePlanet(f.text, f.name);
  if (!r.ok) throw new Error(r.error);
  return r.pattern;
};

/** dB level of a 1° circle at any angle, linear in dB between the samples. */
function level(g: number[], angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  const i = Math.floor(a) % 360;
  const f = a - Math.floor(a);
  return g[i] * (1 - f) + g[(i + 1) % 360] * f;
}

/**
 * This test's own model of a mechanically tilted antenna, written without the app's rotation code: the unit vector
 * of a ground direction (x forward, y left, z up; elevation positive below the horizon) is turned about the y axis
 * by the tilt, and the pattern is read at the direction that results. A down-tilt of m moves the boresight to
 * elevation +m.
 */
function tiltedIntensity(h: number[], v: number[], mechDeg: number, method: Method3d) {
  const cm = Math.cos(mechDeg * RAD);
  const sm = Math.sin(mechDeg * RAD);
  return (azDeg: number, elDeg: number): number => {
    const x = Math.cos(elDeg * RAD) * Math.cos(azDeg * RAD);
    const y = Math.cos(elDeg * RAD) * Math.sin(azDeg * RAD);
    const down = Math.sin(elDeg * RAD);
    // Inverse rotation: the antenna's forward axis points at elevation +m in the ground frame.
    const xa = x * cm + down * sm;
    const downA = -x * sm + down * cm;
    const aH = level(h, Math.atan2(y, xa) / RAD);
    const aV = level(v, Math.asin(Math.max(-1, Math.min(1, downA))) / RAD);
    if (method === 'summation') return 10 ** (-(aH + aV) / 10);
    const ph = 10 ** (-aH / 10);
    const pv = 10 ** (-aV / 10);
    const w1 = pv * (1 - ph);
    const w2 = ph * (1 - pv);
    return 10 ** (-(w1 + w2 < 1e-12 ? aH + aV : (aH * w1 + aV * w2) / (w1 + w2)) / 10);
  };
}

/** Midpoint rule over a box of the sphere (0.2° × 0.5° cells), with the solid-angle weight. */
function box(f: (az: number, el: number) => number, el0: number, el1: number, az0: number, az1: number): number {
  if (el1 <= el0) return 0;
  const ne = Math.ceil((el1 - el0) / 0.2);
  const na = Math.ceil((az1 - az0) / 0.5);
  const de = (el1 - el0) / ne;
  const da = (az1 - az0) / na;
  let sum = 0;
  for (let i = 0; i < ne; i++) {
    const el = el0 + (i + 0.5) * de;
    const c = Math.cos(el * RAD);
    for (let j = 0; j < na; j++) sum += f(az0 + (j + 0.5) * da, el) * c;
  }
  return sum * de * da;
}

/** The three ratios of the rotated pattern, the Type A bounds taken from the tilted beam (peak P, 3 dB width B). */
function reference(p: Pattern, mechDeg: number, method: Method3d, peak: number, hpbw: number) {
  const f = tiltedIntensity(toGrid(p.horizontal), toGrid(p.vertical), mechDeg, method);
  const upperEnd = Math.min(0, peak - hpbw);
  const upper = box(f, -90, upperEnd, -180, 180);
  const lower = box(f, 75, 90, -180, 180);
  const service = box(f, peak - hpbw / 2, 75, -60, 60);
  const middle = box(f, upperEnd, 75, -180, 180);
  const total = upper + middle + lower;
  return { sector: (100 * service) / total, spatial: (100 * service) / middle, lower: (100 * lower) / total };
}

function app(p: Pattern, t: TiltSettings, method: Method3d) {
  const items: TaggedPattern[] = [{ pattern: p, tags: {} }];
  const original = analyzeAll(items, DEFAULT_SETTINGS, { areMethod: method }).get(p.id)!;
  const tiltedItems = tiltTagged(items, t, method);
  const tilted = analyzeTilted(tiltedItems, DEFAULT_SETTINGS, t, method).get(p.id)!;
  const vBeam = beamwidth(toGrid(tiltedItems[0].pattern.vertical), 3);
  return { original: original.are, tilted: tilted.are, peak: vBeam.peakAngle, hpbw: vBeam.hpbw.value! };
}

describe('the angular-region estimate under a mechanical tilt', () => {
  const file0 = example(0);

  it('is the integral of the rotated 3D reconstruction, not of the two tilted cuts (example file 0, Summation)', () => {
    // Figures of the review: about 85.8 → 83.4 at +4° and → 78.8 at +10° (its probe; the same model as `reference`).
    for (const [mech, reviewed] of [[4, 83.42], [10, 78.84]] as const) {
      const a = app(file0, { electricalDeg: 0, mechanicalDeg: mech }, 'summation');
      const own = reference(file0, mech, 'summation', a.peak, a.hpbw);
      expect(own.sector).toBeCloseTo(reviewed, 1);
      expect(Math.abs(a.tilted.sector.value! - own.sector)).toBeLessThan(0.3);
      expect(Math.abs(a.tilted.spatial.value! - own.spatial)).toBeLessThan(0.3);
      expect(a.tilted.lower.value! / own.lower).toBeGreaterThan(0.9);
      expect(a.tilted.lower.value! / own.lower).toBeLessThan(1.1);
    }
  });

  it('falls with a down-tilt and rises with an up-tilt, as the rotated pattern does', () => {
    const at = (mech: number) => app(file0, { electricalDeg: 0, mechanicalDeg: mech }, 'summation');
    const original = at(4).original.sector.value!;
    expect(original).toBeCloseTo(85.57, 1);
    expect(at(2).tilted.sector.value! - original).toBeCloseTo(-1.1, 0);
    expect(at(4).tilted.sector.value! - original).toBeLessThan(-1.8);
    expect(at(4).tilted.sector.value! - original).toBeGreaterThan(-2.8);
    expect(at(10).tilted.sector.value! - original).toBeLessThan(-6.3);
    expect(at(10).tilted.sector.value! - original).toBeGreaterThan(-7.5);
    expect(at(-6).tilted.sector.value!).toBeGreaterThan(original + 2);
  });

  it('agrees with the rotated pattern for the Weighted method and with an electrical tilt on top', () => {
    const w = app(file0, { electricalDeg: 0, mechanicalDeg: 6 }, 'weighted');
    const ownW = reference(file0, 6, 'weighted', w.peak, w.hpbw);
    expect(Math.abs(w.tilted.sector.value! - ownW.sector)).toBeLessThan(0.3);
    expect(w.tilted.sector.value!).toBeLessThan(w.original.sector.value! - 2);

    // Electrical +3° first (the elevation cut moves down 3°), then the mechanical 6°.
    const both = app(file0, { electricalDeg: 3, mechanicalDeg: 6 }, 'summation');
    const v = toGrid(file0.vertical);
    const shifted: Pattern = { ...file0, vertical: { angles: v.map((_, i) => i), atten: v.map((_, i) => v[(i + 357) % 360]) } };
    const ownBoth = reference(shifted, 6, 'summation', both.peak, both.hpbw);
    expect(Math.abs(both.tilted.sector.value! - ownBoth.sector)).toBeLessThan(0.3);
  });

  it('keeps the two-cut path for an electrical tilt alone', () => {
    const a = app(file0, { electricalDeg: 4, mechanicalDeg: 0 }, 'summation');
    expect(Math.abs(a.tilted.sector.value! - a.original.sector.value!)).toBeLessThan(0.3);
  });

  it('is continuous: a very small mechanical tilt gives nearly the untilted value', () => {
    const a = app(file0, { electricalDeg: 0, mechanicalDeg: 0.01 }, 'summation');
    expect(a.tilted.sector.value!).toBeCloseTo(a.original.sector.value!, 1);
    expect(a.tilted.spatial.value!).toBeCloseTo(a.original.spatial.value!, 1);
  });

  it('remembers the result per tilted file', () => {
    const items: TaggedPattern[] = [{ pattern: file0, tags: {} }];
    const t = { electricalDeg: 0, mechanicalDeg: 5 };
    const tilted = tiltTagged(items, t, 'summation');
    const first = analyzeTilted(tilted, DEFAULT_SETTINGS, t, 'summation').get(file0.id)!.are;
    const again = analyzeTilted(tiltTagged(items, t, 'summation'), { ...DEFAULT_SETTINGS, fbWindowDeg: 20 }, t, 'summation').get(file0.id)!.are;
    expect(again).toBe(first);
    // The same tilted cuts analysed as a plain two-cut file are a different question with a different answer.
    const asCuts = analyzeAll(tilted, DEFAULT_SETTINGS, { areMethod: 'summation' }).get(file0.id)!.are;
    expect(asCuts.sector.value!).toBeGreaterThan(first.sector.value! + 1);
  });

  it('still says why there is no number (the tilted elevation peak is below the Type A service region)', () => {
    const a = app(file0, { electricalDeg: 0, mechanicalDeg: 80 }, 'summation');
    expect(a.tilted.sector.value).toBeNull();
    expect(a.tilted.sector.reason).toBe('The elevation peak is below the Type A service region');
  });

  it('builds each distinct mechanical tilt\'s direction table once, however many distinct tilts the files have', () => {
    const base = example(0);
    const items: TaggedPattern[] = Array.from({ length: 192 }, (_, i) => ({ pattern: { ...base, id: `f${i}.msi` }, tags: {} }));
    // 24 distinct tilts (0.37° apart, so none is cached by an earlier test), files cycling through them.
    const tiltFor = (id: string): TiltSettings => ({ electricalDeg: 0, mechanicalDeg: 0.37 * (1 + (Number(id.slice(1, -4)) % 24)) });
    const before = sphereTablesBuilt();
    const tilted = tiltEach(items, tiltFor, 'summation');
    analyzeTilted(tilted, DEFAULT_SETTINGS, tiltFor, 'summation');
    expect(sphereTablesBuilt() - before).toBe(24);
    // A second pass that recomputes every file (another sector edge) builds none.
    analyzeTilted(tilted, { ...DEFAULT_SETTINGS, sectorEdgeDeg: 45 }, tiltFor, 'summation');
    expect(sphereTablesBuilt() - before).toBe(24);
  }, HEAVY_TEST_MS);

  it('computes an untilted file\'s estimate once across passes that also contain a mechanically tilted file', () => {
    const [a, b] = [example(0), { ...example(0), id: 'tilted.msi' }];
    const items: TaggedPattern[] = [{ pattern: a, tags: {} }, { pattern: b, tags: {} }];
    const tiltFor = (id: string): TiltSettings => (id === 'tilted.msi' ? { electricalDeg: 0, mechanicalDeg: 4 } : { electricalDeg: 0, mechanicalDeg: 0 });
    const tilted = tiltEach(items, tiltFor, 'summation');
    const first = analyzeAll(items, DEFAULT_SETTINGS, { areMethod: 'summation' }).get(a.id)!.are;
    const second = analyzeTilted(tilted, DEFAULT_SETTINGS, tiltFor, 'summation').get(a.id)!.are;
    const third = analyzeAll(items, DEFAULT_SETTINGS, { areMethod: 'summation' }).get(a.id)!.are;
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('carries the regions of the tilted beam (the simulated elevation cut\'s peak and beamwidth), mechanical or electrical', () => {
    for (const t of [{ electricalDeg: 0, mechanicalDeg: 6 }, { electricalDeg: 4, mechanicalDeg: 0 }, { electricalDeg: 2, mechanicalDeg: -3 }]) {
      const a = app(file0, t, 'summation');
      expect(a.tilted.regions, JSON.stringify(t)).toBeDefined();
      expect(a.tilted.regions!.upperEndDeg).toBeCloseTo(Math.min(0, a.peak - a.hpbw), 9);
      expect(a.tilted.regions!.serviceStartDeg).toBeCloseTo(a.peak - a.hpbw / 2, 9);
      expect(a.tilted.regions!.sectorEdgeDeg).toBe(60);
      // They move with the beam.
      expect(a.tilted.regions!.serviceStartDeg).not.toBeCloseTo(a.original.regions!.serviceStartDeg, 1);
    }
  });
});
