import { describe, expect, it } from 'vitest';
import { fittingHead } from './midFit';

/** Every character 10 wide, the ellipsis too. */
const mono = (text: string) => text.length * 10;

describe('how much of the start of a name is kept when it is cut in the middle', () => {
  it('keeps as many characters as fit together with the ellipsis', () => {
    // "example_1" + "…" is 100 wide.
    expect(fittingHead('example_1700_', 100, mono)).toBe(9);
    expect(fittingHead('example_1700_', 109, mono)).toBe(9);
    expect(fittingHead('example_1700_', 110, mono)).toBe(10);
  });

  it('never keeps the whole start (a cut is asked for only when it does not fit), and at least one character', () => {
    expect(fittingHead('abcdef', 1000, mono)).toBe(5);
    expect(fittingHead('abcdef', 0, mono)).toBe(1);
    expect(fittingHead('abcdef', -50, mono)).toBe(1);
    expect(fittingHead('a', 0, mono)).toBe(1);
  });

  it('goes by the measured width, whatever the characters are', () => {
    const wide = (text: string) => [...text].reduce((w, c) => w + (c === 'W' ? 30 : c === '…' ? 12 : 5), 0);
    // "WW" + "…" = 72, "WWi" + "…" = 77, "WWii" + "…" = 82.
    expect(fittingHead('WWiiii', 80, wide)).toBe(3);
    expect(fittingHead('WWiiii', 72, wide)).toBe(2);
  });

  it('does not cut between the two halves of one character', () => {
    // "a😀b": cutting after two code units would leave half of the emoji.
    const n = fittingHead('a😀bcd', 25, mono);
    expect('a😀bcd'.slice(0, n)).toBe('a');
    expect(fittingHead('a😀bcd', 45, mono)).toBe(3);
  });
});
