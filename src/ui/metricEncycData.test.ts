import { describe, expect, it } from 'vitest';
import { ENCYC_METRICS } from './metricEncycData';

describe('ENCYC_METRICS data integrity', () => {
  it('contains exactly 11 metrics in the user-specified order', () => {
    const ids = ENCYC_METRICS.map(m => m.id);
    expect(ids).toEqual([
      'hpbw',      // 1. Half Power Beamwidth
      'rolloff',   // 2. Roll-off
      'vhpbw',     // 3. Vertical Beamwidth
      'usls',      // 4. Upper Side Lobe Suppression
      'fb',        // 5. Front to Back Ratio
      'tracking',  // 6. Beam Tracking Distortion
      'squint',    // 7. Squint
      'nullfill',  // 8. Null Filling
      'du',        // 9. Desired / Undesired Aperture
      'hsls',      // 10. Horizontal Sidelobe Suppression
      'spr',       // 11. Sector Power Ratio & AIR
    ]);
  });

  it('contains all required fields with meaningful content for each metric', () => {
    for (const m of ENCYC_METRICS) {
      expect(m.name.length).toBeGreaterThan(3);
      expect(m.definition.length).toBeGreaterThan(15);
      expect(m.whatFor.length).toBeGreaterThan(15);
      expect(m.unit.length).toBeGreaterThan(0);
      expect(['H', 'V']).toContain(m.cut);
      expect(['polar', 'rect']).toContain(m.mode);
    }
  });

  it('configures D/U with all four tabs (16QAM, 64QAM, 256QAM, all)', () => {
    const du = ENCYC_METRICS.find(m => m.id === 'du');
    expect(du).toBeDefined();
    expect(du?.duTabs).toHaveLength(4);
    const keys = du?.duTabs?.map(t => t.key);
    expect(keys).toEqual(['qam16', 'qam64', 'qam256', 'all']);
  });

  it('matches requested first-option representations (Vertical Polar, Polar Horizontal, Rectangular)', () => {
    // Vertical Polar
    const verticalPolar = ['vhpbw', 'usls', 'nullfill'];
    for (const id of verticalPolar) {
      const m = ENCYC_METRICS.find(x => x.id === id);
      expect(m?.cut).toBe('V');
      expect(m?.mode).toBe('polar');
    }

    // Polar Horizontal
    const polarHorizontal = ['fb', 'tracking', 'du', 'hsls', 'hpbw', 'squint', 'spr'];
    for (const id of polarHorizontal) {
      const m = ENCYC_METRICS.find(x => x.id === id);
      expect(m?.cut).toBe('H');
      expect(m?.mode).toBe('polar');
    }

    // Rectangular
    const rolloff = ENCYC_METRICS.find(x => x.id === 'rolloff');
    expect(rolloff?.cut).toBe('H');
    expect(rolloff?.mode).toBe('rect');
  });
});
