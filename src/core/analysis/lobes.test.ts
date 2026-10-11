import { describe, expect, it } from 'vitest';
import { beamwidth } from './beamwidth';
import { frontToBack } from './frontToBack';
import {
  elevationSidelobes,
  FIRST_LOBE_RANGE,
  firstLobe,
  horizontalSls,
  MERGED_LOBE_AT,
  MIN_PROMINENCE_DB,
  SLS_NOT_AVAILABLE_DB,
  upperWindow,
} from './sidelobes';
import { beamTracking } from './tracking';
import { gridFrom, hBeamWithLobes, pwl, quadBeam, rippleTop, vBeamWithLobes, vFarLobes, vHighFarLobe } from '../../test/synthetic';

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

describe('BASTA 12.5 elevation sidelobes', () => {
  const v = gridFrom(vBeamWithLobes);

  it('exports the rule constants', () => {
    expect(FIRST_LOBE_RANGE).toBe(1.78);
    expect(MERGED_LOBE_AT).toBe(1.55);
    expect(SLS_NOT_AVAILABLE_DB).toBe(22);
    expect(MIN_PROMINENCE_DB).toBe(0.5);
  });

  it('sanity: the synthetic beam has HPBW 8° at +6°', () => {
    const beam = beamwidth(v);
    expect(beam.hpbw.value).toBeCloseTo(8, 5);
    expect(beam.direction.value).toBeCloseTo(6, 5);
  });

  it('finds the first distinct lobe on each side', () => {
    const up = firstLobe(v, 'upper');
    expect(up.lobe.value).toBeCloseTo(18, 6);
    expect(up.lobe.angle).toBeCloseTo(-8, 6);
    expect(up.lobe.kind).toBe('peak');
    expect(up.fill.value).toBeCloseTo(30, 6);
    expect(up.fill.angle).toBeCloseTo(-3, 6);
    expect(up.startDeg).toBe(9);
    const down = firstLobe(v, 'lower');
    expect(down.lobe.value).toBeCloseTo(15, 6);
    expect(down.lobe.angle).toBeCloseTo(19, 6);
    expect(down.fill.value).toBeCloseTo(22, 6);
    expect(down.fill.angle).toBeCloseTo(16, 6);
    expect(down.startDeg).toBe(10);
  });

  it('computes the six elevation metrics for a beam with distinct lobes', () => {
    const r = elevationSidelobes(v);
    for (const [res, val, ang] of [
      [r.firstUsls, 18, -8],
      [r.usls, 18, -8],
      [r.uslsHorizon, 18, -8],
      [r.uslsMax, 18, -8],
      [r.nullFill, 22, 16],
      [r.firstLsls, 15, 19],
    ] as const) {
      expect(res.value).toBeCloseTo(val, 6);
      expect(res.angle).toBeCloseTo(ang, 6);
      expect('notAvailable' in res).toBe(false);
    }
    expect(r.firstUsls.reason).toBeUndefined();
  });

  it('reports a portion of a sidelobe when the window cuts it (12.5.3 b)', () => {
    const r = elevationSidelobes(v, 10).usls;
    expect(r.value).toBeCloseTo(27.6, 6);
    expect(r.angle).toBeCloseTo(-4, 6);
  });

  it('reports "not available" when only the main beam is in the window (12.5.3 c)', () => {
    const r = elevationSidelobes(v, 8);
    expect(r.usls.value).toBeNull();
    expect(r.usls.notAvailable).toBe(true);
    expect(r.usls.reason).toMatch(/only the main beam/);
    expect(r.uslsHorizon.value).toBeCloseTo(18, 6);
    expect(r.uslsHorizon.angle).toBeCloseTo(-8, 6);
  });

  it('treats a smooth beam as a merged lobe at 1.55 × V-HPBW (12.5.3 a)', () => {
    const r = elevationSidelobes(gridFrom(quadBeam(8, 6)));
    expect(r.firstUsls.value).toBeCloseTo(28.875, 6);
    expect(r.firstUsls.angle).toBeCloseTo(-6.4, 6);
    expect(r.firstUsls.kind).toBe('merged');
    expect(r.firstUsls.reason).toMatch(/above the peak/);
    expect(r.nullFill.value).toBeCloseTo(28.875, 6);
    expect(r.nullFill.angle).toBeCloseTo(18.4, 6);
    expect(r.nullFill.kind).toBe('merged');
    expect(r.nullFill.reason).toMatch(/below the peak/);
    expect(r.firstLsls.value).toBeCloseTo(r.nullFill.value as number, 6);
    expect(r.firstLsls.angle).toBeCloseTo(18.4, 6);
    for (const w of [r.usls, r.uslsHorizon, r.uslsMax]) {
      expect(w.value).toBeCloseTo(28.875, 6);
      expect(w.angle).toBeCloseTo(-6.4, 6);
    }
  });

  it('handles broad beams whose merged position leaves a window', () => {
    const r = elevationSidelobes(gridFrom(quadBeam(16, 6)));
    expect(r.firstUsls.value).toBeCloseTo(28.8375, 6);
    expect(r.firstUsls.angle).toBeCloseTo(-18.8, 6);
    expect(r.usls.value).toBeNull();
    expect(r.usls.notAvailable).toBe(true);
    expect(r.uslsHorizon.value).toBeCloseTo(28.8375, 6);
    expect(r.uslsHorizon.angle).toBeCloseTo(-18.8, 6);
    expect(r.uslsMax.value).toBeCloseTo(28.8375, 6);
    expect(r.uslsMax.angle).toBeCloseTo(-18.8, 6);
    const flat0 = elevationSidelobes(gridFrom(quadBeam(16, 0)));
    expect(flat0.usls.notAvailable).toBe(true);
    expect(flat0.uslsHorizon.notAvailable).toBe(true);
    expect(flat0.uslsMax.value).toBeCloseTo(28.8375, 6);
    expect(flat0.uslsMax.angle).toBeCloseTo(-24.8, 6);
  });

  it('gives up when 1.78 × V-HPBW exceeds 90°', () => {
    const r = elevationSidelobes(gridFrom(quadBeam(60, 6)));
    for (const x of [r.firstUsls, r.usls, r.uslsHorizon, r.uslsMax, r.nullFill, r.firstLsls]) {
      expect(x.value).toBeNull();
      expect(x.reason).toMatch(/too wide/);
    }
    expect(r.usls.notAvailable).toBeUndefined();
  });

  it('is null with "HPBW undefined" for a flat cut', () => {
    const r = elevationSidelobes(gridFrom(() => 0));
    for (const x of [r.firstUsls, r.usls, r.uslsHorizon, r.uslsMax, r.nullFill, r.firstLsls]) {
      expect(x.value).toBeNull();
      expect(x.reason).toBe('HPBW undefined');
    }
  });

  it('applies the merged rule to a lobe beyond 1.78 × V-HPBW but still counts it in the window', () => {
    const r = elevationSidelobes(gridFrom(vFarLobes));
    expect(r.firstUsls.value).toBeCloseTo(23.2, 6);
    expect(r.firstUsls.angle).toBeCloseTo(-6.4, 6);
    expect(r.firstUsls.kind).toBe('merged');
    expect(r.usls.value).toBeCloseTo(18, 6);
    expect(r.usls.angle).toBeCloseTo(-9, 6);
    expect(r.nullFill.value).toBeCloseTo(18.64, 6);
    expect(r.nullFill.angle).toBeCloseTo(18.4, 6);
    expect(r.nullFill.kind).toBe('merged');
  });

  it('keeps a far lobe out of the peak-to-20° window but in the maximum', () => {
    const r = elevationSidelobes(gridFrom(vHighFarLobe));
    expect(r.usls.value).toBeCloseTo(18, 6);
    expect(r.usls.angle).toBeCloseTo(-8, 6);
    expect(r.uslsHorizon.value).toBeCloseTo(18, 6);
    expect(r.uslsHorizon.angle).toBeCloseTo(-8, 6);
    expect(r.uslsMax.value).toBeCloseTo(10, 6);
    expect(r.uslsMax.angle).toBeCloseTo(-24, 6);
  });

  it('does not report a dip on the beam top as a sidelobe', () => {
    const r = elevationSidelobes(gridFrom(rippleTop));
    // Peak sample +4°, refined peak 4 − 1/6 = 23/6°, merged point at 31° from it: −27 − 1/6° and 34 + 5/6°.
    expect(r.firstUsls.value).toBeCloseTo(25.95 + 1.35 / 6, 6);
    expect(r.firstUsls.angle).toBeCloseTo(-27 - 1 / 6, 6);
    expect(r.firstUsls.kind).toBe('merged');
    expect(r.firstLsls.value).toBeCloseTo(30, 6);
    expect(r.firstLsls.angle).toBeCloseTo(34 + 5 / 6, 6);
  });
});

