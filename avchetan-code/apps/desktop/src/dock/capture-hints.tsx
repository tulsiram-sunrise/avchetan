import { dayHints, parseCaptureText } from '@avchetan/core';
import { formatLocalDate } from '@avchetan/shared';
import { useToday } from '../queries/days';

/** A tag at or under a private tag makes the entry private, as at capture. */
const isAtOrUnder = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

const shortDate = (date: string) =>
  formatLocalDate(date, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * What the app reads from the text as it's typed, with no AI (capture-box-redesign.md §5): the
 * tags (🔒 when one makes the entry private) and the dates day words mean. Only hints: the AI
 * still organizes the entry afterwards. The window being noted has its own line.
 */
export function CaptureHints(props: { text: string; privatePaths: readonly string[] }) {
  const today = useToday();
  const tags = parseCaptureText(props.text).tagPaths;
  const days = dayHints(props.text, today);
  if (tags.length === 0 && days.length === 0) return null;
  const chip = 'rounded-full bg-ink/8 px-2 py-0.5';

  return (
    <ul aria-label="What will be saved" className="flex flex-wrap gap-1.5 px-1 pt-1.5 text-xs">
      {tags.map((path) => {
        const secret = props.privatePaths.some((root) => isAtOrUnder(path, root));
        return (
          <li key={`tag-${path}`} className={`${chip} text-ink`}>
            #{path}
            {secret ? <span title="A private tag: this entry stays private"> 🔒</span> : null}
          </li>
        );
      })}
      {days.map((hint) => (
        <li key={`day-${hint.word}`} className={`${chip} text-ink-muted`}>
          <span className="text-ink">{hint.word}</span> → {hint.dates.map(shortDate).join(' or ')}
        </li>
      ))}
    </ul>
  );
}
