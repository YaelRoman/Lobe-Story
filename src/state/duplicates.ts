/** `dir/a.msi` → `dir/a (n).msi`. */
export function numberedAs(path: string, n: number): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dot = path.lastIndexOf('.');
  const hasExt = dot > slash + 1;
  return `${hasExt ? path.slice(0, dot) : path} (${n})${hasExt ? path.slice(dot) : ''}`;
}

/** `dir/a.msi` → `dir/a (2).msi`, with the first number whose path `taken` does not report. */
export function numberedPath(path: string, taken: (candidate: string) => boolean): string {
  for (let n = 2; ; n++) {
    const candidate = numberedAs(path, n);
    if (!taken(candidate)) return candidate;
  }
}

/** Whether a file named `path` (or one of its numbered copies `path (2)`, `(3)`, ...) already holds `text`. */
export function hasSameNameAndText(path: string, text: string, textOf: (path: string) => string | undefined): boolean {
  if (textOf(path) === text) return true;
  for (let n = 2; textOf(numberedAs(path, n)) !== undefined; n++) {
    if (textOf(numberedAs(path, n)) === text) return true;
  }
  return false;
}

export interface LoadCounts {
  /** Files that parsed. */
  loaded: number;
  /** Files that were read but are not valid patterns (listed under Errors). */
  failed: number;
  /** Same name and same content as a loaded file: not added again. */
  skipped: number;
  /** Same name, different content: added as a second, numbered entry. */
  renamed: number;
  /** Files the browser could not read at all. */
  unreadable: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line for the status bar after a load: loaded / failed / duplicate counts. */
export function loadSummary(c: LoadCounts): string {
  const parts: string[] = [];
  if (c.loaded > 0) parts.push(`Loaded ${plural(c.loaded, 'file', 'files')}`);
  if (c.failed > 0) parts.push(`${c.failed} could not be parsed`);
  if (c.unreadable > 0) parts.push(`${c.unreadable} could not be read`);
  if (c.skipped > 0) parts.push(`${c.skipped} already loaded (skipped)`);
  if (c.renamed > 0) {
    parts.push(`${c.renamed} same-name ${c.renamed === 1 ? 'file' : 'files'} with different content added as ${c.renamed === 1 ? 'a numbered copy' : 'numbered copies'}`);
  }
  if (parts.length === 0) return 'Nothing new was loaded';
  const text = parts.join(' · ');
  return c.loaded === 0 ? `No new files loaded: ${text}` : text;
}
