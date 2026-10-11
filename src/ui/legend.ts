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
