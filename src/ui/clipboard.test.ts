// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copiedRow, copiedRows, copiedValue, copyAndAnnounce, copyText } from './clipboard';

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
    expect(announce).toHaveBeenLastCalledWith('Copied 24 rows');
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('x')) });
    document.execCommand = vi.fn(() => false);
    await copyAndAnnounce('t', 'ok', announce);
    expect(announce).toHaveBeenLastCalledWith('Could not copy to the clipboard');
    expect(copiedRows(1)).toBe('Copied 1 row');
  });
});

describe('what the status line says was copied', () => {
  it('names the value, the row or the number of rows', () => {
    expect(copiedValue('65.0')).toBe('Copied 65.0');
    expect(copiedRow('a.msi')).toBe('Copied row a.msi');
    expect(copiedRow('a.msi', { reference: 'r.msi', isReference: false })).toBe('Copied row a.msi (differences vs r.msi)');
    expect(copiedRow('r.msi', { reference: 'r.msi', isReference: true })).toBe('Copied row r.msi (reference)');
    expect(copiedRows(24)).toBe('Copied 24 rows');
  });
});

describe('the textarea fallback', () => {
  it('selects the whole text for iOS and gives focus back to the element that had it', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    let range: [number | null, number | null] = [null, null];
    document.execCommand = vi.fn(() => {
      const area = document.querySelector('textarea') as HTMLTextAreaElement;
      range = [area.selectionStart, area.selectionEnd];
      return true;
    });
    expect(await copyText('hello')).toBe(true);
    expect(range).toEqual([0, 5]);
    expect(document.activeElement).toBe(button);
  });

  it('calls setSelectionRange(0, length)', async () => {
    const spy = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange');
    document.execCommand = vi.fn(() => true);
    await copyText('abc');
    expect(spy).toHaveBeenCalledWith(0, 3);
  });
});
