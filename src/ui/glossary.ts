/** The public repository: the one place its address is written. */
export const REPO_URL = 'https://github.com/YaelRoman/Lobe-Story';
export const METRICS_DOC_URL = `${REPO_URL}/blob/main/docs/metrics.md`;
export const README_URL = `${REPO_URL}#readme`;

export interface GlossaryEntry {
  term: string;
  /** One plain-English line; the exact definitions live in docs/metrics.md. */
  text: string;
}

/** One sentence for the Help dialog about the file panel's filter, fold and preview. */
export const PANEL_HELP =
  'File panel: the filter box narrows the list (every word must match the name, group or MHz) and Show all, Show none, Only matches and Add matches change which files are drawn; a group’s arrow button folds it; hovering a file, or moving the keyboard focus to it, previews its trace in the cut plots, and Esc clears the highlight and the preview.';

/** One line per feature for the Help dialog (the lines for the table, the chart and the reference file). */
export const FEATURE_HELP: readonly string[] = [
  'Copying: Copy table (above the metrics table and the band statistics) puts the table as shown on the clipboard for a spreadsheet; Copy row (the mark beside a file name, or Ctrl/Cmd+C on it) copies one row; click a cell and then the Copy value button that appears in it, or Right arrow into the cells and then Enter or Ctrl/Cmd+C, copies one value.',
  'Reference file: the ⋯ menu of a file has Use as reference (and Clear reference). The reference shows a pin, is drawn in the cut plots as a thick dashed line in the text colour (also when it is not ticked) and is marked by a diamond in the frequency chart; the Δ vs reference box above the metrics table shows every metric and the gain as the difference from it (the reference row stays first and keeps its own values; the CSV and copy add a Row column saying which is which). It is saved with the project.',
  'Frequency chart: the Metric menu above it plots any table column against frequency, one line per group; the choice is remembered in this browser, not in projects.',
];

export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: 'HPBW', text: 'Half-power beamwidth: the angle between the two points where the pattern is 3 dB below its peak (the level can be changed in Settings; the labels then read BW@x dB instead of HPBW).' },
  { term: 'Squint', text: 'How far the middle of the horizontal beam points away from 0° (the antenna’s boresight).' },
  { term: 'Tilt', text: 'The elevation angle of the vertical beam, positive below the horizon. Electrical tilt is set inside the antenna and is read from the file name (for example 05T) or its header.' },
  { term: 'F/B', text: 'Front-to-back ratio: how many dB lower the strongest level behind the antenna (180° ± a window) is than the peak. Bigger is better.' },
  { term: 'USLS', text: 'Upper sidelobe suppression: how far the upper sidelobes are below the peak: the first upper lobe, or the strongest one in a window above the beam, depending on the column. It tells how much energy goes towards neighbouring cells.' },
  { term: 'Null fill', text: 'How deep the first null below the main beam is. A shallow null fills the dead zone close to the mast; a deep one leaves a hole.' },
  { term: 'Roll-off', text: 'How many dB the pattern has dropped at the sector edges (±60° by default); the worse of the two edges is shown.' },
  { term: 'SPR / AIR', text: 'Sector power ratio: the power outside the sector divided by the power inside, times 100. It is not a share of the total power, so it can exceed 100 % for wide or omnidirectional patterns. AIR is the same comparison the other way round (power inside versus outside), in dB. A low SPR and a high AIR mean the beam stays in its sector.' },
  { term: 'P2P tracking', text: 'Port-to-port tracking: the largest difference over the sector between a pattern and its opposite-polarization partner (+45 and −45, same tilt, array and frequency). Small means the two ports behave alike.' },
  { term: 'D/U aperture', text: 'The width of the azimuth region around 0° where this pattern is at least 15, 20 or 25 dB (16, 64 or 256QAM) stronger than a copy of itself turned to the neighbouring sector (360° divided by the sectors per site).' },
  { term: 'Band statistics', text: 'Mean and tolerance (and percentile limits) of a parameter over all files of one antenna inside a frequency sub-band. They need at least 10 samples per cell (antenna, sub-band and parameter).' },
];
