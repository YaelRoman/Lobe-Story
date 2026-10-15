const DB_TO_NEPER = Math.LN10 / 10;

// Linear power of 0…120 dB in steps of 1/64 dB. Read with linear interpolation it is within 2e-6 (relative) of the
// exponential, and several times cheaper, which matters for the 65 160 directions of every mechanically tilted file.
const POWER_STEPS_PER_DB = 64;
const POWER_TABLE_DB = 120;
let powerTable: Float64Array | null = null;

function powerSteps(): Float64Array {
  if (!powerTable) {
    powerTable = new Float64Array(POWER_TABLE_DB * POWER_STEPS_PER_DB + 2);
    for (let i = 0; i < powerTable.length; i++) powerTable[i] = Math.exp((-i / POWER_STEPS_PER_DB) * DB_TO_NEPER);
  }
  return powerTable;
}

/**
 * Linear power of a level in dB from the table (linear between its steps); a level outside 0…120 dB by the exponential,
 * and a level that is not a finite number carries none (as in `are.ts`).
 */
export function tablePower(att: number): number {
  if (att >= 0 && att < POWER_TABLE_DB) {
    const table = powerTable ?? powerSteps();
    const x = att * POWER_STEPS_PER_DB;
    const n = x | 0;
    return table[n] + (table[n + 1] - table[n]) * (x - n);
  }
  const p = Math.exp(-att * DB_TO_NEPER);
  return p === p && p !== Infinity ? p : 0;
}
