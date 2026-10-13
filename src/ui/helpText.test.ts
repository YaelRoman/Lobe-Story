import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, HELP_SECTIONS, helpAbout } from './glossary';
import { SETTING_HELP, SETTING_LABELS } from './settingsHelp';
import { METHOD_UNUSED_NOTE } from './simSummary';
import { DBI_OVER_DBD } from '../core/gain';

const entry = (term: string): string => {
  const found = GLOSSARY.find((g) => g.term === term);
  if (!found) throw new Error(`no glossary entry "${term}"`);
  return found.text;
};
/** The metric definitions, as one text with single spaces (the file is wrapped at about 100 columns). */
const metricsDoc = readFileSync('docs/metrics.md', 'utf8').replace(/\s+/g, ' ');

describe('the glossary: terms the page uses and a newcomer does not know', () => {
  it('has an entry for each of them', () => {
    for (const term of ['Planet file', 'Co-polar', 'Boresight', 'dBd / dBi', 'Simulation sliders', '3D method (Summation / Weighted)', 'Peak az / Peak tilt', 'Tilt error', 'First LSLS / First USLS', 'H-SLS']) expect(() => entry(term), term).not.toThrow();
    // No term twice.
    expect(new Set(GLOSSARY.map((g) => g.term)).size).toBe(GLOSSARY.length);
  });

  it('the new entries are short: a few sentences, not a page', () => {
    for (const term of ['Planet file', 'Co-polar', 'Boresight', 'dBd / dBi', '3D method (Summation / Weighted)', 'Peak az / Peak tilt', 'Tilt error', 'First LSLS / First USLS', 'H-SLS']) expect(entry(term).length, term).toBeLessThanOrEqual(420);
  });

  it('the sliders: an electrical tilt Δ against a mechanical tilt, and the azimuth as a pointing direction', () => {
    const text = entry('Simulation sliders');
    for (const part of ['Electrical tilt Δ', 'added to the tilt a file already has', 'Mechanical tilt tips the whole antenna', 'Azimuth is a pointing direction', 'the metrics are not affected']) expect(text).toContain(part);
    // As the metric definitions say it.
    expect(metricsDoc).toContain('**Electrical tilt Δ** changes the electrical tilt of every file by that much, added to the tilt the file already has');
    expect(metricsDoc).toContain('**Mechanical tilt** tips the whole antenna');
    expect(metricsDoc).toContain('**Azimuth** is a pointing direction, for a site view');
  });

  it('dBd and dBi: what each is against, and the 2.15 dB between them', () => {
    const text = entry('dBd / dBi');
    expect(DBI_OVER_DBD).toBe(2.15);
    for (const part of ['isotropic', 'half-wave dipole', 'dBi = dBd + 2.15', 'read as dBd']) expect(text).toContain(part);
  });

  it('the 3D method: what the two rules do, and what uses the choice (as the Simulation bar says)', () => {
    const text = entry('3D method (Summation / Weighted)');
    for (const part of ['from the two cuts', 'Summation', 'Weighted', 'cross-weighted', 'more power away from the two cut planes']) expect(text).toContain(part);
    expect(METHOD_UNUSED_NOTE).toContain('the 3D view, a tilt, the horizon cut and the angular regions');
    expect(text).toContain('the 3D view, a tilt, the horizon cut and the angular regions');
    // The metric definitions describe the two rules in these words.
    expect(metricsDoc).toContain('With "Summation" this is the product of the two cuts in linear power; with "Weighted" it is the cross-weighted combination, which puts more power away from the two cut planes');
  });

  it('the beam and sidelobe columns say what the metric definitions say', () => {
    expect(entry('Peak az / Peak tilt')).toContain('strongest');
    expect(entry('Peak az / Peak tilt')).toContain('asymmetric');
    expect(metricsDoc).toContain('Peak az and Peak tilt can differ from Squint and Tilt on asymmetric beams');
    expect(entry('Tilt error')).toContain('Tilt minus the nominal tilt of the file');
    expect(entry('Tilt error')).toContain('Not available when the nominal tilt is unknown');
    expect(metricsDoc).toContain('Tilt minus the nominal tilt of the file, signed');
    expect(entry('First LSLS / First USLS')).toContain('1.55 × V-HPBW');
    expect(metricsDoc).toContain('its level is taken at 1.55 × V-HPBW from the peak');
    for (const part of ['inside the sector', 'beyond the first null', 'the usual case for a sector panel']) expect(entry('H-SLS')).toContain(part);
    expect(metricsDoc).toContain('beyond the first null on either side of the azimuth main beam. "—" if there is none, the usual case for a sector panel');
  });

  it('boresight, co-polar and the Planet file, as the conventions of the metric definitions', () => {
    expect(entry('Boresight')).toContain('azimuth 0°');
    expect(entry('Boresight')).toContain('not from the beam peak');
    expect(metricsDoc).toContain('Azimuth 0° is the mechanical boresight');
    expect(metricsDoc).toContain('the sector is not centred on the beam peak');
    expect(entry('Co-polar')).toContain('not total-power values');
    expect(metricsDoc).toContain('F/B and AIR are not total-power values');
    for (const part of ['HORIZONTAL', 'VERTICAL', 'One port and polarization, one frequency and one electrical tilt per file']) expect(entry('Planet file')).toContain(part);
    expect(metricsDoc).toContain('One port and polarization, one frequency, one electrical tilt per file');
  });
});

