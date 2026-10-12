/** One pattern cut: parallel arrays of angle (degrees) and attenuation (dB, positive = below peak). */
export interface Cut {
  angles: number[];
  atten: number[];
}

export type GainUnit = 'dBd' | 'dBi';

export interface Pattern {
  id: string;
  fileName: string;
  /** Display name (a rename, or "<file> (copy n)" for a copy); falls back to fileName. */
  displayName?: string;
  name?: string;
  make?: string;
  frequencyMHz: number;
  gain?: { value: number; unit: GainUnit };
  tilt?: string;
  comment?: string;
  polarization?: string;
  electricalTiltDeg?: number;
  declared: { hBeamwidth?: number; vBeamwidth?: number; frontToBack?: number };
  horizontal: Cut;
  vertical: Cut;
  extraHeaders: Record<string, string>;
}

export type ParseWarningCode =
  | 'unknown-header'
  | 'missing-gain'
  | 'resampled'
  | 'duplicate-angle'
  | 'peak-not-zero'
  | 'gain-out-of-range'
  | 'no-frequency'
  | 'negative-levels'
  | 'frequency-unit';

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  line?: number;
}

export type ParseResult =
  | { ok: true; pattern: Pattern; warnings: ParseWarning[] }
  | { ok: false; error: string; line?: number };

export interface Tags {
  polarization?: string;
  tiltDeg?: number;
  port?: string;
  array?: string;
}

export interface MetricResult {
  value: number | null;
  /** Why the value is null, or a note on how a non-null value was obtained. */
  reason?: string;
  /** Signed angle (degrees) where the value was found, when meaningful. */
  angle?: number;
}
