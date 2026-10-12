import { describe, expect, it } from 'vitest';
import { FEATURE_HELP, GLOSSARY } from './glossary';

describe('help', () => {
  it('explains the choice of the simulated horizontal cut and the rule for its metrics', () => {
    const line = FEATURE_HELP.find((l) => l.startsWith('Tilt simulation, horizontal cut'))!;
    for (const text of ['Through the beam peak', 'At the horizon', 'below the 3D peak', 'against its own maximum', 'built-in tilt', 'saved with the project']) expect(line).toContain(text);
    const entry = GLOSSARY.find((g) => g.term === 'Horizon cut')!;
    for (const text of ['0° elevation', 'own maximum', 'below the 3D peak']) expect(entry.text).toContain(text);
  });

  it('says that the horizon cut is shown for every file, tilted or not, and needs no tilt', () => {
    const line = FEATURE_HELP.find((l) => l.startsWith('Tilt simulation, horizontal cut'))!;
    for (const text of ['every file', 'tilted or not', 'no tilt is needed']) expect(line).toContain(text);
    for (const text of ['once a file is tilted', 'until it is given a tilt']) expect(line).not.toContain(text);
    const entry = GLOSSARY.find((g) => g.term === 'Horizon cut')!;
    expect(entry.text).toContain('every file');
  });
});
