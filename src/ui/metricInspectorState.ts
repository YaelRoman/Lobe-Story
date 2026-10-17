import { create } from 'zustand';

export type InspectorMode = 'solo' | 'multi';

export interface MetricInspectorState {
  isOpen: boolean;
  mode: InspectorMode;
  /** When non-null in solo mode, isolates ONLY this metric on the main plots and highlights its table column */
  focusedMetric: string | null;
  /** In multi-select mode, individual metrics toggled on/off */
  activeMetrics: Record<string, boolean>;
  /** Temporary hover preview when hovering over a metric in the inspector or table header */
  hoveredMetric: string | null;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setMode: (mode: InspectorMode) => void;
  setFocusedMetric: (id: string | null) => void;
  toggleActiveMetric: (id: string) => void;
  selectAllMetrics: () => void;
  clearAllMetrics: () => void;
  setHoveredMetric: (id: string | null) => void;
}

export const METRIC_TO_COLUMNS: Record<string, string[]> = {
  hpbw: ['hHpbw', 'hBw10'],
  rolloff: ['rollOff'],
  vhpbw: ['vHpbw', 'vBw10'],
  usls: ['firstUsls', 'usls', 'uslsHorizon', 'uslsMax'],
  fb: ['fbWindow', 'fb180'],
  tracking: ['tracking'],
  squint: ['squint'],
  nullfill: ['nullFill', 'firstLsls'],
  du: ['du16', 'du64', 'du256'],
  hsls: ['hSls'],
  spr: ['spr', 'air'],
};

export const COLUMN_TO_METRIC: Record<string, string> = {
  hHpbw: 'hpbw',
  hBw10: 'hpbw',
  vHpbw: 'vhpbw',
  vBw10: 'vhpbw',
  rollOff: 'rolloff',
  firstUsls: 'usls',
  usls: 'usls',
  uslsHorizon: 'usls',
  uslsMax: 'usls',
  fbWindow: 'fb',
  fb180: 'fb',
  tracking: 'tracking',
  squint: 'squint',
  nullFill: 'nullfill',
  firstLsls: 'nullfill',
  du16: 'du',
  du64: 'du',
  du256: 'du',
  hSls: 'hsls',
  spr: 'spr',
  air: 'spr',
};

export interface MetricColorDef {
  bg: string;
  border: string;
  text: string;
  badge: string;
  accent: string;
  label: string;
}

export const METRIC_COLORS: Record<string, MetricColorDef> = {
  hpbw: { bg: 'rgba(9, 105, 218, 0.15)', border: '#0969da', text: '#0969da', badge: '#0969da', accent: '#0969da', label: 'HPBW' },
  rolloff: { bg: 'rgba(207, 34, 46, 0.15)', border: '#cf222e', text: '#cf222e', badge: '#cf222e', accent: '#cf222e', label: 'Roll-off' },
  vhpbw: { bg: 'rgba(31, 136, 61, 0.15)', border: '#1f883d', text: '#1f883d', badge: '#1f883d', accent: '#1f883d', label: 'V-HPBW' },
  usls: { bg: 'rgba(130, 80, 223, 0.15)', border: '#8250df', text: '#8250df', badge: '#8250df', accent: '#8250df', label: 'USLS' },
  fb: { bg: 'rgba(191, 135, 0, 0.18)', border: '#bf8700', text: '#bf8700', badge: '#bf8700', accent: '#bf8700', label: 'Front-to-Back' },
  tracking: { bg: 'rgba(5, 80, 174, 0.15)', border: '#0550ae', text: '#0550ae', badge: '#0550ae', accent: '#0550ae', label: 'Tracking' },
  squint: { bg: 'rgba(210, 153, 34, 0.18)', border: '#d29922', text: '#d29922', badge: '#d29922', accent: '#d29922', label: 'Squint' },
  nullfill: { bg: 'rgba(26, 127, 55, 0.15)', border: '#1a7f37', text: '#1a7f37', badge: '#1a7f37', accent: '#1a7f37', label: 'Null Fill' },
  du: { bg: 'rgba(102, 57, 186, 0.15)', border: '#6639ba', text: '#6639ba', badge: '#6639ba', accent: '#6639ba', label: 'D/U' },
  hsls: { bg: 'rgba(138, 90, 0, 0.18)', border: '#8a5a00', text: '#8a5a00', badge: '#8a5a00', accent: '#8a5a00', label: 'H-SLS' },
  spr: { bg: 'rgba(9, 105, 218, 0.15)', border: '#0969da', text: '#0969da', badge: '#0969da', accent: '#0969da', label: 'SPR / AIR' },
};

const DEFAULT_ACTIVE: Record<string, boolean> = {
  hpbw: true,
  rolloff: true,
  vhpbw: true,
  usls: true,
  fb: true,
  tracking: true,
  squint: true,
  nullfill: true,
  du: true,
  hsls: true,
  spr: true,
};

export const useMetricInspectorStore = create<MetricInspectorState>((set) => ({
  isOpen: false,
  mode: 'solo',
  focusedMetric: null,
  activeMetrics: DEFAULT_ACTIVE,
  hoveredMetric: null,

  setOpen: (isOpen) => set({ isOpen }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setMode: (mode) => set({ mode }),
  setFocusedMetric: (focusedMetric) => set({ focusedMetric }),
  toggleActiveMetric: (id) =>
    set((s) => ({
      activeMetrics: {
        ...s.activeMetrics,
        [id]: !s.activeMetrics[id],
      },
    })),
  selectAllMetrics: () =>
    set({
      activeMetrics: Object.fromEntries(Object.keys(DEFAULT_ACTIVE).map((k) => [k, true])),
    }),
  clearAllMetrics: () =>
    set({
      activeMetrics: Object.fromEntries(Object.keys(DEFAULT_ACTIVE).map((k) => [k, false])),
      focusedMetric: null,
    }),
  setHoveredMetric: (hoveredMetric) => set({ hoveredMetric }),
}));
