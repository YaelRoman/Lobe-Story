import { afterEach, describe, expect, it, vi } from 'vitest';
import { announce, ANNOUNCE_MS, currentAnnouncement } from './announce';

describe('announce', () => {
  afterEach(() => {
    announce(null);
    vi.useRealTimers();
  });

  it('holds the line for the status region and drops it after a while', () => {
    vi.useFakeTimers();
    announce('Horizontal cut at the horizon');
    expect(currentAnnouncement()?.text).toBe('Horizontal cut at the horizon');
    vi.advanceTimersByTime(ANNOUNCE_MS - 1);
    expect(currentAnnouncement()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(currentAnnouncement()).toBeNull();
  });

  it('an identical line is a new announcement, and restarts the time it stays', () => {
    vi.useFakeTimers();
    announce('same');
    const first = currentAnnouncement()!.seq;
    vi.advanceTimersByTime(ANNOUNCE_MS - 1);
    announce('same');
    expect(currentAnnouncement()!.seq).toBeGreaterThan(first);
    vi.advanceTimersByTime(ANNOUNCE_MS - 1);
    expect(currentAnnouncement()?.text).toBe('same');
  });
});
