import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELP_SECTIONS, helpAbout } from './glossary';

describe('the line in Help and in the README', () => {
  it('Help has one section about it, in the words of the README', () => {
    const readme = readFileSync('README.md', 'utf8').replace(/\*\*/g, '').replace(/\s+/g, ' ');
    const sections = HELP_SECTIONS.filter((s) => s.topic === 'not-default');
    expect(sections.map((s) => s.title)).toEqual(['Not at default']);
    for (const line of sections[0].lines) expect(readme, line).toContain(line);
    for (const part of ['Numbers at default', 'under the toolbar', 'puts that one thing back', 'Ctrl/Cmd+Z', 'Ticked files only', 'azimuth']) expect(helpAbout('not-default')).toContain(part);
  });
});
