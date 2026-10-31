import type { Cancel, Scheduler } from '../adapters';

/** Plain timers, for any platform that keeps them firing (checked for the desktop dock in Phase 2). */
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
