import type { AnalysisSettings } from '../core/analysis/metrics';

/** The names of the analysis settings, as the Settings panel and the table of docs/metrics.md write them. */
export const SETTING_LABELS: Record<keyof AnalysisSettings, string> = {
  levelDb: 'Beamwidth level (dB)',
  fbWindowDeg: 'F/B window ± (°)',
  uslsRangeDeg: 'USLS window (°)',
  lobeLimitFactor: 'First-lobe limit (× V-HPBW)',
  sectorEdgeDeg: 'Sector edge (±°)',
  siteSectors: 'Sectors per site',
};

/**
 * One line under each setting: what it changes. The same words as the "Changes" column of the Settings table in
 * docs/metrics.md (a test holds the two together).
 */
export const SETTING_HELP: Record<keyof AnalysisSettings | 'floorDb' | 'reset' | 'resetPreferences', string> = {
  levelDb: 'Level of H/V-HPBW, Squint, Tilt, Tilt error and the Δ columns. Not the 10 dB or sidelobe columns.',
  fbWindowDeg: 'Width of the F/B ±W° search: the strongest level within 180° ± W° counts.',
  uslsRangeDeg: 'R in the two windowed USLS columns (peak to R°, horizon to R°).',
  lobeLimitFactor: 'Distance within which a first sidelobe counts as distinct. BASTA uses 1.78.',
  sectorEdgeDeg: 'Sector size for P2P tracking, SPR, AIR, Roll-off, H-SLS and the service region of the angular-region estimate.',
  siteSectors: 'Neighbour spacing for D/U aperture: 360° divided by this number.',
  floorDb: 'Lowest level the cut plots and the 3D view draw. It changes the drawing only, no metric.',
  reset: 'Reset puts the settings of this panel back to their defaults.',
  resetPreferences: 'Reset preferences does that too, and puts the theme, the gain unit, the view and the table columns back to their defaults; the browser forgets them. Loaded files and your sub-bands are not touched.',
};
