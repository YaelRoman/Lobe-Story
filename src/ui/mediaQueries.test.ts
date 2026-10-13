import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHONE_QUERY, SHORT_QUERY } from './phoneLayout';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

describe('the media queries asked by the code are the ones the stylesheet uses', () => {
  it.each([
    ['phone layout', PHONE_QUERY],
    ['short window', SHORT_QUERY],
  ])('%s', (_name, query) => {
    expect(css).toContain(`@media ${query} {`);
  });
});
