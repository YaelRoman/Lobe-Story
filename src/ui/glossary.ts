/** The public repository: the one place its address is written. */
export const REPO_URL = 'https://github.com/YaelRoman/Lobe-Story';
export const METRICS_DOC_URL = `${REPO_URL}/blob/main/docs/metrics.md`;
export const README_URL = `${REPO_URL}#readme`;

export interface GlossaryEntry {
  term: string;
  /** One plain-English line; the exact definitions live in docs/metrics.md. */
  text: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: 'HPBW', text: 'Half-power beamwidth: the angle between the two points where the pattern is 3 dB below its peak (the level can be changed in Settings).' },
  { term: 'Squint', text: 'How far the middle of the horizontal beam points away from 0° (the antenna’s boresight).' },
  { term: 'Tilt', text: 'The elevation angle of the vertical beam, positive below the horizon. Electrical tilt is set inside the antenna and is read from the file name (for example 05T) or its header.' },
  { term: 'F/B', text: 'Front-to-back ratio: how many dB lower the strongest level behind the antenna (180° ± a window) is than the peak. Bigger is better.' },
  { term: 'USLS', text: 'Upper sidelobe suppression: how many dB below the main beam the strongest lobe above it is. It tells how much energy goes towards neighbouring cells.' },
  { term: 'Null fill', text: 'How deep the first null below the main beam is. A shallow null fills the dead zone close to the mast; a deep one leaves a hole.' },
  { term: 'Roll-off', text: 'How many dB the pattern has dropped at the sector edges (±60° by default); the worse of the two edges is shown.' },
  { term: 'SPR / AIR', text: 'Sector power ratio: the power outside the sector divided by the power inside, in percent. AIR is the same comparison the other way round (power inside versus outside), in dB. A low SPR and a high AIR mean the beam stays in its sector.' },
  { term: 'P2P tracking', text: 'Port-to-port tracking: the largest difference over the sector between the two polarization ports (+45 and −45) of the same tilt and frequency. Small means the two ports behave alike.' },
  { term: 'D/U aperture', text: 'The width of the azimuth region around 0° where this pattern is at least 15, 20 or 25 dB (16, 64 or 256QAM) stronger than a copy of itself on the neighbouring sector.' },
  { term: 'Band statistics', text: 'Mean and tolerance (and percentile limits) of a parameter over all files of one antenna inside a frequency sub-band. They need at least 10 files per antenna.' },
];
