// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { initialState, useStore } from '../state/store';
import { planetText, points } from '../test/planetText';
import { followsDrag, gripByPointer } from './sliderHold';
import { imageExportHeld } from './simCurrent';
import { BEHIND_NOTE, IMAGE_BEHIND_NOTE, WAITING_NOTE } from './updateHint';
import { downloadText } from './download';

// The charting library needs a real browser: the charts are stand-ins that offer their image export as a button.
vi.mock('./PlotlyChart', () => ({
  PlotlyChart: ({ testId, labelledExport }: { testId?: string; labelledExport?: { behind?: boolean; filename?: string } }) =>
    createElement('button', {
      'data-testid': testId,
      onClick: (e: { currentTarget: HTMLElement }) => {
        e.currentTarget.dataset.saved = imageExportHeld(labelledExport?.behind) ? 'held' : (labelledExport?.filename ?? 'image');
      },
    }),
}));
vi.mock('./Pattern3D', () => ({ Pattern3D: () => createElement('div', { 'data-testid': 'plot-3d' }) }));
vi.mock('./download', () => ({ downloadText: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
/** `count` synthetic files, each its own beam. */
const files = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    path: `syn_${1700 + 10 * i}.msi`,
    bytes: enc.encode(
      planetText({
        headers: ['NAME SYN', `FREQUENCY ${1700 + 10 * i}`, 'GAIN 15 dBi', 'TILT ELECTRICAL'],
        h: points((a) => Math.min(40, 3 * (a / (28 + 0.2 * i)) ** 2)),
        v: points((a) => Math.min(40, 3 * ((a - 2 - (i % 5)) / (3.5 + 0.02 * i)) ** 2)),
      }),
    ).buffer as ArrayBuffer,
  }));

let host: HTMLDivElement;
let root: Root;
const copied: string[] = [];

/** The app with `count` files, all ticked. */
async function mount(count: number) {
  act(() => useStore.getState().addFiles(files(count)));
  act(() => useStore.getState().setVisible(useStore.getState().files.map((f) => f.id), true));
  await act(async () => root.render(createElement(App)));
}

beforeEach(() => {
  useStore.setState(initialState());
  vi.mocked(downloadText).mockClear();
  copied.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('navigator', { ...navigator, platform: 'Win32', clipboard: { writeText: async (text: string) => void copied.push(text) } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => void window.dispatchEvent(new Event('blur')));
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const press = () => act(() => gripByPointer({ pointerId: 1, button: 0, isPrimary: true }));
const release = () => act(async () => void window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1 })));
const step = (mechanicalDeg: number) => act(() => useStore.getState().updateSimulation({ mechanicalDeg }));
const typed = (mechanicalDeg: number) => act(async () => useStore.getState().updateSimulation({ mechanicalDeg }));
const button = (name: string, within: ParentNode = host) => Array.from(within.querySelectorAll('button')).find((b) => b.textContent?.trim() === name)!;
const click = (el: HTMLElement) => act(async () => el.click());
const barNote = () => host.querySelector('[data-testid="sim-lag"]')?.textContent ?? null;
const follows = () => host.querySelector('.follows-sim')!;
const tableLine = () => Array.from(host.querySelectorAll('p.count')).find((p) => p.textContent?.startsWith('Simulated:'))?.textContent ?? null;

describe('while a dragged slider is waited for (many files), the page says so where the user looks', () => {
  beforeEach(() => mount(34));

  it('34 ticked files are more than the page follows a drag with', () => {
    expect(followsDrag({ files: 34, drawn: 34, angularRegions: false })).toBe(false);
  });

  it('the sentence stands in the Simulation bar, next to the sliders', async () => {
    expect(barNote()).toBeNull();
    press();
    step(3);
    expect(host.querySelector('.sim-bar-wrap')?.contains(host.querySelector('[data-testid="sim-lag"]'))).toBe(true);
    expect(barNote()).toBe(WAITING_NOTE);
    step(5);
    expect(barNote()).toBe(WAITING_NOTE);
    await release();
    expect(barNote()).toBeNull();
    expect(BEHIND_NOTE).toMatch(/table/);
  });

  it('the table, the band statistics and the frequency chart are marked busy while they show the older simulation', async () => {
    const marked = follows();
    for (const part of ['.metrics', '[data-testid="band-stats"]', '[data-testid="plot-hpbw"]']) expect(marked.querySelector(part), part).not.toBeNull();
    expect(marked.getAttribute('aria-busy')).toBeNull();
    expect(host.querySelector('main')?.hasAttribute('data-sim-behind')).toBe(false);
    press();
    step(4);
    expect(marked.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('main')?.hasAttribute('data-sim-behind')).toBe(true);
    // The table is the one from before the drag: that is what the mark is about.
    expect(tableLine()).toBeNull();
    await release();
    expect(marked.getAttribute('aria-busy')).toBeNull();
    expect(host.querySelector('main')?.hasAttribute('data-sim-behind')).toBe(false);
    expect(tableLine()).toContain('mech +4°');
  });
});

