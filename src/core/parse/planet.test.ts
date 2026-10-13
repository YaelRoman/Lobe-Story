import { describe, expect, it } from 'vitest';
import { looksLikePlanetText, parsePlanet } from './planet';
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

  it('rejects a non-numeric FREQUENCY', () => {
    const badFreq = planetText({ headers: ['NAME X', 'FREQUENCY abc', 'GAIN 1 dBd'] });
    expect(parsePlanet(badFreq, 'x')).toEqual({ ok: false, error: 'Non-numeric FREQUENCY "abc"', line: 2 });
  });

  it('warns about a FREQUENCY that is missing, empty or not above 0 and still loads the file', () => {
    for (const headers of [['NAME X', 'GAIN 1 dBd'], ['NAME X', 'FREQUENCY', 'GAIN 1 dBd']]) {
      const r = expectOk(parsePlanet(planetText({ headers }), 'x'));
      expect(r.pattern.frequencyMHz).toBe(0);
      expect(r.warnings.map((w) => w.code)).toEqual(['no-frequency']);
      expect(r.warnings[0].message).toContain('No FREQUENCY');
    }
    for (const value of ['0', '-5']) {
      const r = expectOk(parsePlanet(planetText({ headers: ['NAME X', `FREQUENCY ${value}`, 'GAIN 1 dBd'] }), 'x'));
      expect(r.pattern.frequencyMHz).toBe(Number(value));
      expect(r.warnings.map((w) => w.code)).toEqual(['no-frequency']);
      expect(r.warnings[0].message).toContain('not above 0 MHz');
      expect(r.warnings[0].line).toBe(2);
    }
  });

  it('warns about a declared gain outside -10 to 40 dBi, after the unit conversion', () => {
    const codes = (gain: string) => expectOk(parsePlanet(planetText({ headers: ['NAME X', 'FREQUENCY 900', `GAIN ${gain}`] }), 'x')).warnings.map((w) => w.code);
    expect(codes('999 dBi')).toEqual(['gain-out-of-range']);
    expect(codes('-10.5 dBi')).toEqual(['gain-out-of-range']);
    expect(codes('39 dBd')).toEqual(['gain-out-of-range']); // 41.15 dBi
    expect(codes('-9 dBd')).toEqual([]); // -6.85 dBi
    expect(codes('40 dBi')).toEqual([]);
    expect(codes('-10 dBi')).toEqual([]);
    expect(codes('18 dBd')).toEqual([]);
    const r = expectOk(parsePlanet(planetText({ headers: ['NAME X', 'FREQUENCY 900', 'GAIN 999 dBi'] }), 'x'));
    expect(r.pattern.gain).toEqual({ value: 999, unit: 'dBi' });
    expect(r.warnings[0].message).toContain('outside -10 to 40 dBi');
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

describe('content that is not a Planet pattern', () => {
  it.each([
    ['plain notes', 'Meeting notes\nbuy cables\n'],
    ['binary bytes', '\u0000\u0001\u0002PK\u0003\u0004\nÿþ'],
  ])('reports %s as not a pattern file', (_label, text) => {
    expect(parsePlanet(text, 'x.txt')).toEqual({ ok: false, error: 'Not a Planet pattern file' });
    expect(looksLikePlanetText(text)).toBe(false);
  });

  it('says that a file is empty, instead of what it is not', () => {
    for (const text of ['', '\r\n \r\n', '\uFEFF']) expect(parsePlanet(text, 'x.msi'), JSON.stringify(text)).toEqual({ ok: false, error: 'The file is empty' });
  });

  it('names the encoding of a UTF-16 file, and the way out', () => {
    const utf16 = (text: string, bom: string) => bom + Array.from(text, (c) => `${c}\u0000`).join('');
    const expected = { ok: false, error: 'The file looks like UTF-16 text: save it as UTF-8 (or ANSI) and open it again' };
    // As the page decodes the bytes: the mark FF FE read as "ÿþ", and a zero byte after every letter.
    expect(parsePlanet(utf16(planetText(), 'ÿþ'), 'x.msi')).toEqual(expected);
    // Without the mark, and big-endian (the zero byte first).
    expect(parsePlanet(utf16(planetText(), ''), 'x.msi')).toEqual(expected);
    expect(parsePlanet('þÿ' + Array.from(planetText(), (c) => `\u0000${c}`).join(''), 'x.msi')).toEqual(expected);
  });

  it('keeps the specific error for a file that looks like a pattern but is incomplete', () => {
    expect(parsePlanet('NAME X\nFREQUENCY 900\n', 'x.pln')).toEqual({ ok: false, error: 'Missing HORIZONTAL block' });
  });
});

describe('levels written as negative dB (relative to the peak, with a minus sign)', () => {
  const NOTE = 'values look like negative levels (dB relative to peak written with a minus sign); read as attenuation';
  const neg = (f: (a: number) => number) => points((a) => -f(a));

  it('a cut whose values are all ≤ 0 with a minimum of −3 dB or lower is read with the sign flipped, and says so', () => {
    const r = expectOk(parsePlanet(planetText({ h: neg(beam), v: neg(beam) }), 'neg.msi'));
    const plain = expectOk(parsePlanet(planetText({ h: points(beam), v: points(beam) }), 'pos.msi'));
    // The peak is where the file's 0 is: the same pattern as the file written as attenuation.
    expect(r.pattern.horizontal).toEqual(plain.pattern.horizontal);
    expect(r.pattern.vertical).toEqual(plain.pattern.vertical);
    expect(r.pattern.horizontal.atten[0]).toBe(0);
    expect(Math.max(...r.pattern.horizontal.atten)).toBe(40);
    expect(r.warnings).toEqual([
      { code: 'negative-levels', message: `HORIZONTAL cut: ${NOTE}` },
      { code: 'negative-levels', message: `VERTICAL cut: ${NOTE}` },
    ]);
    // No "minimum is -40 dB, not 0" on top: after the flip the minimum is 0.
    expect(r.warnings.some((w) => w.code === 'peak-not-zero')).toBe(false);
  });

  it('each cut is judged on its own', () => {
    const r = expectOk(parsePlanet(planetText({ h: neg(beam), v: points(beam) }), 'mixed.msi'));
    expect(r.warnings.map((w) => w.message)).toEqual([`HORIZONTAL cut: ${NOTE}`]);
    expect(Math.max(...r.pattern.horizontal.atten)).toBe(40);
    expect(Math.max(...r.pattern.vertical.atten)).toBe(40);
  });

  it('a flipped cut whose best level is not 0 still gets the normalising warning, with the flipped value', () => {
    const r = expectOk(parsePlanet(planetText({ h: points((a) => -1 - beam(a)) }), 'x'));
    expect(r.warnings.map((w) => w.code)).toEqual(['negative-levels', 'peak-not-zero']);
    expect(r.warnings[1].message).toBe('HORIZONTAL cut minimum is 1 dB, not 0; analysis normalises it');
    expect(Math.min(...r.pattern.horizontal.atten)).toBe(1);
  });

  it('is left as it is when it is not unambiguous', () => {
    const same = (h: string[]) => {
      const r = expectOk(parsePlanet(planetText({ h }), 'x'));
      expect(r.warnings.some((w) => w.code === 'negative-levels')).toBe(false);
      return r.pattern.horizontal.atten;
    };
    // Attenuation as usual; an all-zero (omnidirectional) cut; a positive value among negative ones; a shallow negative cut.
    expect(same(points(beam))[90]).toBe(40);
    expect(new Set(same(points(() => 0)))).toEqual(new Set([0]));
    expect(same(points((a) => (a === 0 ? 0.5 : -beam(a))))[90]).toBe(-40);
    expect(Math.min(...same(points((a) => -Math.min(2.9, Math.abs(a) / 2))))).toBe(-2.9);
    // Exactly −3 dB is enough.
    const edge = expectOk(parsePlanet(planetText({ h: points((a) => -Math.min(3, Math.abs(a) / 2)) }), 'x'));
    expect(edge.warnings.map((w) => w.code)).toEqual(['negative-levels']);
    expect(Math.max(...edge.pattern.horizontal.atten)).toBe(3);
    // The file written with a small offset below its peak keeps the existing warning and its values.
    const offset = expectOk(parsePlanet(planetText({ v: points((a) => 1 + beam(a)) }), 'x'));
    expect(offset.warnings.map((w) => w.code)).toEqual(['peak-not-zero']);
  });
});

describe('the unit of FREQUENCY', () => {
  const withFreq = (value: string) => parsePlanet(planetText({ headers: ['NAME A', `FREQUENCY ${value}`, 'GAIN 15 dBd'] }), 'f.msi');

  it('reads a frequency given in GHz as MHz, without a warning', () => {
    for (const [text, mhz] of [['1.8 GHz', 1800], ['1.8GHz', 1800], ['2.6 ghz', 2600], ['0.7 GHz', 700], ['3.55 GHz', 3550], ['1.71 GHz', 1710]] as const) {
      const r = expectOk(withFreq(text));
      expect(r.pattern.frequencyMHz, text).toBe(mhz);
      expect(r.warnings, text).toEqual([]);
    }
  });

  it('reads MHz, with or without the unit, as before', () => {
    for (const [text, mhz] of [['1800', 1800], ['1800 MHz', 1800], ['849.5MHz', 849.5], ['27 MHz', 27]] as const) {
      const r = expectOk(withFreq(text));
      expect(r.pattern.frequencyMHz, text).toBe(mhz);
      expect(r.warnings, text).toEqual([]);
    }
  });

  it('marks a bare frequency below 30 as probably GHz, and leaves the value alone', () => {
    const r = expectOk(withFreq('1.8'));
    expect(r.pattern.frequencyMHz).toBe(1.8);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: 'frequency-unit', line: 2 });
    expect(r.warnings[0].message).toBe('FREQUENCY 1.8 has no unit and is below 30: frequency looks like GHz. It is read as 1.8 MHz; write "1.8 GHz" or 1800 if GHz is meant');
    expect(expectOk(withFreq('29.9')).warnings.map((w) => w.code)).toEqual(['frequency-unit']);
    expect(expectOk(withFreq('30')).warnings).toEqual([]);
    // Zero and below keep their own warning.
    expect(expectOk(withFreq('0')).warnings.map((w) => w.code)).toEqual(['no-frequency']);
  });
});

