import { describe, expect, it, beforeEach } from 'vitest';
import {
  useMetricInspectorStore,
  COLUMN_TO_METRIC,
  METRIC_TO_COLUMNS,
  METRIC_COLORS,
} from './metricInspectorState';

describe('metricInspectorState', () => {
  beforeEach(() => {
    useMetricInspectorStore.setState({
      isOpen: false,
      mode: 'solo',
      focusedMetric: null,
      hoveredMetric: null,
    });
    useMetricInspectorStore.getState().selectAllMetrics();
  });

  it('manages drawer open/close state', () => {
    const store = useMetricInspectorStore.getState();
    expect(store.isOpen).toBe(false);

    store.setOpen(true);
    expect(useMetricInspectorStore.getState().isOpen).toBe(true);

    store.toggleOpen();
    expect(useMetricInspectorStore.getState().isOpen).toBe(false);
  });

  it('manages mode switching between solo and multi', () => {
    const store = useMetricInspectorStore.getState();
    expect(store.mode).toBe('solo');

    store.setMode('multi');
    expect(useMetricInspectorStore.getState().mode).toBe('multi');

    store.setMode('solo');
    expect(useMetricInspectorStore.getState().mode).toBe('solo');
  });

  it('toggles solo focusedMetric', () => {
    const store = useMetricInspectorStore.getState();
    expect(store.focusedMetric).toBeNull();

    store.setFocusedMetric('rolloff');
    expect(useMetricInspectorStore.getState().focusedMetric).toBe('rolloff');

    store.setFocusedMetric(null);
    expect(useMetricInspectorStore.getState().focusedMetric).toBeNull();
  });

  it('handles multi-select toggling, select-all, and clear-all', () => {
    const store = useMetricInspectorStore.getState();
    expect(store.activeMetrics.rolloff).toBe(true);

    store.toggleActiveMetric('rolloff');
    expect(useMetricInspectorStore.getState().activeMetrics.rolloff).toBe(false);

    store.clearAllMetrics();
    expect(useMetricInspectorStore.getState().activeMetrics.rolloff).toBe(false);
    expect(useMetricInspectorStore.getState().activeMetrics.hpbw).toBe(false);

    store.selectAllMetrics();
    expect(useMetricInspectorStore.getState().activeMetrics.rolloff).toBe(true);
    expect(useMetricInspectorStore.getState().activeMetrics.hpbw).toBe(true);
  });

  it('maps table column keys to metric IDs correctly', () => {
    expect(COLUMN_TO_METRIC['rollOff']).toBe('rolloff');
    expect(COLUMN_TO_METRIC['hHpbw']).toBe('hpbw');
    expect(COLUMN_TO_METRIC['vHpbw']).toBe('vhpbw');
    expect(COLUMN_TO_METRIC['firstUsls']).toBe('usls');
    expect(COLUMN_TO_METRIC['fbWindow']).toBe('fb');
    expect(COLUMN_TO_METRIC['tracking']).toBe('tracking');
    expect(COLUMN_TO_METRIC['squint']).toBe('squint');
    expect(COLUMN_TO_METRIC['nullFill']).toBe('nullfill');
    expect(COLUMN_TO_METRIC['du16']).toBe('du');
  });

  it('provides color definitions with accents and labels for all metrics', () => {
    const metrics = Object.keys(METRIC_TO_COLUMNS);
    for (const id of metrics) {
      const color = METRIC_COLORS[id];
      expect(color).toBeDefined();
      expect(color.bg).toContain('rgba');
      expect(color.accent).toBeDefined();
      expect(color.label).toBeDefined();
    }
  });
});
