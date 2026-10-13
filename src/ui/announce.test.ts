import { afterEach, describe, expect, it, vi } from 'vitest';
import { announce, ANNOUNCE_MS, currentAnnouncement, newestSource } from './announce';

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

describe('the status region holds its newest line alone', () => {
  const ORDER = ['load', 'say', 'undo'] as const;
  const none = { load: null, say: null, undo: null };

  it('a source that gets a line is the newest, and replaces the one before', () => {
    expect(newestSource(ORDER, none, none, null)).toBeNull();
    const loaded = { ...none, load: 'load-1' };
    expect(newestSource(ORDER, none, loaded, null)).toBe('load');
    const said = { ...loaded, say: 'say-1' };
    expect(newestSource(ORDER, loaded, said, 'load')).toBe('say');
    // An identical sentence said again is a new line (its key counts up).
    expect(newestSource(ORDER, { ...none, say: 'say-1' }, { ...none, say: 'say-2' }, null)).toBe('say');
    // A new line of an earlier source takes over from a later one.
    expect(newestSource(ORDER, said, { ...said, load: 'load-2' }, 'say')).toBe('load');
  });

  it('nothing new: the newest stays while its line does, and when it goes no older line comes back', () => {
    const both = { load: 'load-1', say: 'say-1', undo: null };
    expect(newestSource(ORDER, both, both, 'say')).toBe('say');
    expect(newestSource(ORDER, both, { ...both, load: null }, 'say')).toBe('say'); // an older line ran out
    expect(newestSource(ORDER, both, { ...both, say: null }, 'say')).toBeNull(); // the load line is still shown, and was read
  });

  it('two at the same moment: the later in the order, the one to act on', () => {
    expect(newestSource(ORDER, none, { load: 'load-1', say: null, undo: 'undo-1' }, null)).toBe('undo');
  });
});
