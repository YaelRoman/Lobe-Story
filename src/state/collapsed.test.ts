import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from './store';

describe('folded controls default', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the simulation bar is folded everywhere, the marker options only on a phone-width screen', () => {
    expect(initialState().view.collapsed).toEqual({ simBar: true, markers: false });
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q.includes('max-width: 760px') }) });
    expect(initialState().view.collapsed).toEqual({ simBar: true, markers: true });
  });
});
