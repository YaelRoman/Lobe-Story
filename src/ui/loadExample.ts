import { useStore } from '../state/store';
import { exampleFiles, EXAMPLE_NOTE } from '../core/exampleSet';

/** Loads the built-in synthetic example through the normal path, so every feature works on it. */
export function loadExample(): void {
  const encoder = new TextEncoder();
  const inputs = exampleFiles().map((f) => {
    const bytes = encoder.encode(f.text);
    return { path: f.name, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  });
  useStore.getState().addFiles(inputs, { note: EXAMPLE_NOTE, noteIsInfo: true });
}
