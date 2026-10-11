import { describe, expect, it } from 'vitest';
import { parseTilt, sameTags } from './tagEdit';

describe('sameTags', () => {
  it('treats a missing tag and an undefined one as equal', () => {
    expect(sameTags({ polarization: '+45', tiltDeg: 2 }, { polarization: '+45', tiltDeg: 2, port: undefined, array: undefined })).toBe(true);
    expect(sameTags({}, { polarization: undefined })).toBe(true);
  });
  it('sees a changed, added or removed tag', () => {
    expect(sameTags({ tiltDeg: 2 }, { tiltDeg: 3 })).toBe(false);
    expect(sameTags({}, { port: 'A' })).toBe(false);
    expect(sameTags({ array: 'R1' }, {})).toBe(false);
  });
});

describe('parseTilt', () => {
  it('reads plain numbers and clears on empty text', () => {
    expect(parseTilt(' 6.5 ')).toEqual({ ok: true, value: 6.5 });
    expect(parseTilt('-2')).toEqual({ ok: true, value: -2 });
    expect(parseTilt('.5')).toEqual({ ok: true, value: 0.5 });
    expect(parseTilt('  ')).toEqual({ ok: true, value: undefined });
  });
  it('refuses anything else with a message', () => {
    for (const text of ['abc', '6°', '1e3', '0x10', 'Infinity', '6,5', '--1']) {
      const r = parseTilt(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/number/);
    }
  });
});
