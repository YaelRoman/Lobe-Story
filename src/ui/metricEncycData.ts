/**
 * Static data for the Metric Encyclopedia view.
 * Each entry maps to one "page" in the Book view and one row in the Table view.
 * The `cut` and `mode` fields drive the live mini Plotly chart rendered per page.
 */

export type EncycCut = 'H' | 'V';
export type EncycMode = 'polar' | 'rect';

export interface DuTab {
  key: 'qam16' | 'qam64' | 'qam256' | 'all';
  label: string;
  db?: number;
}

export interface EncycAnnotation {
  /** Vertical dashed line at this azimuth/elevation angle (rect plot). */
  vline?: number[];
  /** Horizontal dashed line at this dB level (rect plot). */
  hline?: number[];
  /** Short text labels placed near a vline, e.g. '+60°'. */
  vlineLabels?: string[];
}

export interface EncycMetric {
  id: string;
  name: string;
  definition: string;
  whatFor: string;
  unit: string;
  /** Which cut to draw in the mini chart. */
  cut: EncycCut;
  /** Which mode (polar or rectangular) shows the metric best. */
  mode: EncycMode;
  /** Annotations overlaid on the mini chart. */
  annotations: EncycAnnotation;
  /** For D/U only: show this set of tabs instead of a single chart. */
  duTabs?: DuTab[];
}

