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
