import type { Pattern } from './types';

/** The name shown for a pattern: its display name, else its file name. */
export const nameOf = (p: Pattern): string => p.displayName ?? p.fileName;
