import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { groupColour, ladder, LADDER_LEVELS, PALETTE } from './colors';
import { FIGURE_THEMES } from './figureTheme';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

/** The custom properties declared in the first block that starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe.each([
  ['light', ':root {'],
  ['dark', ":root[data-theme='dark']"],
])('%s theme contrast (WCAG AA, 4.5:1)', (_name, selector) => {
  const t = tokens(selector);
  it.each(['bg', 'panel', 'hl'])('muted text on %s', (bg) => expect(ratio(t.muted, t[bg])).toBeGreaterThanOrEqual(4.5));
  it.each(['bg', 'panel', 'hl'])('warning text on %s', (bg) => expect(ratio(t.warn, t[bg])).toBeGreaterThanOrEqual(4.5));
  it.each(['bg', 'panel', 'hl'])('danger text on %s', (bg) => expect(ratio(t.danger, t[bg])).toBeGreaterThanOrEqual(4.5));
  it('white text on filled accent controls', () => expect(ratio('#ffffff', t['accent-fill'])).toBeGreaterThanOrEqual(4.5));
});

describe.each(['light', 'dark'] as const)('plot line colours on the %s theme background (graphical objects, 3:1)', (name) => {
  const bg = FIGURE_THEMES[name].bg;
  it('the figure background is the page background of the theme', () => {
    expect(bg).toBe(tokens(name === 'light' ? ':root {' : ":root[data-theme='dark']").bg);
  });
  // The palette is used as is up to ten files; above ten, colours go by group and the extreme shades of a group
  // (lightest and darkest of the ladder, a lone file's group colour) must still be seen against the plot background.
  it.each(PALETTE.map((_, k) => k))('the extreme shades of group colour %i', (k) => {
    const shades = [...ladder(groupColour(k), LADDER_LEVELS), ...ladder(groupColour(k), 2), groupColour(k)];
    for (const c of shades) expect(ratio(c, bg)).toBeGreaterThanOrEqual(3);
  });
});
