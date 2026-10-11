import { describe, expect, it } from 'vitest';
import { isReferenceUid, seriesIdOf, traceUid } from './traceUid';

/** Ids as a file name can make them: every character a CSS selector gives a meaning to, and more. */
const HOSTILE = [
  'a (2).msi',
  `quote'=<b>:(2).msi`,
  'paren(2).msi',
  '=cmd.msi',
  'a<b>.msi',
  "quote'.msi",
  'a:b.msi',
  'folder/sub\\name.msi#original',
  'a#reference',
  '"double" [x] {y} ~ + > , * ^ $ | ! @ % & ; ?',
  ' leading and trailing ',
  '2starts-with-a-digit',
  '-starts-with-a-dash',
  '_under_score_',
  '_2e_',
  'file-x',
  'ref-x',
  'ünïcödé 天線 📡',
  'tab\tnewline\nnul\u0000',
  '',
];

describe('traceUid', () => {
  it('is always a plain CSS identifier, so a selector built from it is valid', () => {
    for (const id of HOSTILE) {
      for (const reference of [false, true]) {
        const uid = traceUid(id, reference);
        expect(uid, id).toMatch(/^[a-z][A-Za-z0-9_-]*$/);
        // What CSS.escape would leave untouched: nothing to escape in `.cb<uid>` or `.trace<uid>`.
        expect(uid).not.toMatch(/[^A-Za-z0-9_-]/);
      }
    }
  });

  it('gives the series id back, and whether the trace is the reference', () => {
    for (const id of HOSTILE) {
      expect(seriesIdOf(traceUid(id)), id).toBe(id);
      expect(seriesIdOf(traceUid(id, true)), id).toBe(id);
      expect(isReferenceUid(traceUid(id))).toBe(false);
      expect(isReferenceUid(traceUid(id, true))).toBe(true);
    }
  });

  it('is the same for the same id on every call (the chart matches traces across redraws by uid)', () => {
    for (const id of HOSTILE) {
      expect(traceUid(id)).toBe(traceUid(id));
      expect(traceUid(id, true)).toBe(traceUid(id, true));
    }
  });

  it('never gives two ids, or a file and its reference trace, the same uid', () => {
    const all = HOSTILE.flatMap((id) => [traceUid(id), traceUid(id, true)]);
    expect(new Set(all).size).toBe(all.length);
    // Ids that differ only in characters that are escaped, or that look like an escape themselves.
    expect(traceUid('a.b')).not.toBe(traceUid('a_2e_b'));
    expect(traceUid('a b')).not.toBe(traceUid('a(b'));
    expect(traceUid('A')).not.toBe(traceUid('a'));
  });

  it('keeps letters and digits readable', () => {
    expect(traceUid('f1730')).toBe('file-f1730');
    expect(traceUid('f1730', true)).toBe('ref-f1730');
    expect(traceUid('a (2).msi')).toBe('file-a_20__28_2_29__2e_msi');
  });

  it('reads nothing from a uid it did not make', () => {
    for (const foreign of [undefined, null, 7, '', 'a', 'a (2).msi', 'r#reference', 'f3a2b1', 'file-a.b', 'file-_zz_', 'file-_2e', 'ref-a b']) {
      expect(seriesIdOf(foreign), String(foreign)).toBeNull();
      expect(isReferenceUid(foreign)).toBe(false);
    }
  });
});