describe('line ends and decimal commas', () => {
  it('reads a file whose lines end in a carriage return alone (old Mac), as one with CR LF or LF', () => {
    const cr = expectOk(parsePlanet(planetText({ eol: '\r' }), 'cr.msi'));
    const crlf = expectOk(parsePlanet(planetText({ eol: '\r\n' }), 'cr.msi'));
    const lf = expectOk(parsePlanet(planetText({ eol: '\n' }), 'cr.msi'));
    expect(cr).toEqual(crlf);
    expect(lf).toEqual(crlf);
    expect(cr.pattern.horizontal.angles).toHaveLength(360);
    // An error in it has its own line number, not "line 1" for the whole file.
    const bad = parsePlanet(planetText({ eol: '\r' }).replace('10.0 0.28', '10.0 abc'), 'cr.msi');
    expect(bad).toEqual({ ok: false, error: 'Non-numeric value in HORIZONTAL block: "10.0 abc"', line: 16 });
  });

  it('a line separator inside a header value does not stop the page (the file is read, or refused with a reason)', () => {
    expect(() => parsePlanet(planetText({ headers: ['NAME A\u2028B', 'FREQUENCY 1800'] }), 'x.msi')).not.toThrow();
  });

  it('says that decimal commas are not read, where a value has one', () => {
    const comma = (lines: string[]) => lines.map((l) => l.replace(/\./g, ','));
    const r = parsePlanet(planetText({ h: comma(points((a) => Math.min(40, Math.abs(a) / 2))) }), 'x.msi');
    expect(r).toEqual({
      ok: false,
      error: 'Non-numeric value in HORIZONTAL block: "0,0 0,00". Decimal commas are not read: write the values with points (0.5, not 0,5)',
      line: 6,
    });
    // Another kind of non-number gets no such hint.
    const other = parsePlanet(planetText().replace('10.0 0.28', '10.0 abc'), 'x.msi');
    expect(other.ok === false && other.error).toBe('Non-numeric value in HORIZONTAL block: "10.0 abc"');
  });
});
