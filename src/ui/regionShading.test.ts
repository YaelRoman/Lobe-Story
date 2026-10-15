import { describe, expect, it } from 'vitest';
import { typeARegions } from '../core/analysis/are';
import { horizontalCutSpans, rectPieces, regionCaption, regionCaptionText, verticalCutSpans, type RegionSpan } from './regionShading';

const width = (spans: RegionSpan[]) => spans.reduce((sum, s) => sum + (s.to - s.from), 0);
const of = (spans: RegionSpan[], region: RegionSpan['region']) => spans.filter((s) => s.region === region).map((s) => [s.from, s.to]);

/** The spans cover the circle once: sorted by start (mod 360), each begins where the previous ended. */
function coversOnce(spans: RegionSpan[]) {
  expect(width(spans)).toBeCloseTo(360, 9);
  const norm = spans.map((s) => ({ from: ((s.from % 360) + 360) % 360, w: s.to - s.from })).sort((a, b) => a.from - b.from);
  for (let k = 1; k < norm.length; k++) expect(norm[k].from).toBeCloseTo(norm[k - 1].from + norm[k - 1].w, 9);
  for (const s of spans) expect(s.to).toBeGreaterThan(s.from);
}

describe('verticalCutSpans: the Type A regions where they meet the vertical cut (0° = horizon in front, + below)', () => {
  it('gives the four elevation bands in front and the mirrored bands behind the antenna, outside the sector there', () => {
    // Peak 6°, HPBW 8°: upper to −2°, service from +2° to 75°.
    const spans = verticalCutSpans(typeARegions(6, 8, 60));
    coversOnce(spans);
    // Above the upper end in front (−2°) round the zenith to the mirrored −2° behind (182°): one band.
    expect(of(spans, 'upper')).toEqual([[182, 358]]);
    expect(of(spans, 'service')).toEqual([[2, 75]]);
    // In front between the upper region and the service region; behind, the whole middle band.
    expect(of(spans, 'interference')).toEqual([[-2, 2], [105, 182]]);
    // Round the nadir: 75° in front to 75° below the horizon behind (105°).
    expect(of(spans, 'lower')).toEqual([[75, 105]]);
  });

  it('stops the upper region at the horizon when the beam\'s half-power span lies below it (min(0°, P − B))', () => {
    const spans = verticalCutSpans(typeARegions(12, 8, 45));
    coversOnce(spans);
    expect(of(spans, 'upper')).toEqual([[180, 360]]);
    expect(of(spans, 'interference')).toEqual([[0, 8], [105, 180]]);
    expect(of(spans, 'service')).toEqual([[8, 75]]);
  });

  it('follows an up-tilted beam and very wide and very narrow beams', () => {
    const up = verticalCutSpans(typeARegions(-3, 10, 60));
    coversOnce(up);
    expect(of(up, 'service')).toEqual([[-8, 75]]);
    expect(of(up, 'upper')).toEqual([[193, 347]]);
    const wide = verticalCutSpans(typeARegions(0, 25, 60));
    coversOnce(wide);
    expect(of(wide, 'interference')).toEqual([[-25, -12.5], [105, 205]]);
    const narrow = verticalCutSpans(typeARegions(6, 0.5, 60));
    coversOnce(narrow);
    expect(of(narrow, 'upper')).toEqual([[180, 360]]);
    expect(of(narrow, 'interference')[0]).toEqual([0, 5.75]);
  });

  it('leaves out an empty region (upper region from the zenith to the zenith)', () => {
    const spans = verticalCutSpans(typeARegions(-70, 25, 60));
    coversOnce(spans);
    expect(of(spans, 'upper')).toEqual([]);
  });

  it('has service behind the antenna too when the sector is the whole circle, and none in front without a sector', () => {
    const all = verticalCutSpans(typeARegions(6, 8, 180));
    coversOnce(all);
    expect(of(all, 'service')).toEqual([[2, 75], [105, 178]]);
    const none = verticalCutSpans(typeARegions(6, 8, 0));
    coversOnce(none);
    expect(of(none, 'service')).toEqual([]);
    expect(of(none, 'interference')).toEqual([[-2, 75], [105, 182]]);
  });
});

