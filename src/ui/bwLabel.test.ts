import { describe, expect, it } from 'vitest';
import { bwMarkerLabel, bwName } from './bwLabel';

describe('bwName', () => {
  it('is HPBW at 3 dB and BW@x dB at any other level', () => {
    expect(bwName()).toBe('HPBW');
    expect(bwName(3)).toBe('HPBW');
    expect(bwName(10)).toBe('BW@10 dB');
    expect(bwName(0.5)).toBe('BW@0.5 dB');
  });
  it('names the marker with its level', () => {
    expect(bwMarkerLabel(3)).toBe('−3 dB / HPBW');
    expect(bwMarkerLabel(10)).toBe('−10 dB / BW@10 dB');
  });
});
