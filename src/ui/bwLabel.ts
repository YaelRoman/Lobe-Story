/** The default beamwidth level: the half-power points. */
const HALF_POWER_DB = 3;

const levelText = (levelDb: number): string => String(Number(levelDb.toFixed(2)));

/** "HPBW" at the half-power level, else "BW@10 dB": what the beamwidth columns and plot labels are called at `levelDb`. */
export function bwName(levelDb: number = HALF_POWER_DB): string {
  return levelDb === HALF_POWER_DB ? 'HPBW' : `BW@${levelText(levelDb)} dB`;
}

/** The level ring / marker name: "−3 dB / HPBW", "−10 dB / BW@10 dB". */
export function bwMarkerLabel(levelDb: number = HALF_POWER_DB): string {
  return `−${levelText(levelDb)} dB / ${bwName(levelDb)}`;
}
