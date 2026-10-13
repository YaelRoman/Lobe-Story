// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPanel } from './SettingsPanel';
import { initialState, useStore } from '../state/store';
import { FLOOR_LIMITS, SETTING_LIMITS } from '../core/analysis/settingLimits';
import { SETTING_HELP } from './settingsHelp';

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

  const messageOf = (label: string): string | null => {
    const input = inputFor(label);
    // The field is described by its line of help as well: the message is the other one.
    const id = (input.getAttribute('aria-describedby') ?? '').split(' ').find((x) => x.endsWith('-msg'));
    return id ? (host.querySelector(`#${id}`)?.textContent ?? null) : null;
  };

  it('says why an entry was refused, and drops the message when the user types again', () => {
    const input = inputFor('Beamwidth level');
    typeAndBlur(input, '-5');
    expect(useStore.getState().settings.levelDb).toBe(3);
    expect(messageOf('Beamwidth level')).toBe('Not applied: enter a number from 0.5 to 20 (kept 3).');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('0.5 to 20');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '4');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(messageOf('Beamwidth level')).toBeNull();
  });

  it('Reset clears the "Not applied" messages of every field', () => {
    typeAndBlur(inputFor('Beamwidth level'), '0');
    typeAndBlur(inputFor('Sector edge'), '180');
    typeAndBlur(inputFor('Sectors per site'), '1');
    typeAndBlur(inputFor('Plot floor'), '500');
    for (const l of ['Beamwidth level', 'Sector edge', 'Sectors per site', 'Plot floor']) expect(messageOf(l), l).toContain('Not applied');
    const reset = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reset')!;
    act(() => reset.click());
    expect(host.querySelectorAll('.field-message')).toHaveLength(0);
    expect(host.textContent).not.toContain('Not applied');
    expect(inputFor('Beamwidth level').value).toBe('3');
  });

  it('asks for a whole number where one is needed, and for the plot floor range', () => {
    typeAndBlur(inputFor('Sectors per site'), '4.5');
    expect(messageOf('Sectors per site')).toBe('Not applied: enter a whole number from 2 to 12 (kept 3).');
    typeAndBlur(inputFor('Plot floor'), '3');
    expect(messageOf('Plot floor')).toBe('Not applied: enter a number from 10 to 80 (kept 40).');
  });

  it('tells when the plot floor was raised to clear the level ring', () => {
    typeAndBlur(inputFor('Beamwidth level'), '15');
    typeAndBlur(inputFor('Plot floor'), '12');
    expect(useStore.getState().view.floorDb).toBe(16);
    expect(messageOf('Plot floor')).toContain('Used 16');
  });

  it('raises the plot floor when the level is raised past it, and says so', () => {
    typeAndBlur(inputFor('Plot floor'), '12');
    typeAndBlur(inputFor('Beamwidth level'), '20');
    expect(useStore.getState().view.floorDb).toBe(21);
    expect(useStore.getState().copyNote).toBeNull();
    expect(inputFor('Plot floor').value).toBe('21');
    // The hint beside the field stays while the clamp holds the floor, and goes once the floor is set to something else.
    const hint = () => host.querySelector('[data-testid="floor-raised-hint"]')?.textContent ?? null;
    expect(hint()).toBe('Raised to stay below the −20 dB level');
    typeAndBlur(inputFor('Plot floor'), '30');
    expect(hint()).toBeNull();
  });

  it('shows the accepted range of each setting, from the limits table', () => {
    for (const [label, l] of [
      ['Beamwidth level', SETTING_LIMITS.levelDb],
      ['F/B window', SETTING_LIMITS.fbWindowDeg],
      ['Sectors per site', SETTING_LIMITS.siteSectors],
      ['Plot floor', FLOOR_LIMITS],
    ] as const) {
      const text = [...host.querySelectorAll('span')].find((s) => s.textContent?.startsWith(label))?.textContent ?? '';
      expect(text, label).toContain(`${l.min}–${l.max}`);
    }
  });

  it('says under each setting what it changes, and the field is described by that line', () => {
    for (const [label, key] of [
      ['Beamwidth level', 'levelDb'],
      ['F/B window', 'fbWindowDeg'],
      ['USLS window', 'uslsRangeDeg'],
      ['First-lobe', 'lobeLimitFactor'],
      ['Sector edge', 'sectorEdgeDeg'],
      ['Sectors per site', 'siteSectors'],
      ['Plot floor', 'floorDb'],
    ] as const) {
      const input = inputFor(label);
      const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
      const described = ids.map((id) => host.querySelector(`#${id}`)?.textContent ?? '');
      expect(described, label).toContain(SETTING_HELP[key]);
      // The label is still the field's name alone: the help is not part of it.
      expect(input.closest('label')?.textContent, label).not.toContain(SETTING_HELP[key]);
    }
  });

  it('says what each of the two resets puts back', () => {
    const text = host.textContent ?? '';
    expect(text).toContain(SETTING_HELP.reset);
    expect(text).toContain(SETTING_HELP.resetPreferences);
    const buttons = [...host.querySelectorAll('button')];
    const described = (name: string) => host.querySelector(`#${buttons.find((b) => b.textContent?.trim() === name)?.getAttribute('aria-describedby')}`)?.textContent;
    expect(described('Reset')).toBe(SETTING_HELP.reset);
    expect(described('Reset preferences')).toBe(SETTING_HELP.resetPreferences);
  });
});
