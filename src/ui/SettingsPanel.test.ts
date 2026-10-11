// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPanel } from './SettingsPanel';
import { initialState, useStore } from '../state/store';
import { SETTING_LIMITS } from '../core/analysis/settingLimits';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.setState(initialState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(SettingsPanel, { onClose: () => undefined, opener: { current: null } })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const inputFor = (label: string): HTMLInputElement => {
  const span = [...host.querySelectorAll('span')].find((s) => s.textContent?.startsWith(label));
  const input = span?.parentElement?.querySelector('input');
  if (!input) throw new Error(`no field ${label}`);
  return input;
};

function typeAndBlur(input: HTMLInputElement, text: string) {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
}

describe('SettingsPanel limits', () => {
  it('takes min, max and step from the limits table', () => {
    const input = inputFor('F/B window');
    expect(input.min).toBe(String(SETTING_LIMITS.fbWindowDeg.min));
    expect(input.max).toBe(String(SETTING_LIMITS.fbWindowDeg.max));
    expect(inputFor('First-lobe').step).toBe('0.01');
    expect(inputFor('Beamwidth level').min).toBe('0.5');
    expect(inputFor('Plot floor').max).toBe('80');
  });

  it('rejects 400 for the F/B window and keeps the previous value', () => {
    const input = inputFor('F/B window');
    typeAndBlur(input, '400');
    expect(useStore.getState().settings.fbWindowDeg).toBe(30);
    expect(input.value).toBe('30');
  });

  it('rejects 500 for the plot floor and keeps the previous value', () => {
    const input = inputFor('Plot floor');
    typeAndBlur(input, '500');
    expect(useStore.getState().view.floorDb).toBe(40);
    expect(input.value).toBe('40');
  });

  it('commits values inside the range', () => {
    typeAndBlur(inputFor('F/B window'), '180');
    expect(useStore.getState().settings.fbWindowDeg).toBe(180);
    typeAndBlur(inputFor('Plot floor'), '60');
    expect(useStore.getState().view.floorDb).toBe(60);
    typeAndBlur(inputFor('Sectors per site'), '4.5');
    expect(useStore.getState().settings.siteSectors).toBe(3);
  });
});
