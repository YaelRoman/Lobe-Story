import { describe, expect, it } from 'vitest';
import { anySimulated, exportName, simSummary, simulatedCaption, simulationActive } from './simSummary';

describe('simSummary', () => {
  it('shows the global values', () => {
    expect(simSummary({ electricalDeg: 3, mechanicalDeg: 0, azimuthDeg: -10 }, 0, 0)).toBe('Tilt Δ 3° · Mech 0° · Az −10°');
    expect(simSummary({ electricalDeg: -2.5, mechanicalDeg: -1, azimuthDeg: 0 }, 0, 0)).toBe('Tilt Δ −2.5° · Mech −1° · Az 0°');
  });
  it('counts per-file and group offsets', () => {
    expect(simSummary({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 }, 1, 2)).toBe(
      'Tilt Δ 0° · Mech 0° · Az 0° · 1 file offset · 2 group offsets',
    );
  });
  it('names the 3D method when a tilt is active', () => {
    expect(simSummary({ electricalDeg: 3, mechanicalDeg: 2, azimuthDeg: 0 }, 0, 0, 'weighted')).toBe(
      'Tilt Δ 3° · Mech 2° · Az 0° · 3D method: Weighted',
    );
    expect(simSummary({ electricalDeg: 3, mechanicalDeg: 2, azimuthDeg: 0 }, 0, 0, 'summation')).toContain('3D method: Summation');
  });
});

describe('simulatedCaption and exportName', () => {
  const none = { tiltActive: false, tilt: { electricalDeg: 0, mechanicalDeg: 0 }, azimuthDeg: 0, offsetCount: 0, groupOffsetCount: 0 };
  it('is empty without a simulation', () => {
    expect(simulationActive(none)).toBe(false);
    expect(simulatedCaption(none, 'summation')).toBeUndefined();
  });
  it('lists the electrical, mechanical and azimuth values and the method when a tilt is active', () => {
    const s = { ...none, tiltActive: true, tilt: { electricalDeg: 4, mechanicalDeg: -2 }, azimuthDeg: 10 };
    expect(simulatedCaption(s, 'weighted')).toBe('Simulated: electrical Δ 4°, mechanical −2°, azimuth 10°, weighted method');
  });
  it('leaves the method out for an azimuth-only simulation and counts the offsets', () => {
    expect(simulatedCaption({ ...none, azimuthDeg: 15 }, 'summation')).toBe('Simulated: electrical Δ 0°, mechanical 0°, azimuth 15°');
    expect(simulatedCaption({ ...none, offsetCount: 2, groupOffsetCount: 1, tiltActive: true }, 'summation')).toBe(
      'Simulated: electrical Δ 0°, mechanical 0°, azimuth 0°, summation method; offsets on 2 files and 1 group',
    );
  });
  it('adds -simulated to an export name only while a simulation is active', () => {
    expect(exportName('horizontal-cut', false)).toBe('horizontal-cut');
    expect(exportName('horizontal-cut', true)).toBe('horizontal-cut-simulated');
    expect(exportName('pattern-metrics', true, '.csv')).toBe('pattern-metrics-simulated.csv');
    expect(exportName('pattern-metrics', false, '.csv')).toBe('pattern-metrics.csv');
  });
});

describe('anySimulated', () => {
  const effective = (map: Record<string, [number, number, number]>) => (id: string) => {
    const [electricalDeg, mechanicalDeg, azimuthDeg] = map[id] ?? [0, 0, 0];
    return { electricalDeg, mechanicalDeg, azimuthDeg };
  };
  it('counts only the files given: an offset on a file that is not drawn does not count', () => {
    const e = effective({ a: [0, 3, 0], b: [0, 0, 0] });
    expect(anySimulated(e, ['b'])).toBe(false);
    expect(anySimulated(e, ['a', 'b'])).toBe(true);
    expect(anySimulated(e, [])).toBe(false);
  });
  it('sees a tilt, a mechanical tilt or an azimuth', () => {
    const e = effective({ t: [2, 0, 0], m: [0, -1, 0], z: [0, 0, 15] });
    for (const id of ['t', 'm', 'z']) expect(anySimulated(e, [id])).toBe(true);
  });
});
