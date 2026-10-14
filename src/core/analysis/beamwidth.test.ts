import { describe, expect, it } from 'vitest';
import { beamwidth } from './beamwidth';
import { gridFrom, quadBeam } from '../../test/synthetic';

describe('beamwidth', () => {
  it('measures a 60° beam at boresight', () => {
    const r = beamwidth(gridFrom(quadBeam(60)));
    expect(r.hpbw.value).toBeCloseTo(60, 5);
    expect(r.direction.value).toBeCloseTo(0, 5);
    expect(r.edges![0]).toBeCloseTo(-30, 5);
    expect(r.edges![1]).toBeCloseTo(30, 5);
    expect(r.peakAngle).toBe(0);
  });

  it('interpolates crossings between samples', () => {
    expect(beamwidth(gridFrom(quadBeam(55))).hpbw.value).toBeCloseTo(55, 1);
  });

  it('reports the direction of a steered beam', () => {
    const r = beamwidth(gridFrom(quadBeam(60, 5)));
    expect(r.direction.value).toBeCloseTo(5, 5);
    expect(r.edges![0]).toBeCloseTo(-25, 5);
    expect(r.edges![1]).toBeCloseTo(35, 5);
  });

  it('handles a peak across the 0/360 wrap', () => {
    const r = beamwidth(gridFrom(quadBeam(60, -8)));
    expect(r.hpbw.value).toBeCloseTo(60, 5);
    expect(r.direction.value).toBeCloseTo(-8, 5);
    expect(r.edges![0]).toBeCloseTo(-38, 5);
    expect(r.edges![1]).toBeCloseTo(22, 5);
  });

  it('uses a configurable level', () => {
    expect(beamwidth(gridFrom(quadBeam(60)), 10).hpbw.value).toBeCloseTo(109.5, 0);
  });

  it('returns null with a reason when one side never drops by the level', () => {
    const oneSided = (a: number) => (a <= 0 || a >= 170 ? 0 : Math.min(3 * (a / 30) ** 2, 40));
    const r = beamwidth(gridFrom(oneSided));
    expect(r.hpbw.value).toBeNull();
    expect(r.hpbw.reason).toMatch(/negative-angle side/);
    expect(beamwidth(gridFrom(oneSided), 19.123456789012344).hpbw.reason).toBe('Pattern never drops 19.12 dB on the negative-angle side');
    expect(r.direction.value).toBeNull();
    expect(r.edges).toBeNull();
  });
});
