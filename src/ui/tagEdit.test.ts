import { describe, expect, it } from 'vitest';
import { sameTags } from './tagEdit';

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
