import { describe, expect, it } from 'vitest';
import { groupKey, groupLabel, inferTags, UNGROUPED } from './grouping';
import { patternFrom } from '../test/synthetic';
import type { Pattern } from './types';

const tagsFor = (fileName: string, over: Partial<Pattern> = {}) =>
  inferTags(patternFrom(() => 0, () => 0, { fileName, ...over }));

describe('inferTags', () => {
  it.each([
    ['_2140_X_CO_P45_08T_Y2.MSI', { polarization: '+45', tiltDeg: 8, array: 'Y2' }],
    ['_1710_X_CO_M45_08T_yL.pln', { polarization: '-45', tiltDeg: 8, array: 'yL' }],
    ['_0824-MHz_M45pol_10dt_R2.pln', { polarization: '-45', tiltDeg: 10, array: 'R2' }],
    ['ANT2X310_Port 1 +45_05DT_0849.txt', { polarization: '+45', tiltDeg: 5, port: '1' }],
    ['Port 6 -45_12DT_2360.txt', { polarization: '-45', tiltDeg: 12, port: '6' }],
    ['_Port 2 -45_09DT_0806.txt', { polarization: '-45', tiltDeg: 9, port: '2' }],
    ['-1-10-806+.pln', { polarization: '+45', tiltDeg: 10, port: '1' }],
    ['-4-0-770-.pln', { polarization: '-45', tiltDeg: 0, port: '4' }],
    ['00DT_790-P1 M45.msi', { polarization: '-45', tiltDeg: 0, port: 'P1' }],
  ])('reads %s', (fileName, expected) => {
    expect(tagsFor(fileName)).toEqual(expected);
  });

  it('falls back to COMMENT and ELECTRICAL_TILT', () => {
    expect(
      tagsFor('ANT0891.MSI', {
        comment: 'DATE 17.08.2015 +45 degrees polarized system Lever position 8 deg  Array Y2',
      }),
    ).toEqual({ polarization: '+45', tiltDeg: 8, array: 'Y2' });
    expect(tagsFor('x.msi', { comment: '-45 polarization, 10 deg tilt', electricalTiltDeg: 3 })).toEqual({
      polarization: '-45',
      tiltDeg: 3,
    });
    expect(tagsFor('x.msi', { comment: '-45 polarization, 10 deg tilt' })).toEqual({
      polarization: '-45',
      tiltDeg: 10,
    });
  });

  it('returns no tags for an unrecognised name', () => {
    expect(tagsFor('pattern.msi')).toEqual({});
  });
});

describe('groupKey and groupLabel', () => {
  it('builds keys and labels', () => {
    expect(groupKey({})).toBe(UNGROUPED);
    expect(groupLabel({})).toBe('Ungrouped');
    expect(groupKey({ polarization: '+45', tiltDeg: 8, array: 'Y2' })).toBe('+45|8||Y2');
    expect(groupLabel({ polarization: '+45', tiltDeg: 8, array: 'Y2' })).toBe('+45 · 8°T · Y2');
    expect(groupLabel({ polarization: '-45', tiltDeg: 12, port: '6' })).toBe('-45 · 12°T · Port 6');
    expect(groupLabel({ polarization: '-45', tiltDeg: 0, port: 'P1' })).toBe('-45 · 0°T · P1');
    expect(groupLabel({ tiltDeg: 4 })).toBe('? pol · 4°T');
  });
});
