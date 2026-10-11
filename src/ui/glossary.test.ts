import { beforeEach, describe, expect, it } from 'vitest';
import { FEATURE_HELP, GLOSSARY, METRICS_DOC_URL, PANEL_HELP, README_URL, REPO_URL } from './glossary';
import { canOfferExample, loadExample } from './loadExample';
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

it('the help says what the file panel filter, fold and preview do', () => {
  for (const word of ['filter', 'folds', 'previews']) expect(PANEL_HELP).toContain(word);
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

describe('canOfferExample', () => {
  beforeEach(() => useStore.setState(initialState()));

  it('is offered on a blank page, but not while a layout-only project waits for its pattern files', () => {
    expect(canOfferExample(useStore.getState())).toBe(true);
    useStore.setState({ pendingFiles: [{ path: 'a.msi' }] });
    expect(canOfferExample(useStore.getState())).toBe(false);
    useStore.getState().dismissPending();
    expect(canOfferExample(useStore.getState())).toBe(true);
  });
});

it('the help has a line for each feature', () => {
  const lines = (word: string) => FEATURE_HELP.filter((l) => l.includes(word));
  for (const word of ['Metric menu', 'Reference file', 'Copy']) expect(lines(word).length, word).toBeGreaterThan(0);
  expect(FEATURE_HELP.every((l) => l.length > 20)).toBe(true);
});
