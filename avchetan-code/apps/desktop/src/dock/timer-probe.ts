import { createLogger } from '@avchetan/shared';

const log = createLogger('timer-probe');

/**
 * Dev-only check for the Phase 2 criterion "timers keep firing while the dock is hidden":
 * logs how late each interval fired. Large lateness while hidden means WebView2 throttles
 * the dock and the Rust heartbeat is needed (docs/architecture/desktop.md#background-work).
 */
export function startTimerProbe(intervalMs = 30_000, perfNow = () => performance.now()) {
  let expected = perfNow() + intervalMs;
  const id = setInterval(() => {
    const now = perfNow();
    log.debug('tick', { lateMs: Math.round(now - expected), hidden: document.hidden });
    expected = now + intervalMs;
  }, intervalMs);
  return () => clearInterval(id);
}
