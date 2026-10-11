import { describe, expect, it } from 'vitest';
import { beamwidth } from './beamwidth';
import { frontToBack } from './frontToBack';
import { firstNullFill, usls } from './sidelobes';
import { beamTracking } from './tracking';
import { gridFrom, quadBeam, vBeamWithLobes } from '../../test/synthetic';

describe('frontToBack', () => {
  const h = gridFrom((a) => (a === 170 ? 25 : Math.abs(a) <= 90 ? quadBeam(60)(a) : 35));

  it('reports the level at 180° and the worst level in the window', () => {
    const r = frontToBack(h);
    expect(r.fb180).toEqual({ value: 35, angle: 180 });
    expect(r.fbWindow).toEqual({ value: 25, angle: 170 });
  });

  it('respects the window width', () => {
    expect(frontToBack(h, 5).fbWindow.value).toBe(35);
  });
});

describe('usls and first null fill', () => {
  const v = gridFrom(vBeamWithLobes);
  const beam = beamwidth(v);

  it('sanity: the synthetic beam has HPBW 8° at +6°', () => {
    expect(beam.hpbw.value).toBeCloseTo(8, 5);
    expect(beam.direction.value).toBeCloseTo(6, 5);
  });

  it('finds the highest upper sidelobe between the first upper null and peak − 20°', () => {
    expect(usls(v, beam)).toEqual({ value: 18, angle: -8 });
  });

  it('returns null when the first upper null is outside the range', () => {
    const r = usls(v, beam, 8);
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/more than 8°/);
  });

  it('measures the first null below the beam', () => {
    expect(firstNullFill(v, beam)).toEqual({ value: 22, angle: 16 });
  });

  it('returns null when there is no null', () => {
    const smooth = gridFrom(quadBeam(8, 6));
    const smoothBeam = beamwidth(smooth);
    expect(usls(smooth, smoothBeam).value).toBeNull();
    expect(usls(smooth, smoothBeam).reason).toMatch(/No null found above/);
    expect(firstNullFill(smooth, smoothBeam).value).toBeNull();
  });

  it('returns null when HPBW is undefined', () => {
    const flat = gridFrom(() => 0);
    expect(usls(flat, beamwidth(flat)).reason).toBe('HPBW undefined');
  });
});

describe('beamTracking', () => {
  const a = gridFrom(quadBeam(65));
  const b = gridFrom((x) => quadBeam(65)(x) + (x === 20 ? 2 : 0));

  it('reports the largest level difference inside the window', () => {
    expect(beamTracking(a, b)).toEqual({ value: 2, angle: 20 });
  });

  it('ignores differences outside the window', () => {
    expect(beamTracking(a, b, 10).value).toBe(0);
  });
});
