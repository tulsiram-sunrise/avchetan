import { useMonthlyUsage } from '../queries/organize';

const number = new Intl.NumberFormat();

/** What this device sent to models this month. Free tiers have limits, so it's worth seeing. */
export function UsageSetting() {
  const usage = useMonthlyUsage();
  const rows = usage.data ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">AI usage this month</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No AI calls from this PC yet this month.</p>
      ) : (
        <table className="w-full max-w-md text-left text-sm">
          <thead className="text-xs text-ink-muted">
            <tr>
              <th className="py-1 font-medium">Provider</th>
              <th className="py-1 text-right font-medium">Calls</th>
              <th className="py-1 text-right font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.provider} className="border-t border-line">
                <td className="py-1">{row.provider}</td>
                <td className="py-1 text-right tabular-nums">{number.format(row.calls)}</td>
                <td className="py-1 text-right tabular-nums">
                  {number.format(row.inputTokens + row.outputTokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
