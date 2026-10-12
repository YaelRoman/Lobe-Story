/**
 * How many characters of `head` (the start of a name that is cut in the middle) to keep so that they and an ellipsis
 * are not wider than `room`, as `widthOf` measures a text: never all of them (it is asked when the name does not
 * fit), at least one, and never half of a character that takes two code units.
 */
export function fittingHead(head: string, room: number, widthOf: (text: string) => number): number {
  // The places a cut may fall: after each whole character but the last.
  const cuts: number[] = [];
  let at = 0;
  for (const char of head) {
    at += char.length;
    if (at < head.length) cuts.push(at);
  }
  if (cuts.length === 0) return head.length;
  let low = 0;
  let high = cuts.length - 1;
  // The width grows with the length: the last cut that fits is found by halving.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (widthOf(`${head.slice(0, cuts[mid])}…`) <= room) low = mid;
    else high = mid - 1;
  }
  return cuts[low];
}
