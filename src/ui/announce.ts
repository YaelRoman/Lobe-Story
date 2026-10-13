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
 * Which of the sources of the status region holds its newest line. `before` and `now` give each source's line as a key
 * (null: it has none); `order` breaks a tie between sources that got a new line at the same moment (the last wins).
 * A source that got a new line is the newest. With none, the one that was (`was`) stays while its line does; once
 * that is gone nothing is said: an older line that is still on the screen was read when it came, and is not read
 * again.
 */
export function newestSource<K extends string>(order: readonly K[], before: Record<K, string | null>, now: Record<K, string | null>, was: K | null): K | null {
  const fresh = order.filter((k) => now[k] !== null && now[k] !== before[k]);
  if (fresh.length > 0) return fresh[fresh.length - 1];
  return was !== null && now[was] !== null ? was : null;
}
