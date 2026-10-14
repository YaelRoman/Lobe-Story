import { describe, expect, it } from 'vitest';
import { capItems, capNotice, surfaceExportCaption, MAX_3D_OVERLAY, maxSurfaces } from './viewCaps';
import { MAX_3D } from './surfaceFigure';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ pattern: { id: `f${i}` } }));

describe('view caps', () => {
  it('are fixed numbers: the grid keeps its 6, the overlay is 12', () => {
    expect(MAX_3D).toBe(6);
    expect(MAX_3D_OVERLAY).toBe(12);
    expect(maxSurfaces('grid')).toBe(6);
    expect(maxSurfaces('overlay')).toBe(12);
  });
});

describe('capItems', () => {
  it('returns the very same list within the cap, whatever is highlighted', () => {
    const list = items(5);
    expect(capItems(list, 5, 'f4').shown).toBe(list);
  });
  it('keeps the first `cap` files in panel order above it', () => {
    const r = capItems(items(20), 12, null);
    expect(r.total).toBe(20);
    expect(r.shown.map((i) => i.pattern.id)).toEqual(items(12).map((i) => i.pattern.id));
  });
  it('puts the highlighted file first, even from beyond the cap, then the rest in order', () => {
    const r = capItems(items(20), 4, 'f15');
    expect(r.shown.map((i) => i.pattern.id)).toEqual(['f15', 'f0', 'f1', 'f2']);
    expect(capItems(items(20), 4, 'f2').shown.map((i) => i.pattern.id)).toEqual(['f2', 'f0', 'f1', 'f3']);
  });
  it('ignores a highlight that is not ticked', () => {
    expect(capItems(items(20), 3, 'nope').shown.map((i) => i.pattern.id)).toEqual(['f0', 'f1', 'f2']);
  });
});

describe('capNotice', () => {
  it('is silent without a cut and names the cap, the counts and how to choose otherwise', () => {
    expect(capNotice('The 3D overlay draws', 5, 5, 12)).toBeNull();
    const t = capNotice('The 3D overlay draws', 12, 40, 12)!;
    expect(t).toContain('The 3D overlay draws at most 12 files');
    expect(t).toContain('12 of the 40');
    expect(t).toContain('highlighted file first');
    expect(t).toContain('Only matches');
  });
});

describe('surfaceExportCaption', () => {
  it('says how many of the ticked files a capped 3D view shows, and nothing about it when all are drawn', () => {
    expect(surfaceExportCaption('overlay', 12, 40, 'summation', 40)).toMatchObject({ title: '3D radiation pattern, overlay', file: 'Showing 12 of 40 ticked files' });
    expect(surfaceExportCaption('grid', 6, 15, 'summation', 40).title).toBe('3D radiation pattern, side by side');
    expect(surfaceExportCaption('grid', 6, 15, 'summation', 40).file).toBe('Showing 6 of 15 ticked files');
    expect(surfaceExportCaption('overlay', 5, 5, 'summation', 40).file).toBeUndefined();
  });

  it('says what the page says above the view: the method, and that the shape is an estimate from two cuts (R4-08)', () => {
    expect(surfaceExportCaption('overlay', 3, 3, 'summation', 40).items[0]).toBe('Reconstructed from the H and V cuts (summation method): an estimate from two cuts, not measured data');
    expect(surfaceExportCaption('grid', 3, 3, 'weighted', 40).items[0]).toBe('Reconstructed from the H and V cuts (weighted method): an estimate from two cuts, not measured data');
  });

  it('says what the radius means, with the floor in use; side by side the colour means the same', () => {
    expect(surfaceExportCaption('overlay', 3, 3, 'summation', 40).items[1]).toBe('Radius: level relative to the peak, 0 dB outermost, the floor of −40 dB at the centre; one colour per file');
    expect(surfaceExportCaption('grid', 3, 3, 'summation', 55).items[1]).toBe('Radius and colour: level relative to the peak, 0 dB outermost, the floor of −55 dB at the centre');
    // A floor raised past a beamwidth level typed with many decimals: written with at most two.
    expect(surfaceExportCaption('grid', 3, 3, 'summation', 20.123456789012344).items[1]).toContain('the floor of −20.12 dB at the centre');
  });

  it('every line fits the caption width', () => {
    for (const layout of ['grid', 'overlay'] as const) for (const item of surfaceExportCaption(layout, 3, 3, 'summation', 100).items) expect(item.length).toBeLessThanOrEqual(110);
  });
});
