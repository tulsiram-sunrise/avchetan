import { coverageIsBare, coverageText, type DayCoverage } from '@avchetan/core';
import { useDayCoverage, useDayCoverageOn } from '../queries/days';
import { panelClass } from './ui';

/**
 * How much of the day is accounted for, when turned on in Routines
 * (docs/product/tasks-routines-reminders.md §11). The rest is *unaccounted*, never *wasted*.
 */
export function DayCoverageCard({ day, today }: { day: string; today: string }) {
  const on = useDayCoverageOn().data ?? false;
  const coverage = useDayCoverage(day, today, on && day <= today).data;
  if (!on || !coverage || coverage.periodMin === 0) return null;
  const { headline, parts } = coverageText(coverage);
  return (
    <section aria-label="Day coverage">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Day coverage
      </h2>
      <div className={`${panelClass} gap-2 px-4 py-3`}>
        <p className="text-sm">{headline}</p>
        <CoverageBar coverage={coverage} />
        {parts.length > 0 ? <p className="text-xs text-ink-muted">{parts.join(' · ')}</p> : null}
        {coverageIsBare(coverage) ? (
          <p className="text-xs text-ink-muted">
            Add sleep and work hours in Routines, and say how long things took (“walked for 30
            minutes”), to account for more of your day.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Known hours, then the allowance for small things, then what's unaccounted (empty). */
function CoverageBar({ coverage }: { coverage: DayCoverage }) {
  const share = (minutes: number) => `${(100 * minutes) / coverage.periodMin}%`;
  // The allowance is always inside what's accounted for (a full day is capped, not overfilled).
  const known = coverage.accountedMin - coverage.smallThingsMin;
  return (
    <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-line">
      <div className="bg-accent" style={{ width: share(known) }} />
      <div className="bg-accent/30" style={{ width: share(coverage.smallThingsMin) }} />
    </div>
  );
}
