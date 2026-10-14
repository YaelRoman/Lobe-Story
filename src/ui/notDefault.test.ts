import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/analysis/metrics';
import { notDefaultChips, type NotDefaultInput } from './notDefault';

const base = (over: Partial<NotDefaultInput> = {}): NotDefaultInput => ({
  simulation: { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0, hCut: 'beam', offsets: {}, groupOffsets: {} },
  ids: ['a.msi', 'b.msi'],
  membership: {},
  groupIds: [],
  method3d: 'summation',
  angularRegions: false,
  settings: { ...DEFAULT_SETTINGS },
  subBands: 0,
  tickedOnly: false,
  ...over,
});
const sim = (over: Partial<NotDefaultInput['simulation']>) => ({ ...base().simulation, ...over });
const texts = (input: NotDefaultInput) => notDefaultChips(input).map((c) => c.text);

describe('notDefaultChips: one chip per thing that is not at its default and changes a number', () => {
  it('none at the defaults, and none without a loaded file (no number to change)', () => {
    expect(notDefaultChips(base())).toEqual([]);
    expect(notDefaultChips(base({ ids: [], tickedOnly: true, method3d: 'weighted', subBands: 2, settings: { ...DEFAULT_SETTINGS, levelDb: 6 } }))).toEqual([]);
  });

  it('the global tilt sliders: only the ones that are set, in the words of the captions, at most two decimals', () => {
    expect(texts(base({ simulation: sim({ electricalDeg: 2 }) }))).toEqual(['Simulated: electrical Δ 2°']);
    expect(texts(base({ simulation: sim({ mechanicalDeg: -5 }) }))).toEqual(['Simulated: mechanical −5°']);
    expect(texts(base({ simulation: sim({ electricalDeg: 2.5, mechanicalDeg: 1.123456 }) }))).toEqual(['Simulated: electrical Δ 2.5°, mechanical 1.12°']);
    const [chip] = notDefaultChips(base({ simulation: sim({ electricalDeg: 2 }) }));
    expect(chip.key).toBe('tilt');
    expect(chip.name).toBe('Simulated: electrical Δ 2°, reset the tilt sliders to 0°');
  });

  it('the azimuth turns the drawing only: no chip for it, alone or as an offset', () => {
    expect(notDefaultChips(base({ simulation: sim({ azimuthDeg: 30 }) }))).toEqual([]);
    expect(notDefaultChips(base({ simulation: sim({ offsets: { 'a.msi': { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 120 } } }) }))).toEqual([]);
    // Beside a tilt the azimuth is not named either.
    expect(texts(base({ simulation: sim({ mechanicalDeg: 3, azimuthDeg: 30 }) }))).toEqual(['Simulated: mechanical 3°']);
  });

  it('tilt offsets of files and groups: counted among the loaded files and the existing groups', () => {
    const offsets = {
      'a.msi': { electricalDeg: 2, mechanicalDeg: 0, azimuthDeg: 0 },
      'b.msi': { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 90 },
      'gone.msi': { electricalDeg: 4, mechanicalDeg: 0, azimuthDeg: 0 },
    };
    const groupOffsets = { g1: { electricalDeg: 0, mechanicalDeg: 1, azimuthDeg: 0 }, g9: { electricalDeg: 1, mechanicalDeg: 0, azimuthDeg: 0 } };
    const chips = notDefaultChips(base({ simulation: sim({ offsets, groupOffsets }), groupIds: ['g1'] }));
    expect(chips.map((c) => c.text)).toEqual(['Tilt offsets: 1 file, 1 group']);
    expect(chips[0].key).toBe('tiltOffsets');
    expect(chips[0].name).toBe('Tilt offsets: 1 file, 1 group, reset the tilt offsets to 0°');
    expect(texts(base({ simulation: sim({ offsets: { 'a.msi': offsets['a.msi'], 'b.msi': { electricalDeg: 1, mechanicalDeg: 0, azimuthDeg: 0 } } }) }))).toEqual(['Tilt offsets: 2 files']);
    expect(texts(base({ simulation: sim({ groupOffsets }), groupIds: ['g1', 'g9'] }))).toEqual(['Tilt offsets: 2 groups']);
  });

  it('the horizontal cut at the horizon, in the words of its control', () => {
    const chips = notDefaultChips(base({ simulation: sim({ hCut: 'horizon' }) }));
    expect(chips.map((c) => [c.key, c.text, c.name])).toEqual([['hCut', 'Horizontal cut: at the horizon', 'Horizontal cut: at the horizon, reset to Through the beam peak']]);
  });

  it('the 3D method Weighted only while something uses it for a number: a tilt, the horizon cut, the angular regions', () => {
    expect(notDefaultChips(base({ method3d: 'weighted' }))).toEqual([]);
    const method = (input: NotDefaultInput) => notDefaultChips(input).find((c) => c.key === 'method3d');
    expect(method(base({ method3d: 'weighted', angularRegions: true }))?.text).toBe('3D method: Weighted');
    expect(method(base({ method3d: 'weighted', angularRegions: true }))?.name).toBe('3D method: Weighted, reset to Summation');
    expect(method(base({ method3d: 'weighted', simulation: sim({ hCut: 'horizon' }) }))).toBeDefined();
    expect(method(base({ method3d: 'weighted', simulation: sim({ electricalDeg: 1 }) }))).toBeDefined();
    // A file's own tilt offset is a tilt too; a global tilt that an offset cancels on every file is none.
    expect(method(base({ method3d: 'weighted', simulation: sim({ offsets: { 'a.msi': { electricalDeg: 1, mechanicalDeg: 0, azimuthDeg: 0 } } }) }))).toBeDefined();
    const cancelled = { 'a.msi': { electricalDeg: -1, mechanicalDeg: 0, azimuthDeg: 0 }, 'b.msi': { electricalDeg: -1, mechanicalDeg: 0, azimuthDeg: 0 } };
    expect(method(base({ method3d: 'weighted', simulation: sim({ electricalDeg: 1, offsets: cancelled }) }))).toBeUndefined();
  });

  it('one chip per analysis setting that is not at its default, with its value and the default it goes back to', () => {
    const settings = { ...DEFAULT_SETTINGS, levelDb: 6, fbWindowDeg: 45, uslsRangeDeg: 30.004, lobeLimitFactor: 2, sectorEdgeDeg: 45, siteSectors: 4 };
    const chips = notDefaultChips(base({ settings }));
    expect(chips.map((c) => c.text)).toEqual(['Beamwidth level 6 dB', 'F/B window ±45°', 'USLS window 30°', 'First-lobe limit 2 × V-HPBW', 'Sector edge ±45°', 'Sectors per site 4']);
    expect(chips.map((c) => c.key)).toEqual(['setting:levelDb', 'setting:fbWindowDeg', 'setting:uslsRangeDeg', 'setting:lobeLimitFactor', 'setting:sectorEdgeDeg', 'setting:siteSectors']);
    expect(chips.map((c) => c.name)).toEqual([
      'Beamwidth level 6 dB, reset to 3 dB',
      'F/B window ±45°, reset to ±30°',
      'USLS window 30°, reset to 20°',
      'First-lobe limit 2 × V-HPBW, reset to 1.78 × V-HPBW',
      'Sector edge ±45°, reset to ±60°',
      'Sectors per site 4, reset to 3',
    ]);
    // A value typed with many decimals is written with at most two.
    expect(texts(base({ settings: { ...DEFAULT_SETTINGS, levelDb: 6.123456 } }))).toEqual(['Beamwidth level 6.12 dB']);
  });

  it('user-defined sub-bands, and the ticked-files-only table', () => {
    expect(notDefaultChips(base({ subBands: 1 })).map((c) => [c.key, c.text, c.name])).toEqual([['subBands', 'Sub-bands: 1 user-defined', 'Sub-bands: 1 user-defined, reset to automatic']]);
    expect(texts(base({ subBands: 3 }))).toEqual(['Sub-bands: 3 user-defined']);
    expect(notDefaultChips(base({ tickedOnly: true })).map((c) => [c.key, c.text, c.name])).toEqual([['tickedOnly', 'Ticked files only', 'Ticked files only, reset to all files']]);
  });

  it('in the order of the page: simulation, 3D method, settings, sub-bands, table', () => {
    const all = base({
      simulation: sim({ mechanicalDeg: 4, hCut: 'horizon', offsets: { 'a.msi': { electricalDeg: 1, mechanicalDeg: 0, azimuthDeg: 0 } } }),
      method3d: 'weighted',
      settings: { ...DEFAULT_SETTINGS, sectorEdgeDeg: 45 },
      subBands: 2,
      tickedOnly: true,
    });
    expect(notDefaultChips(all).map((c) => c.key)).toEqual(['tilt', 'tiltOffsets', 'hCut', 'method3d', 'setting:sectorEdgeDeg', 'subBands', 'tickedOnly']);
    // Each reset is said in a sentence of its own (the tooltip): capitalised, as a button would say it.
    expect(notDefaultChips(all).map((c) => c.title)).toEqual(['Reset the tilt sliders to 0°', 'Reset the tilt offsets to 0°', 'Reset to Through the beam peak', 'Reset to Summation', 'Reset to ±60°', 'Reset to automatic', 'Reset to all files']);
  });
});
