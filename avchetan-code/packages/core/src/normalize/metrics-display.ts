import { metricChoice } from './metric-edit';
import { formatMetricAmount } from './metric-totals';

/**
 * One line of an activity's numbers in words, with units: *Duration: 20 min · Distance: 3 km*.
 * Exercises get their own lines.
 */
export function metricsText(metrics: Record<string, unknown>): string {
  return Object.entries(metrics)
    .filter(([key]) => key !== 'exercises')
    .map(([key, value]) => {
      const { label } = metricChoice(key);
      const text = typeof value === 'number' ? formatMetricAmount(key, value) : String(value);
      return `${label}: ${text}`;
    })
    .join(' · ');
}

export function exerciseLines(metrics: Record<string, unknown>): string[] {
  const list = Array.isArray(metrics.exercises) ? metrics.exercises : [];
  return list.map((raw) => {
    const item = raw as { name: string; sets?: number; reps?: number; weight_kg?: number };
    const volume = item.sets && item.reps ? ` ${item.sets}×${item.reps}` : '';
    return `${item.name}${volume}${item.weight_kg ? ` @ ${item.weight_kg} kg` : ''}`;
  });
}
