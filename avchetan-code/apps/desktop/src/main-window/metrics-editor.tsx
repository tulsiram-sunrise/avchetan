import {
  applyMetricRows,
  type MetricRow,
  type MetricRowProblem,
  metricChoicesFor,
  metricRows,
  nextMetricKey,
} from '@avchetan/core';
import type { Activity } from '@avchetan/db/sqlite';
import { useEffect, useRef, useState } from 'react';
import { useAction } from '../queries/organize';
import { ActionError, fieldClass, QuietButton } from './ui';

/**
 * An activity's numbers, one row each: what it is (in words, with its unit) and the value.
 * Typed units are converted (5 mi → 8.05 km). Saving marks the activity *edited* and teaches the
 * AI (docs/product/finding-and-using-data.md#3-editing-an-activitys-numbers).
 */
export function MetricsEditor(props: { activity: Activity; onClose: () => void }) {
  const { activity } = props;
  const edit = useAction('activity.edit');
  const choices = metricChoicesFor(activity.metrics);
  const [rows, setRows] = useState<MetricRow[]>(() => {
    const current = metricRows(activity.metrics);
    return current.length > 0 ? current : [{ key: nextMetricKey([]), value: '' }];
  });
  const [problems, setProblems] = useState<MetricRowProblem[]>([]);
  // The value field to focus: the first when the editor opens, a new row's when one is added.
  const form = useRef<HTMLFormElement>(null);
  const [focusRow, setFocusRow] = useState<number | null>(0);
  useEffect(() => {
    if (focusRow === null) return;
    form.current?.querySelectorAll<HTMLInputElement>('input[data-value]')[focusRow]?.focus();
    setFocusRow(null);
  }, [focusRow]);

  const change = (index: number, patch: Partial<MetricRow>) => {
    setRows((all) => all.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setProblems([]);
  };
  const save = () => {
    const result = applyMetricRows(activity.metrics, rows);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    edit.mutate({ id: activity.id, metrics: result.metrics }, { onSuccess: props.onClose });
  };

  return (
    <form
      ref={form}
      aria-label={`Numbers of ${activity.title}`}
      className="flex flex-col gap-2 rounded-lg border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      {rows.map((row, index) => {
        const choice = choices.find((c) => c.key === row.key);
        const problem = problems.find((p) => p.index === index);
        return (
          // Rows have no ID; the index is their identity while the editor is open.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <div key={index} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Number ${index + 1}`}
                className={`${fieldClass} text-xs`}
                value={row.key}
                onChange={(event) => change(index, { key: event.target.value })}
              >
                {choices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                    {c.unit ? ` (${c.unit})` : ''}
                  </option>
                ))}
              </select>
              <input
                aria-label={`${choice?.label ?? 'Number'} value`}
                aria-invalid={problem ? true : undefined}
                data-value
                className={`${fieldClass} w-28 text-xs`}
                value={row.value}
                placeholder={choice?.unit ? `5 ${choice.unit}` : '5'}
                onChange={(event) => change(index, { value: event.target.value })}
              />
              <span className="text-xs text-ink-muted">{choice?.unit ?? ''}</span>
              <QuietButton
                label={`Remove ${choice?.label ?? 'number'}`}
                onClick={() => {
                  setRows((all) => all.filter((_, i) => i !== index));
                  setProblems([]);
                }}
              >
                Remove
              </QuietButton>
            </div>
            {problem ? <p className="text-xs text-danger">{problem.message}</p> : null}
          </div>
        );
      })}
      <p className="text-xs text-ink-muted">
        Type another unit if you like (5 mi, 1.5 h); it's converted. Empty a value to remove it.
      </p>
      <div className="flex flex-wrap gap-2">
        <QuietButton
          onClick={() => {
            setRows((all) => [...all, { key: nextMetricKey(all.map((r) => r.key)), value: '' }]);
            setFocusRow(rows.length);
          }}
        >
          Add a number
        </QuietButton>
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-1 text-xs text-white disabled:opacity-50"
          disabled={edit.isPending}
        >
          Save
        </button>
        <QuietButton onClick={props.onClose}>Cancel</QuietButton>
      </div>
      <ActionError errors={[edit.error]} />
    </form>
  );
}