describe('sidelobe scan prominence (F1)', () => {
  // 8° beam at 0°; on the upper flank a 0.1 dB ripple (null 8.1 @ -7, lobe 8.0 @ -8), then a real null
  // 28 @ -10 and a real 18 dB lobe @ -14 (14° from the peak, inside 1.78 × 8° = 14.24°).
  const rippleFlank = pwl([[-180, 30], [-18, 30], [-14, 18], [-10, 28], [-8, 8], [-7, 8.1], [-6, 8], [-4, 3], [0, 0], [4, 3], [8, 12], [12, 22], [16, 15], [20, 30], [180, 30]]);

  it('skips a 0.1 dB flank ripple and reports the real lobe and null', () => {
    const up = firstLobe(gridFrom(rippleFlank), 'upper');
    expect(up.lobe.value).toBeCloseTo(18, 6);
    expect(up.lobe.angle).toBeCloseTo(-14, 6);
    expect(up.lobe.kind).toBe('peak');
    expect(up.fill.value).toBeCloseTo(28, 6);
    expect(up.fill.angle).toBeCloseTo(-10, 6);
    expect(up.startDeg).toBe(10);
  });

  it('still counts a lobe with 0.6 dB prominence', () => {
    const f = pwl([[-180, 30], [-14, 30], [-11, 19.4], [-8, 20], [-4, 3], [0, 0], [4, 3], [8, 12], [12, 22], [16, 15], [20, 30], [180, 30]]);
    const up = firstLobe(gridFrom(f), 'upper');
    expect(up.lobe.kind).toBe('peak');
    expect(up.lobe.value).toBeCloseTo(19.4, 6);
    expect(up.lobe.angle).toBeCloseTo(-11, 6);
    expect(up.fill.value).toBeCloseTo(20, 6);
    expect(up.fill.angle).toBeCloseTo(-8, 6);
  });

  it('ignores a 0.05 dB azimuth flank ripple: no sidelobe inside the sector', () => {
    // null 8.05 @ +7, lobe 8.0 @ +8 on the flank; the real nulls (30 dB) are at ±70°, beyond the ±60° sector.
    const h = pwl([[-180, 30], [-110, 30], [-90, 20], [-70, 30], [-10, 15], [-4, 3], [0, 0], [4, 3], [6, 8], [7, 8.05], [8, 8], [10, 15], [70, 30], [90, 20], [110, 30], [180, 30]]);
    expect(horizontalSls(gridFrom(h), 60)).toEqual({ value: null, reason: 'No sidelobe inside the ±60° sector' });
    const wide = horizontalSls(gridFrom(h), 80);
    expect(wide.value).toBeCloseTo(25, 6); // halfway up the 30 → 20 dB segment
    expect(Math.abs(wide.angle!)).toBeCloseTo(80, 6); // symmetric: the first (−80°) wins the tie
  });
});

