import { describe, expect, it } from 'vitest';
import { pickedFileId } from './pointPick';

describe('pickedFileId', () => {
  it('is the first point\'s file id', () => {
    expect(pickedFileId({ points: [{ customdata: 'a/ANT-1.msi' }, { customdata: 'b' }] })).toBe('a/ANT-1.msi');
  });
  it('is null for a point without a file, an empty id, no points or no event', () => {
    expect(pickedFileId({ points: [{}] })).toBeNull();
    expect(pickedFileId({ points: [{ customdata: null }] })).toBeNull();
    expect(pickedFileId({ points: [{ customdata: '' }] })).toBeNull();
    expect(pickedFileId({ points: [{ customdata: 5 }] })).toBeNull();
    expect(pickedFileId({ points: [] })).toBeNull();
    expect(pickedFileId({})).toBeNull();
    expect(pickedFileId(undefined)).toBeNull();
  });
});
