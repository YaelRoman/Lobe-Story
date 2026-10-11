import { describe, expect, it } from 'vitest';
import { releaseGlContexts, type GlCanvas } from './glContexts';

/** A canvas as far as releasing goes: on the page or not, with a context of one kind (or none). */
function canvas(kind: 'webgl' | 'webgl2' | '2d' | null, isConnected: boolean) {
  const state = { lost: 0, asked: [] as string[] };
  const context = { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => void state.lost++ } : null) };
  const c: GlCanvas = {
    isConnected,
    // The browser's rule: a canvas answers only for the kind of context it already has.
    getContext: (type) => {
      state.asked.push(type);
      return type === kind ? context : null;
    },
  };
  return { c, state };
}

describe('releaseGlContexts', () => {
  it('releases the context of every canvas that has left the page and leaves the ones still drawn alone', () => {
    const gone = canvas('webgl', false);
    const gone2 = canvas('webgl2', false);
    const kept = canvas('webgl', true);
    expect(releaseGlContexts([gone.c, kept.c, gone2.c])).toBe(2);
    expect([gone.state.lost, gone2.state.lost, kept.state.lost]).toEqual([1, 1, 0]);
    // A canvas that stays is not even asked for its context.
    expect(kept.state.asked).toEqual([]);
  });

  it('releases every canvas when the chart itself is going away', () => {
    const a = canvas('webgl', true);
    const b = canvas('webgl', false);
    expect(releaseGlContexts([a.c, b.c], 'all')).toBe(2);
    expect([a.state.lost, b.state.lost]).toEqual([1, 1]);
  });

  it('skips a canvas without a WebGL context, one whose context cannot be released, and one that throws', () => {
    const flat = canvas('2d', false);
    const none = canvas(null, false);
    const noExtension: GlCanvas = { isConnected: false, getContext: () => ({ getExtension: () => null }) };
    const throws: GlCanvas = {
      isConnected: false,
      getContext: () => {
        throw new Error('context creation failed');
      },
    };
    expect(releaseGlContexts([flat.c, none.c, noExtension, throws])).toBe(0);
    expect(releaseGlContexts([])).toBe(0);
  });
});