describe('peak-centred distances (F2)', () => {
  // Flat top 4…8° (centre 6°), HPBW 10°, 18 dB lobes 16° either side of the centre (-10° and 22°).
  const flat = pwl([[-180, 30], [-15, 30], [-10, 18], [-5, 30], [1, 3], [4, 0], [8, 0], [11, 3], [17, 30], [22, 18], [27, 30], [180, 30]]);

  it('classifies both sides of a symmetric flat-topped beam the same way', () => {
    const g = gridFrom(flat);
    expect(beamwidth(g).hpbw.value).toBeCloseTo(10, 6);
    const up = firstLobe(g, 'upper');
    const down = firstLobe(g, 'lower');
    for (const [side, ang] of [[up, -10], [down, 22]] as const) {
      expect(side.lobe.kind).toBe('peak');
      expect(side.lobe.value).toBeCloseTo(18, 6);
      expect(side.lobe.angle).toBeCloseTo(ang, 6);
      expect(side.fill.kind).toBe('peak');
    }
    expect(elevationSidelobes(g).firstLsls.kind).toBe('peak');
  });

  it('measures the merged position from the plateau centre', () => {
    // 0 dB plateau 0…3° (centre 1.5°), parabolic flanks: HPBW 13°, no lobes.
    const g = gridFrom((a) => quadBeam(10)(a < 0 ? a : a > 3 ? a - 3 : 0));
    const d = MERGED_LOBE_AT * beamwidth(g).hpbw.value!;
    expect(d).toBeCloseTo(20.15, 6);
    expect(firstLobe(g, 'lower').lobe.angle).toBeCloseTo(1.5 + d, 6);
    expect(firstLobe(g, 'upper').lobe.angle).toBeCloseTo(1.5 - d, 6);
    expect(firstLobe(g, 'lower').startDeg).toBeCloseTo(d, 6);
  });
});

