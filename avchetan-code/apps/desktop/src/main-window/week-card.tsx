import { reviewFindings, weekChangesText, weekTotalsText } from '@avchetan/core';
import { formatLocalDate } from '@avchetan/shared';
import { requestBrief, useBriefMaking, useWeeklyReview, useWeekSummary } from '../queries/brief';
import { QuietButton } from './ui';

const short = (day: string) => formatLocalDate(day, { day: 'numeric', month: 'short' });

/**
 * "Your week" at the top of a Sunday (docs/product/weekly-review.md): the week's numbers, read
 * live, and the patterns saved when Sunday's brief was made.
 */
export function WeekCard(props: { sunday: string }) {
  const summary = useWeekSummary(props.sunday);
  const review = useWeeklyReview(props.sunday);
  const making = useBriefMaking(props.sunday);
  if (!summary.data || summary.data.totals.daysLogged === 0) return null;
  const findings = reviewFindings(review.data);
  const changes = weekChangesText(summary.data);

  return (
    <section
      aria-label="Your week"
      className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-surface-raised p-4"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Your week · {short(summary.data.monday)} – {short(props.sunday)}
      </h2>
      <p className="text-sm">{weekTotalsText(summary.data)}</p>
      {changes ? <p className="text-sm text-ink-muted">{changes}</p> : null}
      {findings.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {findings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">
          {review.isSuccess && !making
            ? 'Not enough days yet to see patterns. They show once a few weeks have entries.'
            : ''}
        </p>
      )}
      <div className="flex items-center gap-2 text-sm">
        {making ? (
          <span className="text-ink-muted">Looking at the week…</span>
        ) : (
          <QuietButton onClick={() => requestBrief(props.sunday)}>
            {findings.length > 0 ? 'Make it again' : 'Look for patterns'}
          </QuietButton>
        )}
        <span className="text-xs text-ink-muted">Also makes this day's brief again.</span>
      </div>
    </section>
  );
}
