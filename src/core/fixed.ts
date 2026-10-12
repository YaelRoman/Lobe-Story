/** A number to a fixed number of decimals, rounded first and without the sign of a zero ("-0.00" becomes "0.00"). */
export function fixed(v: number, digits: number): string {
  const text = v.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}
