/**
 * The `uid` of a file trace. The charting library builds CSS selectors from a trace's uid (`.cb<uid>` when it
 * clears a plot, `.trace<uid>` when it draws), so a uid must be a plain CSS identifier whatever the series id is:
 * a file name with `(`, `)`, `=`, `<`, `'` or `:` in it made an invalid selector and the redraw threw.
 *
 * The uid is the series id written with letters, digits, `_` and `-` only, behind a prefix that says whether the
 * trace is the reference file's. It is a pure function of the id (the same id gives the same uid on every redraw,
 * which the library's trace matching and the restyle indices rely on), two ids never share one, and
 * `seriesIdOf` reads the id back. Every reader of a uid goes through this file.
 */

const FILE_PREFIX = 'file-';
const REFERENCE_PREFIX = 'ref-';

/** Letters and digits stay as they are; any other UTF-16 unit becomes `_<hex>_`. */
const encode = (id: string): string => id.replace(/[^A-Za-z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
const ENCODED = /^(?:[A-Za-z0-9]|_[0-9a-f]{1,4}_)*$/;
const decode = (text: string): string => text.replace(/_([0-9a-f]{1,4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** The uid of the trace of series `seriesId`; `reference` marks the pinned reference file's trace. */
export function traceUid(seriesId: string, reference = false): string {
  return `${reference ? REFERENCE_PREFIX : FILE_PREFIX}${encode(seriesId)}`;
}

function read(uid: unknown): { seriesId: string; reference: boolean } | null {
  if (typeof uid !== 'string') return null;
  const reference = uid.startsWith(REFERENCE_PREFIX);
  if (!reference && !uid.startsWith(FILE_PREFIX)) return null;
  const body = uid.slice((reference ? REFERENCE_PREFIX : FILE_PREFIX).length);
  if (!ENCODED.test(body)) return null;
  const seriesId = decode(body);
  // Only what `traceUid` writes is read (one spelling per id).
  return traceUid(seriesId, reference) === uid ? { seriesId, reference } : null;
}

/** The series id behind a trace `uid`; null for a trace that is not a file's (no uid, or one made elsewhere). */
export const seriesIdOf = (uid: unknown): string | null => read(uid)?.seriesId ?? null;

/** Whether `uid` is the reference file's trace: it never takes part in dimming and keeps its width. */
export const isReferenceUid = (uid: unknown): boolean => read(uid)?.reference === true;