describe('an export taken while a slider is held is of the value the slider shows', () => {
  beforeEach(() => mount(34));

  /** What an export gives after the value was typed (nothing held, the page settled), from a reset bar. */
  async function afterTyping<T>(value: number, take: () => Promise<T>): Promise<T> {
    await release();
    await typed(0);
    await typed(value);
    expect(barNote()).toBeNull();
    return take();
  }
  const lastDownload = () => vi.mocked(downloadText).mock.calls[vi.mocked(downloadText).mock.calls.length - 1];

  it('Export CSV: the same file as after typing the value, and the table has caught up with it', async () => {
    press();
    for (const m of [1, 2.5, 4]) step(m);
    expect(tableLine()).toBeNull();
    await click(button('Export CSV'));
    const held = lastDownload();
    expect(held[0]).toBe('pattern-metrics-simulated.csv');
    // Nothing is behind any more, although the slider is still held.
    expect(tableLine()).toContain('mech +4°');
    expect(barNote()).toBeNull();
    expect(follows().getAttribute('aria-busy')).toBeNull();
    const direct = await afterTyping(4, async () => {
      await click(button('Export CSV'));
      return lastDownload();
    });
    expect(held).toEqual(direct);
    expect(vi.mocked(downloadText)).toHaveBeenCalledTimes(2);
  });

  it('after such an export the next step of the same drag is waited for again, from the exported value', async () => {
    press();
    step(4);
    await click(button('Export CSV'));
    step(6);
    expect(barNote()).toBe(WAITING_NOTE);
    expect(tableLine()).toContain('mech +4°');
    await release();
    expect(tableLine()).toContain('mech +6°');
  });

  it('Copy table: the same rows as after typing the value', async () => {
    press();
    for (const m of [1, 2.5, 4]) step(m);
    await click(button('Copy table', host.querySelector('.metrics')!.closest('section')!));
    const held = copied[copied.length - 1];
    expect(held).toContain('→');
    const direct = await afterTyping(4, async () => {
      await click(button('Copy table', host.querySelector('.metrics')!.closest('section')!));
      return copied[copied.length - 1];
    });
    expect(held).toBe(direct);
    expect(copied).toHaveLength(2);
  });

  it('the band statistics: Export band CSV and Copy table give what they give after typing the value', async () => {
    const band = () => host.querySelector<HTMLElement>('[data-testid="band-stats"]')!;
    press();
    for (const m of [1, 2.5, 4]) step(m);
    await click(button('Export band CSV', band()));
    await click(button('Copy table', band()));
    const held = { csv: lastDownload(), tsv: copied[copied.length - 1] };
    expect(held.csv[0]).toBe('band-statistics-simulated.csv');
    const direct = await afterTyping(4, async () => {
      await click(button('Export band CSV', band()));
      await click(button('Copy table', band()));
      return { csv: lastDownload(), tsv: copied[copied.length - 1] };
    });
    expect(held).toEqual(direct);
  });

  it('a picture cannot be made of what is not drawn yet: its export is held back with the reason, and works once the page has caught up', async () => {
    const chart = () => host.querySelector<HTMLElement>('[data-testid="plot-hpbw"]')!;
    press();
    step(4);
    await click(chart());
    expect(chart().dataset.saved).toBe('held');
    expect(useStore.getState().copyNote).toBe(IMAGE_BEHIND_NOTE);
    await release();
    await click(chart());
    expect(chart().dataset.saved).not.toBe('held');
    expect(chart().dataset.saved).toContain('simulated');
  });
});

describe('with few files (the page follows the drag) nothing of this shows', () => {
  it('no sentence in the bar and no busy mark at any step of a drag', async () => {
    await mount(3);
    const seen: (string | null)[] = [];
    press();
    for (const m of [1, 2, 3, 4]) {
      step(m);
      seen.push(barNote(), follows().getAttribute('aria-busy'), host.querySelector('main')!.getAttribute('data-sim-behind'));
    }
    await release();
    expect(seen.every((s) => s === null)).toBe(true);
    expect(tableLine()).toContain('mech +4°');
  });
});
