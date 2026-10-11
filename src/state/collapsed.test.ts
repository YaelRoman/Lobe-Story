import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from './store';

describe('folded controls default', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('are open without a window, and folded on a phone-width screen', () => {
    expect(initialState().view.collapsed).toEqual({ simBar: false, markers: false });
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q.includes('max-width: 760px') }) });
    expect(initialState().view.collapsed).toEqual({ simBar: true, markers: true });
  });
});
