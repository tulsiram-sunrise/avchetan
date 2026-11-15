import { toAppError } from '@avchetan/shared';
import { useQuery } from '@tanstack/react-query';
import { HelpLink } from '../help-link';
import { useSeeThrough, useSetSeeThrough } from '../queries/settings';
import { SEE_THROUGH_OPTIONS } from '../services/see-through';
import { useServices } from '../services-context';

/** How see-through the capture box is over Windows' blur; this PC only. */
export function SeeThroughSetting() {
  const { platform } = useServices();
  const current = useSeeThrough();
  const change = useSetSeeThrough();
  const selected = change.isPending ? change.variables : current.data;
  const backdrop = useQuery({
    queryKey: ['dock-backdrop'],
    queryFn: () => platform.shell.dockBackdrop(),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 font-medium">See-through</legend>
      <p className="text-sm text-ink-muted">
        How much of the blurred window behind shows through the capture box. Open it with your
        shortcut to see the change.
      </p>
      {SEE_THROUGH_OPTIONS.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="see-through"
            value={option.value}
            checked={selected === option.value}
            disabled={!current.isSuccess}
            onChange={() => change.mutate(option.value)}
          />
          {option.label}
        </label>
      ))}
      {backdrop === 'none' ? (
        <p className="text-sm text-ink-muted">
          This version of Windows shows a plain box, so this setting changes nothing here.
        </p>
      ) : null}
      {change.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this setting. Try again. <HelpLink code={toAppError(change.error).code} />
        </p>
      ) : null}
    </fieldset>
  );
}
