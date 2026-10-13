// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { imageExported } from './simCurrent';
import { IMAGE_BEHIND_NOTE } from './updateHint';

afterEach(() => useStore.getState().setCopyNote(null));

describe('a picture that was refused and is then saved', () => {
  it('takes the "Not saved" note away: it is no longer true', () => {
    useStore.getState().setCopyNote(IMAGE_BEHIND_NOTE);
    imageExported();
    expect(useStore.getState().copyNote).toBeNull();
  });

  it('leaves any other note alone', () => {
    useStore.getState().setCopyNote('Copied the table (24 rows)');
    imageExported();
    expect(useStore.getState().copyNote).toBe('Copied the table (24 rows)');
    useStore.getState().setCopyNote(null);
    imageExported();
    expect(useStore.getState().copyNote).toBeNull();
  });
});
