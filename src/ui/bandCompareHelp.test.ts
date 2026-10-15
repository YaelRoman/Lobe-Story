import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELP_SECTIONS, helpAbout } from './glossary';

describe('comparing two antennas in Help and in the README', () => {
  it('Help has one section about it, in the words of the README', () => {
    const readme = readFileSync('README.md', 'utf8').replace(/\*\*/g, '').replace(/\s+/g, ' ');
    const sections = HELP_SECTIONS.filter((s) => s.topic === 'band-compare');
    expect(sections.map((s) => s.title)).toEqual(['Two antennas in Band statistics']);
    for (const line of sections[0].lines) expect(readme, line).toContain(line);
    for (const part of ['Compare with', 'No comparison', 'B − A', 'never graded', 'too few', '22 dB', 'excursion', 'both antennas', 'Copy table', 'Row column', 'saved with the project', 'unrounded statistics', 'up to 0.1']) {
      expect(helpAbout('band-compare')).toContain(part);
    }
  });
  it('docs/metrics.md says what B − A is for each kind of cell', () => {
    const doc = readFileSync('docs/metrics.md', 'utf8').replace(/\s+/g, ' ');
    expect(doc).toContain('**Two antennas compared.**');
    for (const part of ['double-sided', 'single-sided', 'gain at a tilt', 'tilt range', 'fewer than 10', '22 dB', 'original → tilted', 'dBi or dBd']) expect(doc).toContain(part);
  });
});
