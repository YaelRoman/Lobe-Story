/** The default beamwidth level: the half-power points. */
const HALF_POWER_DB = 3;

/** A setting's value as the labels write it: at most two decimals, trailing zeros dropped (an integer stays an integer). */
export const settingText = (value: number): string => String(Number(value.toFixed(2)));

/** "HPBW" at the half-power level, else "BW@10 dB": what the beamwidth columns and plot labels are called at `levelDb`. */
export function bwName(levelDb: number = HALF_POWER_DB): string {
  return levelDb === HALF_POWER_DB ? 'HPBW' : `BW@${settingText(levelDb)} dB`;
}

/** The level ring / marker name: "−3 dB / HPBW", "−10 dB / BW@10 dB". */
export function bwMarkerLabel(levelDb: number = HALF_POWER_DB): string {
  return `−${settingText(levelDb)} dB / ${bwName(levelDb)}`;
}
