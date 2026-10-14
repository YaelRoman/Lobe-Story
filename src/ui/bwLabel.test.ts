import { describe, expect, it } from 'vitest';
import { bwMarkerLabel, bwName, settingText } from './bwLabel';

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

describe('settingText', () => {
  it('writes a setting with at most two decimals, an integer as an integer', () => {
    expect(settingText(19.123456789012344)).toBe('19.12');
    expect(settingText(10)).toBe('10');
    expect(settingText(22.5)).toBe('22.5');
    expect(settingText(9.999)).toBe('10');
  });
});
