/** A number to a fixed number of decimals, rounded first and without the sign of a zero ("-0.00" becomes "0.00"). */
export function fixed(v: number, digits: number): string {
  const text = v.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/** A setting's value as the page writes it: at most two decimals, trailing zeros dropped (an integer stays an integer). */
export const settingText = (value: number): string => String(Number(value.toFixed(2)));
