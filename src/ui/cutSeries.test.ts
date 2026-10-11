import { describe, expect, it } from 'vitest';
import { analyzeAll, DEFAULT_SETTINGS } from '../core/analysis/metrics';
import {
  analyzeTilted,
  effectiveFor,
  isTilted,
  NO_TILT,
  tiltEach,
  type SimSettings,
  type TiltSettings,
} from '../core/analysis/tilt';
import { patternFrom, quadBeam, vBeamWithLobes } from '../test/synthetic';
import { buildCutSeries } from './cutSeries';
import type { SimulationResult } from './useSimulation';

const items = [
  { pattern: patternFrom(quadBeam(65), vBeamWithLobes, { id: 'a', fileName: 'a.MSI' }), tags: { tiltDeg: 6 } },
  { pattern: patternFrom(quadBeam(60), vBeamWithLobes, { id: 'b', fileName: 'b.MSI' }), tags: { tiltDeg: 6 } },
];
const original = analyzeAll(items);
const colors = new Map([
  ['a', '#111111'],
  ['b', '#222222'],
]);

function simFor(
  tilt: TiltSettings,
  azimuthDeg = 0,
  showOriginal = true,
  offsets: Record<string, SimSettings> = {},
): SimulationResult {
  const global = { ...tilt, azimuthDeg };
  const effective = (id: string) => effectiveFor(global, offsets[id]);
  const isTiltedId = (id: string) => isTilted(effective(id));
  const tiltActive = items.some((i) => isTiltedId(i.pattern.id));
  const tilted = tiltActive ? tiltEach(items, effective, 'summation') : items;
  return {
    tiltActive,
    tilt,
    azimuthDeg,
    showOriginal,
    offsetCount: Object.keys(offsets).length,
    groupOffsetCount: 0,
    effective,
    isTiltedId,
    patterns: new Map(tilted.map((i) => [i.pattern.id, i.pattern])),
    metrics: tiltActive ? analyzeTilted(tilted, DEFAULT_SETTINGS, effective) : original,
  };
}

describe('buildCutSeries', () => {
  it('adds dashed original series after the tilted ones when tilt is active and Show original is on', () => {
    const s = buildCutSeries(items, simFor({ electricalDeg: 0, mechanicalDeg: 4 }), original, colors, 'V');
    expect(s.map((x) => x.id)).toEqual(['a', 'b', 'a#original', 'b#original']);
    expect(s.map((x) => !!x.dash)).toEqual([false, false, true, true]);
    expect(s[2].label).toBe('1800 MHz · a.MSI (original)');
    expect(s[2].color).toBe('#111111');
    expect(s[2].cut).toBe(items[0].pattern.vertical);
    expect(s[2].metrics).toBe(original.get('a'));
  });

  it('omits the original series when Show original is off', () => {
    const s = buildCutSeries(items, simFor({ electricalDeg: 2, mechanicalDeg: 0 }, 0, false), original, colors, 'H');
    expect(s.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('yields no original series for an azimuth-only simulation', () => {
    const s = buildCutSeries(items, simFor(NO_TILT, 45), original, colors, 'H');
    expect(s.map((x) => x.id)).toEqual(['a', 'b']);
    expect(s[0].cut).toBe(items[0].pattern.horizontal);
  });

  it('flags the simulated H series of a mechanically tilted file as a cone cut, and nothing else', () => {
    const mech = simFor({ electricalDeg: 0, mechanicalDeg: 4 });
    expect(buildCutSeries(items, mech, original, colors, 'H').map((x) => !!x.coneCut)).toEqual([true, true, false, false]);
    expect(buildCutSeries(items, mech, original, colors, 'V').some((x) => x.coneCut)).toBe(false);
    const elec = simFor({ electricalDeg: 2, mechanicalDeg: 0 });
    expect(buildCutSeries(items, elec, original, colors, 'H').some((x) => x.coneCut)).toBe(false);
  });

  it('takes the tilted series\' cuts and metrics from the simulation', () => {
    const sim = simFor({ electricalDeg: 0, mechanicalDeg: 4 });
    const s = buildCutSeries(items, sim, original, colors, 'H');
    expect(s[0].metrics).toBe(sim.metrics.get('a'));
    expect(s[0].metrics).not.toBe(original.get('a'));
    expect(s[0].cut).toBe(sim.patterns.get('a')!.horizontal);
  });

  it('adds originals only for tilted files', () => {
    const s = buildCutSeries(
      items,
      simFor(NO_TILT, 0, true, { b: { electricalDeg: 0, mechanicalDeg: 4, azimuthDeg: 0 } }),
      original,
      colors,
      'V',
    );
    expect(s.map((x) => x.id)).toEqual(['a', 'b', 'b#original']);
    expect(s[0].cut).toBe(items[0].pattern.vertical);
  });

  it('rotates each H series by its own effective azimuth and never rotates V', () => {
    const sim = simFor(NO_TILT, 10, true, { b: { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 20 } });
    expect(buildCutSeries(items, sim, original, colors, 'H').map((x) => x.rotationDeg)).toEqual([10, 30]);
    expect(buildCutSeries(items, sim, original, colors, 'V').map((x) => x.rotationDeg)).toEqual([0, 0]);
  });

  it('labels series with display names', () => {
    const named = [{ ...items[0], pattern: { ...items[0].pattern, displayName: 'North' } }];
    const s = buildCutSeries(named, simFor(NO_TILT), original, colors, 'H');
    expect(s[0].label).toBe('1800 MHz · North');
  });

  it('gives a live trace the line pattern of its style when the style is not solid, and leaves originals dashed', () => {
    const styles = new Map([
      ['a', { color: '#111111', dash: 'dot' as const, symbol: 'square' }],
      ['b', { color: '#222222', dash: 'solid' as const, symbol: 'circle' }],
    ]);
    const tilted = simFor({ electricalDeg: 3, mechanicalDeg: 0, azimuthDeg: 0 } as TiltSettings);
    const s = buildCutSeries(items, tilted, original, colors, 'H', styles);
    expect(s.filter((x) => !x.dash).map((x) => x.lineDash)).toEqual(['dot', undefined]);
    expect(s.some((x) => x.dash)).toBe(true);
    expect(s.filter((x) => x.dash).every((x) => x.lineDash === undefined)).toBe(true);
  });
});