describe('configurable first-lobe limit (F3)', () => {
  // 8° beam, null 28 @ -12, lobe 18 @ -16 = 2.0 × HPBW.
  const far = pwl([[-180, 30], [-20, 30], [-16, 18], [-12, 28], [-4, 3], [0, 0], [4, 3], [8, 12], [12, 22], [16, 15], [20, 30], [180, 30]]);

  it('merges a lobe at 2.0 × HPBW at the default factor 1.78', () => {
    const r = firstLobe(gridFrom(far), 'upper');
    expect(r.lobe.kind).toBe('merged');
    expect(r.lobe.angle).toBeCloseTo(-12.4, 6);
    expect(r.lobe.value).toBeCloseTo(27, 6);
  });

  it('reports the real lobe at factor 2.5', () => {
    const r = elevationSidelobes(gridFrom(far), 20, 2.5);
    expect(r.firstUsls.kind).toBe('peak');
    expect(r.firstUsls.value).toBeCloseTo(18, 6);
    expect(r.firstUsls.angle).toBeCloseTo(-16, 6);
    expect(r.usls.value).toBeCloseTo(18, 6);
  });

  it('searches up to 90° instead of giving up when the factor is above 1.78', () => {
    const wide = gridFrom(quadBeam(55, 0));
    expect(firstLobe(wide, 'upper').lobe.reason).toMatch(/too wide/);
    const r = firstLobe(wide, 'upper', 3);
    expect(r.lobe.value).not.toBeNull();
    expect(r.lobe.kind).toBe('merged');
  });
});

describe('upperWindow (F5)', () => {
  // Peak 6° (integer), then a constant 20 dB beyond 4° from the peak.
  const g = gridFrom((a) => (Math.abs(a - 6) <= 4 ? 0.75 * Math.abs(a - 6) : 20));

  it('includes a fractional region start as a candidate and prefers it on ties (nearest the peak)', () => {
    const r = upperWindow(g, 12.4, -20, 6);
    expect(r.value).toBeCloseTo(20, 6);
    expect(r.angle).toBeCloseTo(-6.4, 6);
  });

  it('counts an integer region start once, at its own angle', () => {
    const r = upperWindow(g, 12, -20, 6);
    expect(r.value).toBeCloseTo(20, 6);
    expect(r.angle).toBe(-6);
  });

  it('keeps the highest angle on a tie when the region start is outside the window', () => {
    const r = upperWindow(g, 12.4, -20, -10);
    expect(r.angle).toBe(-10);
  });

  it('is not available when the window lies in the main beam', () => {
    const r = upperWindow(g, 12.4, -5, 6);
    expect(r.value).toBeNull();
    expect(r.notAvailable).toBe(true);
    expect(r.reason).toMatch(/only the main beam/);
  });

  it('says so when the beam peak is above the window (F4)', () => {
    const r = upperWindow(g, 12.4, 10, 20);
    expect(r.notAvailable).toBe(true);
    expect(r.reason).toMatch(/beam peak is above this window/);
    const horizon = elevationSidelobes(gridFrom(quadBeam(8, -30))).uslsHorizon;
    expect(horizon.notAvailable).toBe(true);
    expect(horizon.reason).toMatch(/beam peak is above/);
    expect(elevationSidelobes(gridFrom(quadBeam(16, 0))).uslsHorizon.reason).toMatch(/only the main beam/);
  });

  it('builds the merged reason from the constant', () => {
    expect(firstLobe(gridFrom(quadBeam(8, 6)), 'upper').lobe.reason).toContain(`${MERGED_LOBE_AT} × V-HPBW above`);
  });
});

describe('horizontalSls', () => {
  const h = gridFrom(hBeamWithLobes);

  it('takes the highest level beyond the first null on either side', () => {
    for (const edge of [60, 38]) {
      const r = horizontalSls(h, edge);
      expect(r.value).toBeCloseTo(12, 6);
      expect(r.angle).toBeCloseTo(35, 6);
    }
  });

  it('reports a portion of a lobe at the sector edge', () => {
    const r = horizontalSls(h, 33);
    expect(r.value).toBeCloseTo(14.6, 6);
    expect(r.angle).toBeCloseTo(33, 6);
  });

  it('accepts just the null sample', () => {
    const r = horizontalSls(h, 25);
    expect(r.value).toBeCloseTo(25, 6);
    expect(r.angle).toBeCloseTo(25, 6);
  });

  it('is null when the sector ends before the first null', () => {
    expect(horizontalSls(h, 24)).toEqual({ value: null, reason: 'No sidelobe inside the ±24° sector' });
  });

  it('follows a steered beam', () => {
    const steered = gridFrom((a) => hBeamWithLobes(a - 10));
    const r60 = horizontalSls(steered, 60);
    expect(r60.value).toBeCloseTo(12, 6);
    expect(r60.angle).toBeCloseTo(45, 6);
    const r30 = horizontalSls(steered, 30);
    expect(r30.value).toBeCloseTo(14, 6);
    expect(r30.angle).toBeCloseTo(-30, 6);
  });

  it('is null for smooth, rippled and flat beams', () => {
    const none = { value: null, reason: 'No sidelobe inside the ±60° sector' };
    expect(horizontalSls(gridFrom(quadBeam(60)))).toEqual(none);
    expect(horizontalSls(gridFrom(rippleTop))).toEqual(none);
    expect(horizontalSls(gridFrom(() => 0))).toEqual({ value: null, reason: 'HPBW undefined' });
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
