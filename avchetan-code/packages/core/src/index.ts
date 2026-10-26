export { buildCaptureInput } from './capture';
export { type ParsedCapture, parseCaptureText } from './normalize/capture-text';
export { METRIC_ALIASES, METRICS, type MetricSpec } from './normalize/metric-keys';
export {
  type Exercise,
  type MetricIssue,
  type NormalizedMetrics,
  normalizeMetrics,
  parseQuantity,
  toSnakeKey,
} from './normalize/metrics';
export { normalizeTagPath, normalizeTagSegment, singularize } from './normalize/tags';
