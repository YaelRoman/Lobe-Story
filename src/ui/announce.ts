import { useSyncExternalStore } from 'react';

/** How long a spoken-only line stays in the status region (it has been read by then; an old line must not be found there later). */
export const ANNOUNCE_MS = 6_000;

interface Announcement {
  text: string;
  /** Counts every line, so an identical one is a new node and is read again. */
  seq: number;
}

let current: Announcement | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = (next: Announcement | null) => {
  current = next;
  for (const l of listeners) l();
};

/**
 * Says `text` in the page's one status region (see `StatusArea`) without showing anything: for a change that is
 * already visible where it was made, and that a toast would only cover.
 */
export function announce(text: string | null): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (text === null) return emit(null);
  emit({ text, seq: ++seq });
  timer = setTimeout(() => {
    timer = undefined;
    emit(null);
  }, ANNOUNCE_MS);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The line being announced, if any. */
export const currentAnnouncement = (): Announcement | null => current;

export const useAnnouncement = (): Announcement | null => useSyncExternalStore(subscribe, currentAnnouncement);

/**
 * Which sources of the status region are in it: those whose line came in its newest moment. `before` and `now` give
 * each source's line as a key (null: it has none); the answer is in the order of `order`.
 *
 * A new line replaces what the region held: that was read when it came, and left beside the new line it would be
 * found there as one long sentence. Lines that come in the same moment are different messages, though, and neither
 * replaces the other: a project opened over a session brings the line about what was opened (the only place that
 * says what could not be loaded) and the offer to undo, and both are said. So the region never holds more than one
 * line of each source, and only those of one moment.
 *
 * With nothing new, those that were in it (`was`) stay while their lines do. Once they are gone nothing is said: an
 * older line that is still on the screen was read when it came, and is not read again.
 */
export function newestSources<K extends string>(order: readonly K[], before: Record<K, string | null>, now: Record<K, string | null>, was: readonly K[]): K[] {
  const fresh = order.filter((k) => now[k] !== null && now[k] !== before[k]);
  if (fresh.length > 0) return fresh;
  return order.filter((k) => was.includes(k) && now[k] !== null);
}
