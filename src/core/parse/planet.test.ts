import { describe, expect, it } from 'vitest';
import { parsePlanet } from './planet';
import { DEFAULT_HEADERS, planetText, points } from '../../test/planetText';
import type { ParseResult } from '../types';

const beam = (a: number) => Math.min(40, Math.abs(a) / 2);

function expectOk(r: ParseResult) {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error} (line ${r.line})`);
  return r;
}

describe('parsePlanet', () => {
  it('parses a well-formed MSI file', () => {
    const r = expectOk(parsePlanet(planetText(), 'a.MSI'));
    expect(r.pattern).toMatchObject({
      id: 'a.MSI',
      fileName: 'a.MSI',
      name: 'TEST1',
      frequencyMHz: 1800,
      gain: { value: 15.2, unit: 'dBi' },
      tilt: 'ELECTRICAL',
      declared: {},
      extraHeaders: {},
    });
    expect(r.pattern.horizontal.angles).toHaveLength(360);
    expect(r.pattern.vertical.atten).toHaveLength(360);
    expect(r.pattern.horizontal.angles[359]).toBe(359);
    expect(r.warnings).toEqual([]);
  });

  it('parses tab-separated headers with trailing spaces and empty values', () => {
    const text = planetText({
      headers: [
        'FILENAME\tANT_Port 1 +45_05DT_0849',
        'MAKE\tACME',
        'FREQUENCY\t849 ',
        'H_WIDTH\t68',
        'V_WIDTH\t8.9 ',
        'FRONT_TO_BACK',
        'GAIN\t13.94 dBd',
        'TILT\tELECTRICAL',
      ],
      h: points(beam, '\t').flatMap((l, i) => (i === 10 ? ['', l] : [l])),
      v: points(beam, '\t'),
      eol: '\n',
    });
    const r = expectOk(parsePlanet(text, 'x.txt'));
    expect(r.pattern.name).toBe('ANT_Port 1 +45_05DT_0849');
    expect(r.pattern.make).toBe('ACME');
    expect(r.pattern.frequencyMHz).toBe(849);
    expect(r.pattern.gain).toEqual({ value: 13.94, unit: 'dBd' });
    expect(r.pattern.declared).toEqual({ hBeamwidth: 68, vBeamwidth: 8.9, frontToBack: undefined });
    expect(r.pattern.horizontal.angles).toHaveLength(360);
    expect(r.warnings).toEqual([]);
  });

  it('reads Vendor B-style headers with double-spaced gain and COMMENTS', () => {
    const text = planetText({
      headers: [
        'NAME XPOL26-A-1-5-806+',
        'MAKE Vendor B',
        'FREQUENCY 806.00',
        'GAIN 16.2  dBi',
        'TILT ELECTRICAL',
        'POLARIZATION Dual polarization',
        'COMMENTS Vendor B SH R&D',
        'ELECTRICAL_TILT 5.0',
      ],
    });
    const r = expectOk(parsePlanet(text, '-1-5-806+.pln'));
    expect(r.pattern.gain).toEqual({ value: 16.2, unit: 'dBi' });
    expect(r.pattern.comment).toBe('Vendor B SH R&D');
    expect(r.pattern.polarization).toBe('Dual polarization');
    expect(r.pattern.electricalTiltDeg).toBe(5);
  });

  it('rejects a file without a VERTICAL block', () => {
    const text = [...DEFAULT_HEADERS, 'HORIZONTAL 360', ...points(beam)].join('\n');
    expect(parsePlanet(text, 'x.pln')).toEqual({ ok: false, error: 'Missing VERTICAL block' });
  });

  it('rejects a block with fewer points than declared, pointing at the block header', () => {
    const r = parsePlanet(planetText({ h: points(beam).slice(0, 10), hCount: 360 }), 'x.pln');
    expect(r).toEqual({ ok: false, error: 'HORIZONTAL block declares 360 points but only 10 found', line: 5 });
  });

  it('rejects non-numeric data with its line number', () => {
    const r = parsePlanet(planetText({ h: ['0.0 abc', ...points(beam).slice(1)] }), 'x.pln');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/^Non-numeric value in HORIZONTAL block/);
    expect(r.line).toBe(6);
  });

  it('rejects missing or non-numeric FREQUENCY', () => {
    const noFreq = planetText({ headers: ['NAME X', 'GAIN 1 dBd'] });
    expect(parsePlanet(noFreq, 'x')).toEqual({ ok: false, error: 'Missing FREQUENCY' });
    const badFreq = planetText({ headers: ['NAME X', 'FREQUENCY abc', 'GAIN 1 dBd'] });
    expect(parsePlanet(badFreq, 'x')).toEqual({ ok: false, error: 'Non-numeric FREQUENCY "abc"', line: 2 });
  });

  it('rejects data lines after the blocks', () => {
    const r = parsePlanet(planetText() + '0.0 1.00\n', 'x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/^Data line outside a HORIZONTAL\/VERTICAL block/);
  });

  it('warns about unknown headers and keeps them', () => {
    const r = expectOk(parsePlanet(planetText({ headers: [...DEFAULT_HEADERS, 'FOO bar baz'] }), 'x'));
    expect(r.pattern.extraHeaders).toEqual({ FOO: 'bar baz' });
    expect(r.warnings.map((w) => w.code)).toEqual(['unknown-header']);
    expect(r.warnings[0].line).toBe(5);
  });

  it('warns about a missing GAIN', () => {
    const r = expectOk(parsePlanet(planetText({ headers: ['NAME X', 'FREQUENCY 900'] }), 'x'));
    expect(r.pattern.gain).toBeUndefined();
    expect(r.warnings.map((w) => w.code)).toEqual(['missing-gain']);
  });

  it('warns about a non-1° grid, duplicate angles and a non-zero minimum', () => {
    const coarse = expectOk(parsePlanet(planetText({ h: points(beam, ' ', 2) }), 'x'));
    expect(coarse.warnings.map((w) => w.code)).toEqual(['resampled']);

    const dup = expectOk(parsePlanet(planetText({ h: [...points(beam), '0.0 0.00'] }), 'x'));
    expect(dup.warnings.map((w) => w.code)).toEqual(['duplicate-angle']);

    const offset = expectOk(parsePlanet(planetText({ v: points((a) => 1 + beam(a)) }), 'x'));
    expect(offset.warnings.map((w) => w.code)).toEqual(['peak-not-zero']);
    expect(offset.warnings[0].message).toMatch(/VERTICAL/);
  });
});
