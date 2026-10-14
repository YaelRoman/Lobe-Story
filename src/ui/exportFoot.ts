import type { AnalysisSettings } from '../core/analysis/metrics';
import type { ViewState } from '../state/store';
import { needsAngularRegions } from './table';
import { settingText } from './bwLabel';

/** The app's name as the page's heading writes it. */
const APP_NAME = 'Lobe-Story';

/** The part of the view the foot line reads. */
export type FootView = Pick<ViewState, 'dimension' | 'method3d' | 'tableGroups' | 'freqMetric'> & {
  simulation: Pick<ViewState['simulation'], 'electricalDeg' | 'mechanicalDeg' | 'azimuthDeg' | 'hCut' | 'offsets' | 'groupOffsets'>;
};

/**
 * Whether the 3D method changes anything on the page: in the 3D view, under a tilt (the global sliders or an offset of
 * a file or a group), for the horizontal cut at the horizon, and while the angular-region estimate is shown or plotted.
 * The same occasions as the line beside the 3D method control. An azimuth only turns the drawing.
 */
export function methodInUse(view: FootView): boolean {
  const sim = view.simulation;
  const tilts = (o: { electricalDeg: number; mechanicalDeg: number }) => o.electricalDeg !== 0 || o.mechanicalDeg !== 0;
  return (
    view.dimension === '3d' ||
    sim.hCut === 'horizon' ||
    tilts(sim) ||
    Object.values(sim.offsets).some(tilts) ||
    Object.values(sim.groupOffsets).some(tilts) ||
    needsAngularRegions(view.tableGroups, view.freqMetric)
  );
}

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * The small line at the foot of every exported image: the settings that shape the numbers (so a picture found in a
 * report a year later can be read), the 3D method while something uses it, the day, and the app's name.
 * Images only: the CSV files do not carry it.
 */
export function exportFootLine(settings: Pick<AnalysisSettings, 'levelDb' | 'sectorEdgeDeg' | 'fbWindowDeg'>, view: FootView, now: Date): string {
  return [
    `Beamwidth level ${settingText(settings.levelDb)} dB`,
    `Sector edge ±${settingText(settings.sectorEdgeDeg)}°`,
    `F/B window ±${settingText(settings.fbWindowDeg)}°`,
    ...(methodInUse(view) ? [`3D method: ${view.method3d === 'weighted' ? 'Weighted' : 'Summation'}`] : []),
    `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
    APP_NAME,
  ].join(' · ');
}
