/**
 * A built-in SYNTHETIC example: one fictional dual-polarised panel, "Example antenna", as Planet text.
 * Nothing here is a measurement or derived from a real antenna: every cut is a formula (a smooth main
 * beam plus a few fixed sidelobes and a back lobe) with small, deterministic frequency, tilt and
 * polarization dependences so that tracking, squint and the band statistics are not trivially zero.
 * The output is a pure function of the constants below: no randomness, no clock.
 */

export const EXAMPLE_PREFIX = 'example_';
export const EXAMPLE_NOTE = 'Loaded the built-in synthetic example (not a real antenna)';
/** The status line after the example was loaded into an empty session. */
export const exampleLoadedMessage = (fileCount: number): string => `Loaded the built-in synthetic example: ${fileCount} files (not a real antenna)`;
export const EXAMPLE_FREQUENCIES_MHZ = [1710, 1795, 2110, 2170] as const;
export const EXAMPLE_TILTS_DEG = [2, 5, 8] as const;

export interface ExampleFile {
  /** File name in a convention the grouping reads: example_<MHz>_<P|M>45_<NN>T.msi */
  name: string;
  /** The file's Planet text. */
  text: string;
}

type Polarization = 1 | -1;

/** The nominal figures of one file, also written to the header as the "declared" values. */
export interface ExampleSpec {
  frequencyMHz: number;
  tiltDeg: number;
  pol: Polarization;
  gainDbd: number;
  hBeamwidthDeg: number;
  vBeamwidthDeg: number;
  /** Horizontal beam direction (squint), ±45 ports leaning slightly opposite ways. */
  hCenterDeg: number;
  frontToBackDb: number;
}

export function exampleSpec(frequencyMHz: number, tiltDeg: number, pol: Polarization): ExampleSpec {
  const fr = (frequencyMHz - 1710) / 460; // 0 at the bottom of the lower band, 1 at the top of the upper one
  return {
    frequencyMHz,
    tiltDeg,
    pol,
    gainDbd: round(16 + 0.6 * fr - 0.04 * tiltDeg + 0.08 * pol, 2),
    hBeamwidthDeg: round(66 * Math.pow(1710 / frequencyMHz, 0.35) + 0.15 * tiltDeg - 0.7 * pol * (0.4 + fr), 1),
    vBeamwidthDeg: round(8.6 * Math.pow(1710 / frequencyMHz, 0.9) + 0.05 * tiltDeg, 1),
    hCenterDeg: round(pol * (0.7 + 0.9 * fr), 2),
    frontToBackDb: round(28 + 1.5 * Math.sin(frequencyMHz / 90) - 0.2 * tiltDeg, 1),
  };
}

const round = (x: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
};

const signedDeg = (a: number): number => (a > 180 ? a - 360 : a);
const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
/** A bump of width `w` around `c`, measured round the circle so a lobe at 180° is continuous across ±180°. */
const gauss = (x: number, c: number, w: number): number => Math.exp(-((wrap(x - c) / w) ** 2));
/** Amplitude of a level given in dB below the peak. */
const amp = (db: number): number => 10 ** (-db / 20);
/** Amplitude of a main beam whose −3 dB width is `width`: a Gaussian in amplitude. */
const mainBeam = (x: number, center: number, width: number): number => amp(12 * ((x - center) / width) ** 2);

interface Lobe {
  /** Centre as a multiple of the beamwidth (V cut) or in degrees (H cut), level in dB below the peak, width. */
  at: number;
  db: number;
  w: number;
  sign: 1 | -1;
}

const floorDb = 45;

/** Attenuation (dB below the peak, ≥ 0, exactly 0 at the peak) of a sum of a main beam and signed lobes. */
function attenuation(values: number[]): number[] {
  const att = values.map((v) => -20 * Math.log10(Math.max(Math.abs(v), amp(floorDb))));
  const min = Math.min(...att);
  return att.map((a) => round(a - min, 2));
}

function hCut(s: ExampleSpec): number[] {
  const W = s.hBeamwidthDeg;
  const backLevel = s.frontToBackDb + 2;
  const lobes: Lobe[] = [
    { at: -78, db: 24, w: 14, sign: -1 },
    { at: 78, db: 25, w: 14, sign: -1 },
    { at: -122, db: 28, w: 18, sign: 1 },
    { at: 125, db: 29, w: 18, sign: 1 },
    { at: 180, db: backLevel, w: 38, sign: -1 },
  ];
  const out: number[] = [];
  for (let a = 0; a < 360; a++) {
    const x = signedDeg(a);
    let v = mainBeam(x, s.hCenterDeg, W);
    for (const l of lobes) v += l.sign * amp(l.db) * gauss(x, l.at, l.w);
    out.push(v);
  }
  return attenuation(out);
}

function vCut(s: ExampleSpec): number[] {
  const B = s.vBeamwidthDeg;
  // Elevation is positive below the horizon; the beam points at the tilt. Upper lobes are the negative side.
  const lobes: Lobe[] = [
    { at: -1.55, db: 18, w: 0.45, sign: -1 },
    { at: 1.6, db: 17, w: 0.45, sign: -1 },
    { at: -2.7, db: 22, w: 0.55, sign: 1 },
    { at: 2.85, db: 23, w: 0.55, sign: 1 },
    { at: -4.4, db: 28, w: 0.8, sign: -1 },
    { at: 4.6, db: 29, w: 0.8, sign: -1 },
  ];
  const out: number[] = [];
  for (let a = 0; a < 360; a++) {
    const x = signedDeg(a);
    let v = mainBeam(x, s.tiltDeg, B);
    for (const l of lobes) v += l.sign * amp(l.db) * gauss(x, s.tiltDeg + l.at * B, l.w * B);
    // Behind the panel: a broad, low back lobe.
    v += amp(36) * gauss(x, 180, 40);
    out.push(v);
  }
  return attenuation(out);
}

const block = (name: string, att: number[]): string[] => [
  `${name} ${att.length}`,
  ...att.map((v, a) => `${a.toFixed(1)} ${v.toFixed(2)}`),
];

/** The Planet text of one file. */
export function examplePlanetText(s: ExampleSpec): string {
  const lines = [
    'NAME Example antenna',
    'MAKE Synthetic example',
    `FREQUENCY ${s.frequencyMHz}`,
    `GAIN ${s.gainDbd.toFixed(2)} dBd`,
    'TILT ELECTRICAL',
    `H_WIDTH ${s.hBeamwidthDeg}`,
    `V_WIDTH ${s.vBeamwidthDeg}`,
    `FRONT_TO_BACK ${s.frontToBackDb}`,
    'COMMENT Synthetic example generated in code; not a real antenna',
    ...block('HORIZONTAL', hCut(s)),
    ...block('VERTICAL', vCut(s)),
  ];
  return lines.join('\r\n') + '\r\n';
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The whole example set: every frequency × tilt × (+45, −45). 24 files, two sub-bands of 12. */
export function exampleFiles(): ExampleFile[] {
  const out: ExampleFile[] = [];
  for (const tilt of EXAMPLE_TILTS_DEG) {
    for (const f of EXAMPLE_FREQUENCIES_MHZ) {
      for (const pol of [1, -1] as const) {
        out.push({
          name: `${EXAMPLE_PREFIX}${f}_${pol === 1 ? 'P' : 'M'}45_${pad2(tilt)}T.msi`,
          text: examplePlanetText(exampleSpec(f, tilt, pol)),
        });
      }
    }
  }
  return out;
}
