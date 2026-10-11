import { beforeEach, describe, expect, it } from 'vitest';
import { GLOSSARY, METRICS_DOC_URL, README_URL, REPO_URL } from './glossary';
import { loadExample } from './loadExample';
import { initialState, useStore } from '../state/store';
import { EXAMPLE_NOTE } from '../core/exampleSet';

describe('glossary', () => {
  it('explains every main term in one non-empty line and links to the repository', () => {
    const terms = GLOSSARY.map((g) => g.term);
    for (const t of ['HPBW', 'Squint', 'Tilt', 'F/B', 'USLS', 'Null fill', 'Roll-off', 'SPR / AIR', 'P2P tracking', 'D/U aperture', 'Band statistics']) {
      expect(terms).toContain(t);
    }
    for (const g of GLOSSARY) expect(g.text.trim().length).toBeGreaterThan(20);
    expect(METRICS_DOC_URL).toBe(`${REPO_URL}/blob/main/docs/metrics.md`);
    expect(README_URL.startsWith(REPO_URL)).toBe(true);
    expect(REPO_URL).toBe('https://github.com/YaelRoman/Lobe-Story');
  });
});

describe('loadExample', () => {
  beforeEach(() => useStore.setState(initialState()));

  it('loads the whole example through addFiles, all parsed, with a calm status line', () => {
    loadExample();
    const s = useStore.getState();
    expect(s.files).toHaveLength(24);
    expect(s.files.every((f) => f.result.ok)).toBe(true);
    expect(s.loadMessage).toContain(EXAMPLE_NOTE);
    expect(s.loadTone).toBe('info');
  });

  it('loading it twice adds nothing new', () => {
    loadExample();
    loadExample();
    expect(useStore.getState().files).toHaveLength(24);
  });
});
