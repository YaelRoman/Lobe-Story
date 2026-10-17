import { describe, expect, it } from 'vitest';
import { ENCYC_METRICS } from './metricEncycData';
import { METRIC_COLORS } from './metricInspectorState';

describe('MetricResultHud requirements', () => {
  it('covers all metrics with colors and definitions', () => {
    for (const m of ENCYC_METRICS) {
      const color = METRIC_COLORS[m.id];
      expect(color).toBeDefined();
      expect(color.accent).toBeDefined();
      expect(m.name).toBeTruthy();
      expect(m.unit).toBeDefined();
    }
  });
});
