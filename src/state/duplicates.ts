const baseNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

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

/** The file name of `path` without a duplicate's number: `dir/a (2).msi` → `a.msi`. */
export function plainName(path: string): string {
  return baseNameOf(path).replace(/ \(\d+\)(?=\.[^.]*$|$)/, '');
}

/** Text with every line ending as `\n`, so the same file saved on another system compares equal. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * A short, stable fingerprint of a file's content (line endings normalised): its length and a
 * 32-bit FNV-1a hash, e.g. `1k3-9f2c01ab`. Identifies a file a layout-only project is waiting for.
 */
export function fingerprint(text: string): string {
  const t = normalizeText(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${t.length.toString(36)}-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** Whether `v` has the shape `fingerprint` produces (project files are hand-editable). */
export function isFingerprint(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-z]{1,12}-[0-9a-f]{8}$/.test(v);
}

/** A file a layout-only project still needs: its saved path and, when known, its content fingerprint. */
export interface PendingFile {
  path: string;
  fp?: string;
}

/** A file already in the session, as far as duplicate handling cares. */
export interface KnownFile {
  id: string;
  path: string;
  text: string;
  /** Whether it parsed. */
  ok: boolean;
}

/** A file of the selection being loaded. */
export interface IncomingFile {
  path: string;
  text: string;
  /** Whether it parses. */
  ok: boolean;
}

/** One file to put into the session. */
export interface LoadAddition {
  /** Index into the incoming list. */
  index: number;
  id: string;
  path: string;
  /** It satisfied a pending project entry (and keeps the state saved for that path). */
  matched: boolean;
  /** The id of the failed entry it takes the place of, if any. */
  replaces?: string;
}

export interface LoadPlan {
  add: LoadAddition[];
  /** Pending entries nothing in the selection satisfied. */
  pending: PendingFile[];
  counts: Omit<LoadCounts, 'unreadable'>;
}

/** The id of a failed file that shares its path with a file that loaded. */
const failedId = (path: string) => `${path}#failed`;

function uniqueIndex<T>(items: T[], test: (item: T) => boolean): number {
  const first = items.findIndex(test);
  return first >= 0 && !items.some((item, i) => i > first && test(item)) ? first : -1;
}

/**
 * Decides what a selection of files does to the session. Pure: no parsing, no store.
 *
 * A file a layout-only project is waiting for loads under the pending path. It is recognised, in
 * this order, by (1) its content fingerprint, (2) its exact path, (3) its file name when exactly
 * one pending entry has that name — first as written, then with a duplicate's " (n)" ignored, so
 * `a.msi` can satisfy a pending `a (2).msi`. Fingerprints are matched for the whole selection
 * before any path or name, so an edited file cannot take the entry of an unchanged one next to it.
 *
 * Any other file whose content (line endings aside) equals that of a loaded file of the same name
 * — whatever its folder or number — is skipped. A same-name file with other content is kept under
 * the smallest free number. A file that does not parse is never numbered: it replaces an earlier
 * failed entry of its path, or is listed once more with the id `path#failed`.
 */
export function planLoad(existing: KnownFile[], pendingFiles: PendingFile[], incoming: IncomingFile[]): LoadPlan {
  const known = new Map<string, { path: string; norm: string; ok: boolean }>();
  for (const f of existing) known.set(f.id, { path: f.path, norm: normalizeText(f.text), ok: f.ok });
  const pending = [...pendingFiles];
  const takePending = (i: number): string => pending.splice(i, 1)[0].path;

  // Pass 1: fingerprints, for the whole selection.
  const target: (string | undefined)[] = incoming.map(() => undefined);
  if (pending.some((p) => p.fp !== undefined)) {
    incoming.forEach((f, i) => {
      const fp = fingerprint(f.text);
      const same = (p: PendingFile) => p.fp === fp;
      let at = pending.findIndex((p) => same(p) && p.path === f.path);
      if (at < 0) at = pending.findIndex((p) => same(p) && plainName(p.path) === plainName(f.path));
      if (at < 0) at = pending.findIndex(same);
      if (at >= 0) target[i] = takePending(at);
    });
  }

  const add: LoadAddition[] = [];
  const counts = { loaded: 0, failed: 0, skipped: 0, renamed: 0 };
  const failedAt = (path: string): string | undefined => {
    for (const [id, k] of known) if (!k.ok && k.path === path) return id;
    return undefined;
  };
  const put = (index: number, id: string, path: string, matched: boolean, replaces?: string) => {
    const f = incoming[index];
    if (replaces !== undefined && replaces !== id) known.delete(replaces);
    known.set(id, { path, norm: normalizeText(f.text), ok: f.ok });
    add.push({ index, id, path, matched, ...(replaces !== undefined ? { replaces } : {}) });
    if (f.ok) counts.loaded++;
    else counts.failed++;
  };

  incoming.forEach((f, index) => {
    const norm = normalizeText(f.text);
    const name = plainName(f.path);
    const isLoaded = () => [...known.values()].some((k) => k.norm === norm && plainName(k.path) === name);
    let path = target[index];
    let matched = path !== undefined;

    if (path === undefined && f.ok) {
      // Only a file that parses may claim a pending entry by path or name.
      const exact = pending.findIndex((p) => p.path === f.path);
      if (exact >= 0) {
        path = takePending(exact);
      } else if (isLoaded()) {
        counts.skipped++;
        return;
      } else {
        const base = baseNameOf(f.path);
        let at = uniqueIndex(pending, (p) => baseNameOf(p.path) === base);
        if (at < 0) at = uniqueIndex(pending, (p) => plainName(p.path) === name);
        if (at >= 0) path = takePending(at);
      }
      matched = path !== undefined;
    }
    path ??= f.path;

    const failed = failedAt(path);
    if (!f.ok) {
      // Listed under Errors, once per path: in place of the earlier failure, else next to the good file.
      put(index, failed ?? (known.has(path) ? failedId(path) : path), path, matched, failed);
      return;
    }
    const holder = known.get(path);
    if (!holder || !holder.ok) {
      // Free, or held by a failed entry of this path (whatever its id): the good file takes over.
      put(index, path, path, matched, failed);
      return;
    }
    if (isLoaded()) {
      counts.skipped++;
      return;
    }
    const numbered = numberedPath(path, (p) => known.has(p) || pending.some((x) => x.path === p));
    put(index, numbered, numbered, matched);
    counts.renamed++;
  });

  return { add, pending, counts };
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
  if (c.failed > 0) parts.push(`${c.failed} could not be loaded`);
  if (c.unreadable > 0) parts.push(`${c.unreadable} could not be read`);
  if (c.skipped > 0) parts.push(`${c.skipped} already loaded (skipped)`);
  if (c.renamed > 0) {
    parts.push(`${c.renamed} same-name ${c.renamed === 1 ? 'file' : 'files'} with different content added as ${c.renamed === 1 ? 'a numbered copy' : 'numbered copies'}`);
  }
  if (parts.length === 0) return 'Nothing new was loaded';
  const text = parts.join(' · ');
  return c.loaded === 0 ? `No new files loaded: ${text}` : text;
}

/** A load is "clean" (neutral colour, goes away by itself) only when every file simply loaded. */
export function isCleanLoad(c: LoadCounts): boolean {
  return c.loaded > 0 && c.failed === 0 && c.unreadable === 0 && c.skipped === 0 && c.renamed === 0;
}
