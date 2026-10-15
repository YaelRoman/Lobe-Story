/** The public repository: the one place its address is written. */
export const REPO_URL = 'https://github.com/YaelRoman/Lobe-Story';
export const METRICS_DOC_URL = `${REPO_URL}/blob/main/docs/metrics.md`;
export const README_URL = `${REPO_URL}#readme`;

export interface GlossaryEntry {
  term: string;
  /** One plain-English line; the exact definitions live in docs/metrics.md. */
  text: string;
}

/** A headed block of the Help dialog: a few short lines about one subject. */
export interface HelpSection {
  title: string;
  /** What the section is about; several sections can share one subject (see `helpAbout`). */
  topic: 'panel' | 'copying' | 'reference' | 'ticked' | 'horizontal-cut' | 'chart' | 'not-default' | 'band-compare';
  lines: readonly string[];
}

/** The second half of the Help dialog, after the glossary: how the parts of the page work. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    title: 'File panel',
    topic: 'panel',
    lines: [
      'The filter box narrows the list: every word must match the name, group or MHz.',
      'Show all, Show none, Only matches and Add matches change which files are drawn; a group’s arrow button folds it.',
      'Hovering a file, or moving the keyboard focus to it, previews its trace in the cut plots; Esc clears the highlight and the preview.',
    ],
  },
  {
    title: 'Copying',
    topic: 'copying',
    lines: [
      'Copy table (above the metrics table and the band statistics) puts the table as shown on the clipboard for a spreadsheet.',
      'Copy row (the mark beside a file name, or Ctrl/Cmd+C on it) copies one row.',
      'One value: click a cell and then the Copy value button that appears in it, or Right arrow into the cells and then Enter or Ctrl/Cmd+C.',
    ],
  },
  {
    title: 'Reference file',
    topic: 'reference',
    lines: [
      'The ⋯ menu of a file has Use as reference (and Clear reference). It is saved with the project.',
      'The reference shows a pin, is drawn in the cut plots as a thick dashed line in the text colour (also when it is not ticked, and alone when no other file is ticked) and is marked by a diamond in the frequency chart.',
      'The Δ vs reference box above the metrics table shows every metric and the gain as the difference from it. The reference row stays first and keeps its own values; the CSV and copy add a Row column saying which is which.',
    ],
  },
  {
    title: 'Ticked files only',
    topic: 'ticked',
    lines: [
      'The box beside Δ vs reference limits the metrics table, Copy table and Export CSV to the ticked files (the pinned reference stays) and says how many of the loaded files are listed.',
      'It is remembered in this browser, not in projects.',
    ],
  },
  {
    title: 'Tilt simulation, horizontal cut',
    topic: 'horizontal-cut',
    lines: [
      'The Simulation bar offers Horizontal cut: Through the beam peak (the default: the file cut, and under a tilt the cut on the cone through the tilted beam peak, the one a data sheet gives) or At the horizon (the cut at 0° elevation).',
      'At the horizon every file shows its horizon cut, tilted or not: no tilt is needed, and a file with built-in tilt shows the cut above its beam straight away.',
      'The vertical cut and its metrics do not depend on the choice.',
      'The plot title, the folded bar, image captions and export headers name the choice; it is saved with the project.',
    ],
  },
  {
    title: 'Horizon cut: what it shows',
    topic: 'horizontal-cut',
    lines: [
      'The horizon cut is read from the 3D reconstruction (an estimate, so the view is marked Simulated); it shows what each antenna puts on the horizon, the widening under mechanical tilt and what is left after a down-tilt.',
      'It can lie many dB below the 3D peak: the read-out under the plot says by how much for the highlighted file, and the Horizon level column (in the table, the CSV, Copy table, Δ vs reference and the Metric menu of the frequency chart while this cut is chosen) says it for every file.',
      'On it, beamwidths, squint and peak azimuth are those of that cut (against its own maximum), while F/B, H-SLS, roll-off and tracking are levels below the 3D peak.',
    ],
  },
  {
    title: 'Horizon cut and the 3D method',
    topic: 'horizontal-cut',
    lines: [
      'With the 3D method Weighted the horizon cut is reshaped by the interpolation itself (it can read twice as wide with no tilt at all): read its level, not its width.',
      'Summation is the reference for it, and the bar says so while both are chosen.',
    ],
  },
  {
    title: 'Not at default',
    topic: 'not-default',
    lines: [
      'The line Not at default, under the toolbar, names what is not at its default and changes the numbers on the page: the tilt sliders, the tilt offsets of files and groups, the horizon cut, the 3D method Weighted and the back of the vertical cut while in use, each changed analysis setting, your sub-bands and Ticked files only.',
      'A click on a chip puts that one thing back; each reset but Ticked files only (one click on its box brings it back) can be undone with the Undo button or Ctrl/Cmd+Z.',
      'With everything at its default there is no line, except while the Simulation bar is open: it then keeps its row and says Numbers at default, so that its first chip moves nothing. While a slider is held the line waits until it is let go.',
      'Not listed: the azimuth, which only turns the drawing, and what is written where the numbers are (the gain unit, Δ vs reference). The line is not in any export.',
    ],
  },
  {
    title: 'Two antennas in Band statistics',
    topic: 'band-compare',
    lines: [
      'Compare with, beside the antenna in Band statistics, puts a second antenna B next to the first one, A: each sub-band then has three columns, A, B and B − A, and No comparison goes back to one antenna.',
      'B − A is a signed difference, never graded better or worse: of the means, with that of the tolerances in brackets, for mean ± tolerance; of the limits for a < or > limit; of the mean gains for a gain at one tilt, naming both tilts where they differ; of the lowest and the highest tilt for the tilt range.',
      'B − A is worked out from the unrounded statistics and written with one decimal, so it can differ by up to 0.1 from the difference of the two values shown.',
      'Where either antenna has no values, too few for a statistic or n/a, the cell shows no difference; † marks a difference partly of "not available" values counted as 22 dB, and * one of a limit moved by the 3 dB excursion rule.',
      'Automatic sub-bands are then made over the files of both antennas. A click on a B − A cell shows the histograms of both antennas on the same bins. Copy table copies the three columns; the band CSV gets a Row column and one difference line per sub-band and parameter. The comparison is saved with the project.',
    ],
  },
  {
    title: 'Frequency chart',
    topic: 'chart',
    lines: [
      'The Metric menu above it plots any table column against frequency, one line per group; the choice is remembered in this browser, not in projects.',
      'Clicking a point highlights that file as a click on its row does (again: clears), and the table scrolls to its row.',
    ],
  },
];

/** Everything Help says about one subject, as one text (its sections, each with its heading). */
export const helpAbout = (topic: HelpSection['topic']): string =>
  HELP_SECTIONS.filter((s) => s.topic === topic)
    .map((s) => `${s.title}: ${s.lines.join(' ')}`)
    .join(' ');

