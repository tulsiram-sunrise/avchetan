const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Display-only formatting in the user's locale and zone (never persisted). */
export function formatTime(instant: string): string {
  return timeFormat.format(Date.parse(instant));
}

export function formatDay(instant: string): string {
  return dayFormat.format(Date.parse(instant));
}

function minutesText(ms: number): string {
  const count = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  return count === 1 ? '1 minute' : `${count} minutes`;
}

/** A duration in plain words, such as "7 minutes". */
export function formatMinutes(ms: number): string {
  return minutesText(ms);
}

/** How long ago, in plain words: "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function formatAgo(instant: string, nowMs: number): string {
  const ms = nowMs - Date.parse(instant);
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${minutesText(ms)} ago`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}
