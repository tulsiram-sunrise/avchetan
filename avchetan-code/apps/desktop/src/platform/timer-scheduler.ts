import type { Cancel, Scheduler } from '@avchetan/shared';

/** Webview timers. They keep firing while the dock is hidden (checked in Phase 2). */
export class TimerScheduler implements Scheduler {
  every(ms: number, task: () => void): Cancel {
    const id = setInterval(task, ms);
    return () => clearInterval(id);
  }

  after(ms: number, task: () => void): Cancel {
    const id = setTimeout(task, ms);
    return () => clearTimeout(id);
  }
}