describe('the rest of Help: headed sections of a few short lines', () => {
  it('every section has a heading and at most five lines, none of them a paragraph', () => {
    expect(HELP_SECTIONS.length).toBeGreaterThanOrEqual(7);
    for (const s of HELP_SECTIONS) {
      expect(s.title.length, s.title).toBeGreaterThan(3);
      expect(s.title.length, s.title).toBeLessThanOrEqual(48);
      expect(s.lines.length, s.title).toBeGreaterThanOrEqual(1);
      expect(s.lines.length, s.title).toBeLessThanOrEqual(5);
      for (const line of s.lines) expect(line.length, `${s.title}: ${line.slice(0, 40)}`).toBeLessThanOrEqual(330);
    }
    expect(new Set(HELP_SECTIONS.map((s) => s.title)).size).toBe(HELP_SECTIONS.length);
  });

  it('the headings a reader looks for are there', () => {
    const titles = HELP_SECTIONS.map((s) => s.title);
    for (const t of ['File panel', 'Copying', 'Reference file', 'Frequency chart']) expect(titles).toContain(t);
    expect(titles.filter((t) => /horizon/i.test(t)).length).toBeGreaterThanOrEqual(2);
  });

  it('what is said about a subject can be read as one text', () => {
    expect(helpAbout('copying')).toContain('Copy table');
    expect(helpAbout('reference')).toContain('Use as reference');
    expect(helpAbout('panel')).toContain('filter box');
    expect(helpAbout('horizontal-cut').length).toBeGreaterThan(600);
  });
});

describe('Settings: one line of help per setting, the same as in the metric definitions', () => {
  it('each analysis setting has the line of its row in the table of docs/metrics.md', () => {
    for (const key of ['levelDb', 'fbWindowDeg', 'uslsRangeDeg', 'lobeLimitFactor', 'sectorEdgeDeg', 'siteSectors'] as const) {
      expect(SETTING_HELP[key].length, key).toBeGreaterThan(10);
      const row = new RegExp(`\\| ${SETTING_LABELS[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|[^|]*\\|[^|]*\\| ${SETTING_HELP[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`);
      expect(metricsDoc, key).toMatch(row);
    }
  });

  it('the plot floor and the two resets are explained there too, in the same words', () => {
    expect(metricsDoc).toContain(SETTING_HELP.floorDb);
    expect(metricsDoc).toContain(SETTING_HELP.reset);
    expect(metricsDoc).toContain(SETTING_HELP.resetPreferences);
    expect(SETTING_HELP.floorDb).toContain('no metric');
    expect(SETTING_HELP.resetPreferences).toContain('the browser forgets them');
  });
});
