// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copiedRows, copyAndAnnounce, copyText } from './clipboard';

const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

afterEach(() => {
  setClipboard(undefined);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it('uses the async Clipboard API when there is one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    expect(await copyText('a\tb')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('a\tb');
  });

  it('falls back to a hidden textarea and execCommand without the API, and cleans up', async () => {
    let copied = '';
    document.execCommand = vi.fn(() => {
      copied = (document.querySelector('textarea') as HTMLTextAreaElement).value;
      return true;
    });
    expect(await copyText('x')).toBe(true);
    expect(copied).toBe('x');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back when the API refuses, and reports a failure of both without throwing', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    document.execCommand = vi.fn(() => false);
    expect(await copyText('x')).toBe(false);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    document.execCommand = vi.fn(() => {
      throw new Error('nope');
    });
    expect(await copyText('x')).toBe(false);
  });
});

describe('copyAndAnnounce', () => {
  it('says what was copied, or that it failed', async () => {
    const announce = vi.fn();
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    await copyAndAnnounce('t', copiedRows(24), announce);
    expect(announce).toHaveBeenLastCalledWith('Copied 24 rows', 'info');
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('x')) });
    document.execCommand = vi.fn(() => false);
    await copyAndAnnounce('t', 'ok', announce);
    expect(announce).toHaveBeenLastCalledWith('Could not copy to the clipboard', 'warn');
    expect(copiedRows(1)).toBe('Copied 1 row');
  });
});
