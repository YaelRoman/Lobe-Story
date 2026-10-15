import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import type { Method3d } from '../core/analysis/pattern3d';
import { anyTilted, combineOffsets } from '../core/analysis/tilt';
import { settingText } from '../core/fixed';
import type { NotDefaultKey, SimulationState } from '../state/store';
import { summaryMethod } from './simSummary';

/** What the line under the toolbar is made from: the parts of the session and of the preferences that change a number. */
export interface NotDefaultInput {
  simulation: Pick<SimulationState, 'electricalDeg' | 'mechanicalDeg' | 'azimuthDeg' | 'hCut' | 'offsets' | 'groupOffsets'>;
  /** The loaded files (and their copies) that have a pattern: with none there is no number to change. */
  ids: readonly string[];
  membership: Record<string, string>;
  /** The custom groups that exist (an offset of one counts while a loaded file is in it). */
  groupIds: readonly string[];
  method3d: Method3d;
  /** The 3D reconstruction reads the back of the vertical cut. */
  back3d?: boolean;
  /** The angular-region estimate is shown or plotted (it is integrated over the 3D reconstruction). */
  angularRegions: boolean;
  settings: AnalysisSettings;
  /** How many sub-bands the user defined (0: automatic). */
  subBands: number;
  tickedOnly: boolean;
}

/** One thing that is not at its default, and the click that puts it back. */
export interface NotDefaultChip {
  key: NotDefaultKey;
  /** What is set, in the words of its control: "3D method: Weighted". */
  text: string;
  /** The button's name: the text, then what a click does ("3D method: Weighted, reset to Summation"). */
  name: string;
  /** What a click does, as a sentence (the tooltip): "Reset to Summation". */
  title: string;
}

/** A number of degrees as the captions write it: at most two decimals, a true minus sign. */
const degrees = (v: number): string => `${settingText(v).replace('-', '−')}°`;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Each analysis setting as the line writes it, in the order of the Settings panel: the name of its field, and its value with the unit. */
const SETTING_TEXT: [keyof AnalysisSettings, string, (v: string) => string][] = [
  ['levelDb', 'Beamwidth level', (v) => `${v} dB`],
  ['fbWindowDeg', 'F/B window', (v) => `±${v}°`],
  ['uslsRangeDeg', 'USLS window', (v) => `${v}°`],
  ['lobeLimitFactor', 'First-lobe limit', (v) => `${v} × V-HPBW`],
  ['sectorEdgeDeg', 'Sector edge', (v) => `±${v}°`],
  ['siteSectors', 'Sectors per site', (v) => v],
];

/**
 * A changed setting as the chip writes it: with at most two decimals, as everywhere on the page, unless that reads as the
 * default; then with as many as it takes to differ. Such a value still changes numbers (an edge of 59.999° moves SPR and
 * AIR), and the chip, whose job is to explain a difference, is the one place that writes more.
 */
function differingText(v: number, d: number): string {
  const usual = settingText(v);
  if (usual !== settingText(d)) return usual;
  for (let digits = 3; digits <= 12; digits++) {
    const text = String(Number(v.toFixed(digits)));
    if (text !== settingText(d)) return text;
  }
  return String(v);
}

const tilts = (o: { electricalDeg: number; mechanicalDeg: number }): boolean => o.electricalDeg !== 0 || o.mechanicalDeg !== 0;

/**
 * The chips of the line under the toolbar: one per thing that is not at its default and changes a number the page
 * shows (the plots, the frequency chart, the table, the band statistics or what an export lists), in the order of the
 * page. Left out: what changes no number (the azimuth, which turns the drawing; the plot floor; the theme; hidden
 * column groups) and what is said where the numbers are read (the gain unit, written beside every gain; Δ vs
 * reference, which the table's own line names). None without a loaded file.
 */
export function notDefaultChips(input: NotDefaultInput): NotDefaultChip[] {
  if (input.ids.length === 0) return [];
  const chips: NotDefaultChip[] = [];
  const add = (key: NotDefaultKey, text: string, reset: string) => chips.push({ key, text, name: `${text}, ${reset}`, title: `${reset[0].toUpperCase()}${reset.slice(1)}` });
  const sim = input.simulation;

  const sliders = [sim.electricalDeg !== 0 ? `electrical Δ ${degrees(sim.electricalDeg)}` : '', sim.mechanicalDeg !== 0 ? `mechanical ${degrees(sim.mechanicalDeg)}` : ''].filter(Boolean);
  if (sliders.length > 0) add('tilt', `Simulated: ${sliders.join(', ')}`, 'reset the tilt sliders to 0°');

  const files = input.ids.filter((id) => sim.offsets[id] && tilts(sim.offsets[id])).length;
  // A group's offset changes a number only through a loaded file in it.
  const filled = new Set(input.ids.map((id) => input.membership[id]).filter(Boolean));
  const groups = input.groupIds.filter((id) => filled.has(id) && sim.groupOffsets[id] && tilts(sim.groupOffsets[id])).length;
  if (files + groups > 0) {
    const on = [files > 0 ? plural(files, 'file') : '', groups > 0 ? plural(groups, 'group') : ''].filter(Boolean);
    add('tiltOffsets', `Tilt offsets: ${on.join(', ')}`, 'reset the tilt offsets to 0°');
  }

  if (sim.hCut === 'horizon') add('hCut', 'Horizontal cut: at the horizon', 'reset to Through the beam peak');

  if (input.method3d === 'weighted' || input.back3d) {
    const ids = [...input.ids];
    const tiltActive = anyTilted(ids, sim, combineOffsets(ids, sim.offsets, sim.groupOffsets, input.membership));
    // Both choices change numbers on the same occasions: under a tilt, for a horizon cut, for the angular regions.
    if (summaryMethod(input.method3d, tiltActive, input.angularRegions, sim.hCut)) {
      if (input.method3d === 'weighted') add('method3d', '3D method: Weighted', 'reset to Summation');
      if (input.back3d) add('back3d', '3D: back of the vertical cut used', 'stop using it');
    }
  }

  for (const [key, label, value] of SETTING_TEXT) {
    const v = input.settings[key];
    const d = DEFAULT_SETTINGS[key];
    if (v !== d) add(`setting:${key}`, `${label} ${value(differingText(v, d))}`, `reset to ${value(settingText(d))}`);
  }

  if (input.subBands > 0) add('subBands', `Sub-bands: ${input.subBands} user-defined`, 'reset to automatic');
  if (input.tickedOnly) add('tickedOnly', 'Ticked files only', 'reset to all files');
  return chips;
}
