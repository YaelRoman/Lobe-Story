/** Up to this many file traces keep a Plotly legend; beyond it the file panel swatches are the legend. */
export const FILE_LEGEND_LIMIT = 4;
/** Longest legend entry in characters; longer names keep their start and end. */
export const LEGEND_NAME_MAX = 34;

export const showFileLegend = (traceCount: number): boolean => traceCount > 0 && traceCount <= FILE_LEGEND_LIMIT;

/** Shortens `text` to `max` characters with a middle ellipsis (the distinguishing part is usually the end). */
export function middleEllipsis(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max === 1) return '…';
  const tail = Math.ceil((max - 1) / 2);
  const head = max - 1 - tail;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/**
 * The note under a cut plot that has no legend (more than four traces). "dashed = original" is said only when dashed
 * originals are drawn (a tilt simulation with "Show original"); a pinned reference is the thick dashed line.
 */
export function traceNote(o: { traces: number; byGroup: boolean; originals: boolean; referenceLabel: string | null }): string {
  const colours = `${o.traces} traces: colours as in the file panel${o.originals ? ' (dashed = original)' : ''}`;
  const groups = o.byGroup ? '; more than 10 files: one colour per group, a shade per file' : '';
  const reference = o.referenceLabel !== null ? ` The thick dashed line in the text colour is the reference: ${o.referenceLabel}.` : '';
  return `${colours}${groups}; hover a trace for its name.${reference}`;
}
