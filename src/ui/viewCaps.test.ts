import { describe, expect, it } from 'vitest';
import { capItems, capNotice, MAX_2D_FILES, MAX_3D_OVERLAY, maxSurfaces } from './viewCaps';
import { MAX_3D } from './surfaceFigure';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ pattern: { id: `f${i}` } }));

describe('view caps', () => {
  it('are fixed numbers: the grid keeps its 6, the overlay is 12, the 2D plots 100', () => {
    expect(MAX_3D).toBe(6);
    expect(MAX_3D_OVERLAY).toBe(12);
    expect(MAX_2D_FILES).toBe(100);
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