describe('horizontalCutSpans: the regions along the horizontal cut', () => {
  it('through the beam peak: service within ±S, interference the rest, turned with the azimuth', () => {
    const r = typeARegions(6, 8, 60);
    const spans = horizontalCutSpans(r, false, 0);
    coversOnce(spans);
    expect(of(spans, 'service')).toEqual([[-60, 60]]);
    expect(of(spans, 'interference')).toEqual([[60, 300]]);
    expect(of(horizontalCutSpans(r, false, 30), 'service')).toEqual([[-30, 90]]);
  });

  it('at the horizon: the same while the horizon lies inside the service elevations, else all interference', () => {
    // Peak 2°, HPBW 8°: service from −2°, the horizon is inside it.
    expect(of(horizontalCutSpans(typeARegions(2, 8, 60), true, 0), 'service')).toEqual([[-60, 60]]);
    // Peak 12°, HPBW 8°: service from +8°, the horizon is above it.
    const above = horizontalCutSpans(typeARegions(12, 8, 60), true, 0);
    coversOnce(above);
    expect(above).toEqual([{ region: 'interference', from: -180, to: 180 }]);
  });

  it('a sector of the whole circle is all service', () => {
    expect(horizontalCutSpans(typeARegions(6, 8, 180), false, 0)).toEqual([{ region: 'service', from: -180, to: 180 }]);
  });
});

describe('rectPieces: a span on the rectangular axis −180…180', () => {
  it('splits a span across ±180° and keeps one inside', () => {
    expect(rectPieces(-60, 60)).toEqual([[-60, 60]]);
    expect(rectPieces(60, 300)).toEqual([[60, 180], [-180, -60]]);
    expect(rectPieces(182, 358)).toEqual([[-178, -2]]);
    expect(rectPieces(105, 182)).toEqual([[105, 180], [-180, -178]]);
    expect(rectPieces(180, 360)).toEqual([[-180, 0]]);
    expect(rectPieces(-180, 180)).toEqual([[-180, 180]]);
  });
});

describe('regionCaption: the text alternative of the shading', () => {
  it('names the file and every band of the vertical cut in degrees, with its colour', () => {
    const c = regionCaption('V', typeARegions(6.3, 8, 60), false, 'f.msi');
    const text = regionCaptionText(c);
    expect(text).toContain('f.msi');
    expect(text).toContain('upper (blue) −90° to −1.7°');
    expect(text).toContain('interference (orange) −1.7° to +2.3°');
    expect(text).toContain('service (green) +2.3° to +75° within ±60° of boresight');
    expect(text).toContain('lower (purple) +75° to +90°');
    expect(text).toMatch(/behind the antenna/i);
  });

  it('says where the horizontal cut lies and what that makes of it', () => {
    expect(regionCaptionText(regionCaption('H', typeARegions(6, 8, 60), false, 'f'))).toMatch(/service \(green\) within ±60°.*interference \(orange\) outside/);
    const above = regionCaptionText(regionCaption('H', typeARegions(12.4, 8, 60), true, 'f'));
    expect(above).toMatch(/horizon/);
    expect(above).toMatch(/all interference/);
    expect(above).toContain('+8.4°');
  });

  it('names the sector against the pointing direction, with the plot angles it is drawn over, when the plot is turned', () => {
    const r = typeARegions(6.3, 8, 60);
    expect(regionCaptionText(regionCaption('H', r, false, 'f', 30))).toContain('service (green) within ±60° of the pointing direction (30°), drawn −30° to 90°');
    // Across ±180°, as the axis labels it.
    expect(regionCaptionText(regionCaption('H', r, false, 'f', -150))).toContain('within ±60° of the pointing direction (−150°), drawn 150° to −90°');
    // Unturned: as before; the vertical cut is never turned.
    expect(regionCaptionText(regionCaption('H', r, false, 'f'))).toContain('service (green) within ±60°; interference');
    expect(regionCaptionText(regionCaption('V', r, false, 'f', 30))).toBe(regionCaptionText(regionCaption('V', r, false, 'f')));
  });

  it('says "tinted", not "shaded" (the markers\' caption calls the beamwidth wedge shaded)', () => {
    expect(regionCaption('V', typeARegions(6, 8, 60), false, 'f').lead).toMatch(/^Tinted: angular regions \(est\.\) of f/);
  });
});
