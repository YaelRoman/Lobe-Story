import { describe, expect, it } from 'vitest';
import { simSummary } from './simSummary';

describe('simSummary', () => {
  it('shows the global values', () => {
    expect(simSummary({ electricalDeg: 3, mechanicalDeg: 0, azimuthDeg: -10 }, 0, 0)).toBe('Tilt Δ 3° · Mech 0° · Az -10°');
  });
  it('counts per-file and group offsets', () => {
    expect(simSummary({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0 }, 1, 2)).toBe(
      'Tilt Δ 0° · Mech 0° · Az 0° · 1 file offset · 2 group offsets',
    );
  });
});
