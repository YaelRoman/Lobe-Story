import { afterEach, describe, expect, it, vi } from 'vitest';
import { announce, ANNOUNCE_MS, currentAnnouncement, newestSources } from './announce';

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

describe('the status region holds the lines of its newest moment', () => {
  const ORDER = ['load', 'say', 'undo'] as const;
  const none = { load: null, say: null, undo: null };

  it('a source that gets a line is the newest, and replaces the one before', () => {
    expect(newestSources(ORDER, none, none, [])).toEqual([]);
    const loaded = { ...none, load: 'load-1' };
    expect(newestSources(ORDER, none, loaded, [])).toEqual(['load']);
    const said = { ...loaded, say: 'say-1' };
    expect(newestSources(ORDER, loaded, said, ['load'])).toEqual(['say']);
    // An identical sentence said again is a new line (its key counts up).
    expect(newestSources(ORDER, { ...none, say: 'say-1' }, { ...none, say: 'say-2' }, [])).toEqual(['say']);
    // A new line of an earlier source takes over from a later one.
    expect(newestSources(ORDER, said, { ...said, load: 'load-2' }, ['say'])).toEqual(['load']);
  });

  it('nothing new: the newest stays while its line does, and when it goes no older line comes back', () => {
    const both = { load: 'load-1', say: 'say-1', undo: null };
    expect(newestSources(ORDER, both, both, ['say'])).toEqual(['say']);
    expect(newestSources(ORDER, both, { ...both, load: null }, ['say'])).toEqual(['say']); // an older line ran out
    expect(newestSources(ORDER, both, { ...both, say: null }, ['say'])).toEqual([]); // the load line is still shown, and was read
  });

  it('two at the same moment are two messages, and neither replaces the other: both, in the order given', () => {
    // A project opened over a session: what was opened (and what of it could not be loaded), then the offer to undo.
    const together = { load: 'load-1', say: null, undo: 'undo-1' };
    expect(newestSources(ORDER, none, together, [])).toEqual(['load', 'undo']);
    expect(newestSources(ORDER, { ...none, say: 'say-1' }, { ...together, say: 'say-1' }, ['say'])).toEqual(['load', 'undo']);
    // One of the two goes: the other stays, as long as its line does.
    expect(newestSources(ORDER, together, { ...together, undo: null }, ['load', 'undo'])).toEqual(['load']);
    expect(newestSources(ORDER, together, { ...together, load: null }, ['load', 'undo'])).toEqual(['undo']);
    // The next line replaces both: the region never grows beyond what came in one moment.
    expect(newestSources(ORDER, together, { ...together, say: 'say-2' }, ['load', 'undo'])).toEqual(['say']);
    expect(newestSources(ORDER, together, { ...together, undo: 'undo-2' }, ['load', 'undo'])).toEqual(['undo']);
  });
});
