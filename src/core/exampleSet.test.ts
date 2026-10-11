import { describe, expect, it } from 'vitest';
import { exampleFiles, EXAMPLE_FREQUENCIES_MHZ, EXAMPLE_PREFIX, EXAMPLE_TILTS_DEG } from './exampleSet';
import { parsePlanet } from './parse/planet';
import { inferTags, groupLabel } from './grouping';
import { autoSubBands, buildDatasets } from './analysis/subBands';
import { analyzeAll, DEFAULT_SETTINGS, type TaggedPattern } from './analysis/metrics';

const files = exampleFiles();
const parsed = files.map((f) => {
  const r = parsePlanet(f.text, f.name);
  if (!r.ok) throw new Error(`${f.name}: ${r.error}`);
  return { f, pattern: r.pattern, warnings: r.warnings };
});
const tagged: TaggedPattern[] = parsed.map(({ pattern }) => ({ pattern, tags: inferTags(pattern) }));
const metrics = analyzeAll(tagged, DEFAULT_SETTINGS);

describe('exampleFiles', () => {
  it('is deterministic', () => {
    expect(exampleFiles()).toEqual(files);
  });

  it('has every frequency × tilt × polarization, named example_… and unique', () => {
    expect(files).toHaveLength(EXAMPLE_FREQUENCIES_MHZ.length * EXAMPLE_TILTS_DEG.length * 2);
    expect(new Set(files.map((f) => f.name)).size).toBe(files.length);
    expect(files.every((f) => f.name.startsWith(EXAMPLE_PREFIX) && f.name.endsWith('.msi'))).toBe(true);
    expect(new Set(files.map((f) => f.text)).size).toBe(files.length);
  });

  it('parses without warnings and says it is synthetic', () => {
    for (const { f, warnings, pattern } of parsed) {
      expect(warnings, f.name).toEqual([]);
      expect(pattern.name).toBe('Example antenna');
      expect(pattern.comment).toMatch(/synthetic/i);
    }
  });

  it('is read as ±45 at the tilts and frequencies of its name, in 6 groups', () => {
    for (const { f, pattern } of parsed) {
      const t = inferTags(pattern);
      const m = /_(\d+)_([PM])45_(\d+)T/.exec(f.name)!;
      expect(t).toEqual({ polarization: m[2] === 'P' ? '+45' : '-45', tiltDeg: Number(m[3]) });
      expect(pattern.frequencyMHz).toBe(Number(m[1]));
    }
    expect(new Set(tagged.map((t) => groupLabel(t.tags))).size).toBe(EXAMPLE_TILTS_DEG.length * 2);
  });

  it('has enough files in each of the two sub-bands for band statistics', () => {
    const low = parsed.filter((p) => p.pattern.frequencyMHz < 2000).length;
    expect(low).toBeGreaterThanOrEqual(10);
    expect(parsed.length - low).toBeGreaterThanOrEqual(10);
  });

  it('has plausible metrics: HPBW 55-72° / 6-10°, F/B above 22 dB, tilt on target, squint under 3°, tracking 0.05-3 dB', () => {
    for (const { f, pattern } of parsed) {
      const m = metrics.get(pattern.id)!;
      const n = (r: { value: number | null }) => r.value as number;
      expect(n(m.h.hpbw), f.name).toBeGreaterThanOrEqual(55);
      expect(n(m.h.hpbw), f.name).toBeLessThanOrEqual(72);
      expect(n(m.v.hpbw), f.name).toBeGreaterThanOrEqual(6);
      expect(n(m.v.hpbw), f.name).toBeLessThanOrEqual(10);
      expect(n(m.fbWindow), f.name).toBeGreaterThanOrEqual(22);
      expect(Math.abs(n(m.tilt) - inferTags(pattern).tiltDeg!), f.name).toBeLessThan(1);
      expect(Math.abs(n(m.squint)), f.name).toBeLessThan(3);
      expect(n(m.beamTracking), f.name).toBeLessThan(3);
      expect(n(m.beamTracking), f.name).toBeGreaterThan(0.05);
      expect(n(m.nullFill), f.name).toBeGreaterThan(15);
      expect(n(m.firstUsls), f.name).toBeGreaterThan(15);
    }
  });

  it('is one antenna in two automatic sub-bands, the beamwidth falling with frequency, ± ports not identical', () => {
    expect(buildDatasets(tagged, [])).toHaveLength(1);
    expect(autoSubBands(tagged.map((t) => t.pattern.frequencyMHz)).map((b) => b.name)).toEqual(['1710–1795 MHz', '2110–2170 MHz']);
    const hpbw = (name: string) => metrics.get(name)!.h.hpbw.value as number;
    expect(hpbw('example_1710_P45_05T.msi')).toBeGreaterThan(hpbw('example_2170_P45_05T.msi'));
    expect(hpbw('example_2110_P45_05T.msi')).not.toBe(hpbw('example_2110_M45_05T.msi'));
    expect(metrics.get('example_2110_P45_05T.msi')!.squint.value).toBeGreaterThan(0);
    expect(metrics.get('example_2110_M45_05T.msi')!.squint.value).toBeLessThan(0);
  });
});