export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: 'Planet file', text: 'A text file with one antenna pattern, as planning tools exchange it (.msi, .pln, .txt): a few header lines (NAME, FREQUENCY, GAIN, TILT …) and two blocks of values, HORIZONTAL and VERTICAL, in dB below the peak, usually one per degree. One port and polarization, one frequency and one electrical tilt per file.' },
  { term: 'Co-polar', text: 'The polarization a port is meant to radiate (for example +45°). A Planet file holds the two co-polar cuts only; the cross-polar part is not in it, so F/B, SPR and AIR are not total-power values.' },
  { term: 'Boresight', text: 'The direction the antenna faces: azimuth 0° of the file. Squint, the sector edges and the D/U aperture are measured from it, not from the beam peak.' },
  { term: 'dBd / dBi', text: 'Two units of gain: dBi is against an isotropic radiator, dBd against a half-wave dipole, and dBi = dBd + 2.15. The two buttons in the toolbar choose the unit shown; a GAIN header without a unit is read as dBd.' },
  { term: 'HPBW', text: 'Half-power beamwidth: the angle between the two points where the pattern is 3 dB below its peak (the level can be changed in Settings; the labels then read BW@x dB instead of HPBW).' },
  { term: 'Squint', text: 'How far the middle of the horizontal beam points away from 0° (the antenna’s boresight).' },
  { term: 'Peak az / Peak tilt', text: 'The azimuth and the elevation of the strongest point of the horizontal and the vertical cut. On an asymmetric beam they differ from Squint and Tilt, which are the middle between the two half-power points.' },
  { term: 'Tilt', text: 'The elevation angle of the vertical beam, positive below the horizon. Electrical tilt is set inside the antenna and is read from the file name (for example 05T) or its header.' },
  { term: 'Tilt error', text: 'Tilt minus the nominal tilt of the file (from its name or header), signed. Not available when the nominal tilt is unknown.' },
  { term: 'Simulation sliders', text: 'Electrical tilt Δ changes the electrical tilt of every file by that much (added to the tilt a file already has): the beam moves along the antenna’s own axis. Mechanical tilt tips the whole antenna: the front goes down and the back comes up. Both change the cuts and the metrics, shown as original → tilted. Azimuth is a pointing direction for a site view: it turns the pattern on the plot (horizontal cut and 3D view) and the metrics are not affected, so the table and its CSV are not called simulated for it; the read-out then says “Squint … (antenna) · pointing …”. A file or a custom group can have its own offsets on top.' },
  { term: '3D method (Summation / Weighted)', text: 'How the 3D pattern is rebuilt from the two cuts of a file. Summation multiplies the two cuts (adds their dB values); Weighted is the cross-weighted combination, which puts more power away from the two cut planes. It is chosen in the Simulation bar and is used by the 3D view, a tilt, the horizon cut and the angular regions; nothing else depends on it.' },
  { term: 'Back of the vertical cut', text: 'A choice beside the 3D method in the Simulation bar ("Use the back of the vertical cut", off by default). Off, the 3D pattern takes the back of the antenna from the azimuth cut alone, combined with the front half of the vertical cut. On, behind the antenna it follows the back half of the vertical cut (straight behind it is that cut, at every elevation), and straight up and straight down it is one value, the vertical cut\'s, from every azimuth; in front of the antenna it is the same as off on the cone of the azimuth cut and changes only towards the poles. It reproduces both measured cuts where they lie. It changes the simulated F/B under a mechanical tilt (no longer the large rise that is an artefact of the two-cut model), the horizon cut behind the antenna, the back of the 3D view and the angular regions (with Summation the lower region gets several times more power, close to what Weighted gives). With it on, the numbers it changes are named with it, as with the 3D method: "[Summation + back of V cut]". Like the method, it is still an estimate from two cuts.' },
  { term: 'Horizon cut', text: 'The simulated horizontal cut at 0° elevation, an alternative to the cut through the beam peak (Simulation bar, Horizontal cut); when chosen it is shown for every file, tilted or not. It is drawn against the 3D peak, so a beam that points below the horizon gives a low cut; its beamwidth is measured against its own maximum and its levels (F/B, H-SLS, roll-off, tracking) below the 3D peak. With the 3D method Weighted the shape of this cut is distorted (an artefact of that interpolation, not of the antenna): read its level, not its width; Summation is the reference for this cut.' },
  { term: 'Horizon level', text: 'A column shown while the horizontal cut is the one at the horizon: how far the strongest point of the horizon cut is below the strongest point of the whole pattern (the 3D peak), in dB. 0 dB means the beam peak is on the horizon; 20 dB means a hundredth of the peak power reaches it. When the level is large, the horizon runs through a sidelobe or a null, and the beamwidths and the squint of that row describe that region, not the main beam.' },
  { term: 'F/B', text: 'Front-to-back ratio: how many dB lower the strongest level behind the antenna (180° ± a window) is than the peak. Bigger is better.' },
  { term: 'USLS', text: 'Upper sidelobe suppression: how far the upper sidelobes are below the peak: the first upper lobe, or the strongest one in a window above the beam, depending on the column. It tells how much energy goes towards neighbouring cells.' },
  { term: 'First LSLS / First USLS', text: 'The level of the first sidelobe below (LSLS) and above (USLS) the main beam of the vertical cut, in dB below the peak: larger is better. A lobe that has merged with the main beam is read at 1.55 × V-HPBW from the peak.' },
  { term: 'Null fill', text: 'How deep the first null below the main beam is. A shallow null fills the dead zone close to the mast; a deep one leaves a hole.' },
  { term: 'H-SLS', text: 'Horizontal sidelobe suppression: the strongest level of the horizontal cut inside the sector beyond the first null on either side of the main beam, in dB below the peak. “—” when there is none, the usual case for a sector panel.' },
  { term: 'Roll-off', text: 'How many dB the pattern has dropped at the sector edges (±60° by default); the worse of the two edges is shown.' },
  { term: 'SPR / AIR', text: 'Sector power ratio: the power outside the sector divided by the power inside, times 100. It is not a share of the total power, so it can exceed 100 % for wide or omnidirectional patterns. AIR is the same comparison the other way round (power inside versus outside), in dB. A low SPR and a high AIR mean the beam stays in its sector.' },
  { term: 'P2P tracking', text: 'Port-to-port tracking: the largest difference over the sector between a pattern and its opposite-polarization partner (+45 and −45, same tilt, array and frequency). Small means the two ports behave alike.' },
  { term: 'D/U aperture', text: 'The width of the azimuth region around 0° where this pattern is at least 15, 20 or 25 dB (16, 64 or 256QAM) stronger than a copy of itself turned to the neighbouring sector (360° divided by the sectors per site).' },
  { term: 'Angular regions (est.)', text: 'An optional column group (off by default) after the angular region efficiency of NGMN BASTA, for a macro panel beam (Type A): Sector efficiency is the share of the radiated power that falls in the service region (inside the sector edges, from half a vertical beamwidth above the beam peak down to 75° below the horizon); Spatial efficiency compares the service region with the service and interference regions together; Lower region ratio is the share radiated steeper than 75° below the horizon. They are estimates from the two co-polar cuts of the file, integrated over the same 3D reconstruction the 3D view shows, and are not BASTA-compliant values: those need the measured full sphere and total power. The numbers follow the 3D method chosen in the Simulation bar (Summation or Weighted, which gives clearly lower efficiencies), so the method is written into the CSV and copied headers and into the frequency chart. Under a mechanical tilt the rotated 3D pattern itself is integrated, not its two simulated cuts: a down-tilt lowers the sector efficiency, because near the sector edges the beam is tilted less. The Lower region ratio is the least reliable of the three: straight down every azimuth is one direction, yet Summation still weights it by the azimuth cut, so its value is too low (Weighted gives three to four times more); the same holds straight up. While the columns are shown, the cut plots tint the regions of the highlighted file (or the only ticked one), with a line under each plot that gives their bounds in degrees.' },
  { term: 'Band statistics', text: 'Mean and tolerance (and percentile limits) of a parameter over all files of one antenna inside a frequency sub-band. They need at least 10 samples per cell (antenna, sub-band and parameter). Sub-bands are automatic unless you define your own with the Sub-bands button; your own are saved with the project (not remembered by the browser), Clear returns to the automatic ones, and a line above the table says when files fall in none of them.' },
];