export const ENCYC_METRICS: readonly EncycMetric[] = [
  // ── 1. Half-Power Beamwidth ───────────────────────────────────────────────
  {
    id: 'hpbw',
    name: 'Half-Power Beamwidth (HPBW)',
    definition:
      'The angle between the two points of the horizontal radiation pattern that are 3 dB below the main-beam peak, one on each side closest to the peak. Configurable: the level can be changed in Settings; the label then reads "BW@x dB".',
    whatFor:
      'Tells how wide the antenna radiates useful power. A narrower beam focuses energy into the target sector; a wider beam covers more area but at lower gain. Used directly in BASTA 6.1.6 / 7.2.5.1 / 7.2.8.1 to characterise sector antennas.',
    unit: '° (degrees)',
    cut: 'H',
    mode: 'polar',
    annotations: { hline: [-3], vline: [-33, 33], vlineLabels: ['−33° (−3 dB)', '+33° (−3 dB)'] },
  },

  // ── 2. Roll-off ───────────────────────────────────────────────────────────
  {
    id: 'rolloff',
    name: 'Roll-off',
    definition:
      'The level of the horizontal radiation pattern at the sector edges (±60° by default), expressed in dB below the peak. The worse of the two edges is reported.',
    whatFor:
      'Quantifies how much signal reaches the boundary of the sector. A high roll-off means steep attenuation at the edges — good for reducing interference into adjacent cells. Defined in BASTA 7.8.1.4.',
    unit: 'dB (larger = better — more attenuation at the edge)',
    cut: 'H',
    mode: 'rect',
    annotations: { vline: [-60, 60], vlineLabels: ['−60°', '+60°'] },
  },

  // ── 3. Vertical Beamwidth ─────────────────────────────────────────────────
  {
    id: 'vhpbw',
    name: 'Vertical Beamwidth (V-HPBW)',
    definition:
      'The angle between the two points of the vertical (elevation) radiation pattern that are 3 dB below the main-beam peak, measured along the elevation axis.',
    whatFor:
      'Controls coverage in the vertical plane. A narrow vertical beam concentrates energy at a specific tilt angle and reduces interference to neighbouring cells above and below. Critical for network planning in dense urban environments.',
    unit: '° (degrees)',
    cut: 'V',
    mode: 'polar',
    annotations: { hline: [-3], vline: [0.7, 9.3], vlineLabels: ['+0.7° (−3 dB)', '+9.3° (−3 dB)'] },
  },

  // ── 4. Upper Sidelobe Suppression ─────────────────────────────────────────
  {
    id: 'usls',
    name: 'Upper Sidelobe Suppression (USLS)',
    definition:
      'Level of the first (or highest windowed) upper sidelobe of the vertical cut, in dB below the main-beam peak. "First USLS" is the nearest distinct upper lobe; "USLS peak to R°" is the worst lobe from the peak up to R° above it (BASTA 7.8.4.2 – 7.8.4.4).',
    whatFor:
      'Measures how much energy leaks upward into neighbouring tiers of cells or into the sky. High suppression (large dB value) means less inter-tier interference, critical for high-rise scenarios and two-sector vertical reuse.',
    unit: 'dB (larger = better — sidelobe further below peak)',
    cut: 'V',
    mode: 'polar',
    annotations: { hline: [-18] },
  },

  // ── 5. Front-to-Back Ratio ────────────────────────────────────────────────
  {
    id: 'fb',
    name: 'Front-to-Back Ratio (F/B)',
    definition:
      'The highest level found in the azimuth window 180° ± W° (W = F/B window, default 30°), expressed in dB below the main-beam peak. A separate column gives the level at exactly 180°.',
    whatFor:
      'Indicates how well the antenna rejects interference from — or avoids causing interference to — the cell directly behind it. Essential for co-channel and adjacent-channel interference management in cellular networks. BASTA 7.2.9.1.',
    unit: 'dB (larger = better — less radiation behind the antenna)',
    cut: 'H',
    mode: 'polar',
    annotations: { vline: [-180, 180], vlineLabels: ['back (−180°)', 'back (+180°)'] },
  },

  // ── 6. Beam Tracking Distortion (P2P) ─────────────────────────────────────
  {
    id: 'tracking',
    name: 'Beam Tracking Distortion (P2P)',
    definition:
      'The largest point-to-point difference (in dB) across the full sector between this antenna\'s pattern and its cross-polarisation partner (+45° and −45°, same tilt, array and frequency). Gain-aware when both gains are declared.',
    whatFor:
      'Measures how similarly the two polarisation ports behave across the sector. Large differences degrade cross-polar performance and MIMO channel quality. BASTA 7.8.5. Only available when the matching partner file is loaded.',
    unit: 'dB (smaller = better — ports track each other closely)',
    cut: 'H',
    mode: 'polar',
    annotations: { vline: [-60, 60], vlineLabels: ['−60°', '+60°'] },
  },

  // ── 7. Squint ─────────────────────────────────────────────────────────────
  {
    id: 'squint',
    name: 'Squint',
    definition:
      'The midpoint of the two H-HPBW points (at the configured beamwidth level), relative to 0° (the mechanical boresight). Positive squint means the beam points to the right of boresight.',
    whatFor:
      'A non-zero squint shifts the main beam away from the intended direction, causing one-sided coverage degradation. Important for multi-port arrays where each port should share the same electrical boresight. BASTA 7.8.1.5.',
    unit: '° (degrees — ideally 0°)',
    cut: 'H',
    mode: 'polar',
    annotations: { vline: [0] },
  },

  // ── 8. Null Filling ───────────────────────────────────────────────────────
  {
    id: 'nullfill',
    name: 'Null Filling',
    definition:
      'The level of the first null below the main beam in the vertical cut (lower side), in dB below the peak. For a merged first lobe the level is read at 1.55 × V-HPBW below the peak. BASTA 7.8.3.',
    whatFor:
      'A very deep null (high dB value) creates a dead zone close to the base of the mast where users receive little signal. "Filling" the null — raising its level — ensures near-by users are served. Intentional null filling is often a design goal for macro cells.',
    unit: 'dB (smaller = better — shallower null means more coverage near the mast)',
    cut: 'V',
    mode: 'polar',
    annotations: { hline: [-17] },
  },

  // ── 9. D/U Aperture ───────────────────────────────────────────────────────
  {
    id: 'du',
    name: 'Desired / Undesired Aperture (D/U)',
    definition:
      'The width (in degrees) of the contiguous azimuth region around boresight (0°) where this pattern exceeds the strongest copy of itself rotated by 360°/N (N = sectors per site, default 3) by at least the threshold for each modulation order: 15 dB (16QAM), 20 dB (64QAM) or 25 dB (256QAM).',
    whatFor:
      'Directly links the antenna pattern to achievable spectral efficiency. A wider D/U aperture means more of the sector sustains high-order modulation, enabling higher throughput. A narrow aperture limits 64QAM or 256QAM to a small central zone. Tool-defined, inspired by BASTA.',
    unit: '° (degrees — larger = better coverage for that modulation)',
    cut: 'H',
    mode: 'polar',
    annotations: {},
    duTabs: [
      { key: 'qam16', label: '16QAM (15 dB)', db: 15 },
      { key: 'qam64', label: '64QAM (20 dB)', db: 20 },
      { key: 'qam256', label: '256QAM (25 dB)', db: 25 },
      { key: 'all', label: 'All Three (Comparison)' },
    ],
  },

  // ── 10. H-SLS ─────────────────────────────────────────────────────────────
  {
    id: 'hsls',
    name: 'Horizontal Sidelobe Suppression (H-SLS)',
    definition:
      'The highest level of the horizontal cut inside ±S° (S = sector edge, default 60°) beyond the first null on either side of the azimuth main beam, in dB below the peak. Shows "—" when there is no such lobe — the normal case for a narrow-beam sector panel.',
    whatFor:
      'Identifies unwanted in-sector side lobes that could interfere with users inside the serving sector or reduce effective sector gain. More relevant for wide-beam or omnidirectional patterns where multiple lobes can appear within the sector. BASTA 7.8.4.1.',
    unit: 'dB (larger = better — sidelobe further below peak)',
    cut: 'H',
    mode: 'polar',
    annotations: { vline: [-60, 60], vlineLabels: ['−60°', '+60°'] },
  },

  // ── 11. SPR / AIR ─────────────────────────────────────────────────────────
  {
    id: 'spr',
    name: 'Sector Power Ratio (SPR) & Angular Isolation Ratio (AIR)',
    definition:
      'SPR: power outside ±S° divided by power inside, times 100 (%). Can exceed 100 % for wide patterns. AIR: 10·log₁₀(inside / outside) in dB — the same comparison reversed. A low SPR and a high AIR mean the beam stays in its sector. Both from the linear power of the azimuth cut (co-polar only). BASTA 7.8.1.6.',
    whatFor:
      'Measure what fraction of the antenna\'s radiated power actually goes into the intended sector versus spilling outside. High spillage (high SPR, low AIR) wastes capacity and creates inter-sector interference. Together they give a single quality figure for sector containment.',
    unit: 'SPR: % · AIR: dB (SPR smaller = better; AIR larger = better)',
    cut: 'H',
    mode: 'polar',
    annotations: { vline: [-60, 60], vlineLabels: ['−60°', '+60°'] },
  },
];
