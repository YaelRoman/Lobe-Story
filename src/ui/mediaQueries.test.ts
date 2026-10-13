import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COARSE_QUERY, DRAWER_QUERY, PHONE_QUERY, SHORT_QUERY } from './phoneLayout';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

describe('the media queries asked by the code are the ones the stylesheet uses', () => {
  it.each([
    ['phone layout', PHONE_QUERY],
    ['short window', SHORT_QUERY],
    ['file panel as a drawer', DRAWER_QUERY],
  ])('%s', (_name, query) => {
    expect(css).toContain(`@media ${query} {`);
  });

  it('the larger targets come with the phone layout or a coarse pointer, whatever the width', () => {
    expect(css).toContain(`@media ${PHONE_QUERY}, ${COARSE_QUERY} {`);
  });

  it('nothing but the drawer and the short window goes by 900 px, and the short window is the drawer made short', () => {
    expect(SHORT_QUERY).toBe(`(max-height: 600px) and ${DRAWER_QUERY}`);
    const queries = [...css.matchAll(/@media ([^{]+) \{/g)].map((m) => m[1]);
    expect([...new Set(queries)].sort()).toEqual([`${PHONE_QUERY}, ${COARSE_QUERY}`, DRAWER_QUERY, PHONE_QUERY, SHORT_QUERY].sort());
  });
});
