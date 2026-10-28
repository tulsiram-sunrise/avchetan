/** Rolling window of capture durations, for the Phase 2 p95 < 10 ms budget. */
export function createCaptureTimings(windowSize = 100) {
  const samples: number[] = [];
  return {
    record(durationMs: number): void {
      samples.push(durationMs);
      if (samples.length > windowSize) samples.shift();
    },
    count: () => samples.length,
    /** Nearest-rank p95 of the current window; 0 when empty. */
    p95(): number {
      if (samples.length === 0) return 0;
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
    },
  };
}
