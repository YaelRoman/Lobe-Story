import { looksLikePlanetText, parsePlanet } from '../core/parse/planet';
import { decodeText } from './decode';

export interface FileInput {
  path: string;
  bytes: ArrayBuffer;
  /** The name does not say it is a pattern file (another extension, or none): it was taken for one by its content. */
  byContent?: boolean;
}

/** A file from a selection or drop that may be a saved project (see `isProjectCandidate`). */
export interface ProjectCandidate {
  path: string;
  text: string;
}

/** Result of reading a selection or drop: the files that read OK, and how many did not. */
export interface ReadInputsResult {
  inputs: FileInput[];
  projects: ProjectCandidate[];
  failed: number;
}

/**
 * Whether a file of a selection is read as a possible project. A folder or a multi-file drop can
 * hold any `.json` (exports, settings of other tools), so there only the app's own
 * `.lobestory.json` counts; a `.json` picked or dropped on its own always does.
 */
export function isProjectCandidate(path: string, soleFile: boolean): boolean {
  return /\.lobestory\.json$/i.test(path) || (soleFile && /\.json$/i.test(path));
}

/** What to do with a selection, from how many pattern files and project candidates it holds. */
export type SelectionPlan =
  /** Load the pattern files; `ignoredProjects` candidates (two or more) were left unopened. */
  | { kind: 'patterns'; ignoredProjects: number }
  /** The one candidate is all there is: open it. */
  | { kind: 'project' }
  /** Pattern files and exactly one candidate: ask which the user meant. */
  | { kind: 'ask' };

export function planSelection(patterns: number, projects: number): SelectionPlan {
  if (projects === 1) return patterns > 0 ? { kind: 'ask' } : { kind: 'project' };
  return { kind: 'patterns', ignoredProjects: projects };
}

export function isPatternFile(path: string): boolean {
  return /\.(msi|pln|txt)$/i.test(path);
}

/** How much of a file that is not a pattern file by its name is looked at to see whether it is one by its content. */
export const SNIFF_BYTES = 4096;

/**
 * A file whose name does not say what it is (not .msi/.pln/.txt, not a project): its bytes when its content is a
 * Planet pattern, else null. Only its start is read first, so a folder of photos costs next to nothing. Among other
 * files it must be a valid pattern (notes with a line "Name …" look like one and are none); `sole`, the one file the
 * user picked, is taken as soon as it looks like one, so that the reason it does not load is shown.
 */
async function patternByContent(file: Blob, name: string, sole: boolean): Promise<ArrayBuffer | null> {
  if (/\.json$/i.test(name)) return null;
  if (!looksLikePlanetText(decodeText(await file.slice(0, SNIFF_BYTES).arrayBuffer()))) return null;
  const bytes = await file.arrayBuffer();
  return sole || parsePlanet(decodeText(bytes), name).ok ? bytes : null;
}

export async function inputsFromFileList(list: FileList): Promise<ReadInputsResult> {
  const inputs: FileInput[] = [];
  const projects: ProjectCandidate[] = [];
  let failed = 0;
  const files = Array.from(list);
  // A folder pick gives every file a relative path; one file picked by itself has none.
  const sole = files.length === 1 && !files[0].webkitRelativePath;
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    try {
      if (isPatternFile(path)) inputs.push({ path, bytes: await file.arrayBuffer() });
      else if (isProjectCandidate(path, sole)) projects.push({ path, text: await file.text() });
      else {
        const bytes = await patternByContent(file, path, sole);
        if (bytes) inputs.push({ path, bytes, byContent: true });
      }
    } catch {
      failed++;
    }
  }
  return { inputs, projects, failed };
}

/** Reads dropped files and folders (recursively). Entries are captured synchronously, before any await. */
export async function inputsFromDataTransfer(dt: DataTransfer): Promise<ReadInputsResult> {
  const entries = Array.from(dt.items)
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  const sole = entries.length === 1 && entries[0].isFile;
  const inputs: FileInput[] = [];
  const projects: ProjectCandidate[] = [];
  let failed = 0;
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const path = prefix + entry.name;
      const pattern = isPatternFile(path);
      try {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        if (pattern) inputs.push({ path, bytes: await file.arrayBuffer() });
        else if (isProjectCandidate(path, sole)) projects.push({ path, text: await file.text() });
        else {
          const bytes = await patternByContent(file, path, sole);
          if (bytes) inputs.push({ path, bytes, byContent: true });
        }
      } catch {
        failed++;
      }
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        try {
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        } catch {
          failed++;
          break;
        }
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length > 0);
    }
  };
  for (const entry of entries) await walk(entry, '');
  return { inputs, projects, failed };
}
