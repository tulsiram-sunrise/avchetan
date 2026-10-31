import { useAction, useTags } from '../queries/organize';
import { ActionError, EditableText, MergeSelect, panelClass } from './ui';

function TagLine(props: {
  tag: { id: string; path: string; color: string | null; uses: number };
  others: { id: string; label: string }[];
}) {
  const { tag, others } = props;
  const move = useAction('tag.move');
  const merge = useAction('tag.merge');
  const recolor = useAction('tag.recolor');

  return (
    <li className="flex flex-col gap-1 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={`Color of ${tag.path}`}
          className="h-5 w-5 shrink-0"
          value={tag.color ?? '#888888'}
          onChange={(event) => recolor.mutate({ id: tag.id, color: event.target.value })}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <EditableText
            value={tag.path}
            label="tag path"
            onSave={(path) => move.mutate({ id: tag.id, path })}
          />
          <span className="text-xs text-ink-muted">{tag.uses}</span>
        </div>
        <MergeSelect options={others} onMerge={(intoId) => merge.mutate({ id: tag.id, intoId })} />
      </div>
      <ActionError errors={[move.error, merge.error, recolor.error]} />
    </li>
  );
}

export function TagsPage() {
  const tags = useTags();
  const all = tags.data ?? [];

  if (tags.isSuccess && all.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No tags yet. Type #something in an entry, or let the AI add them.
      </p>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Click a tag to rename it. Use a slash to nest it, like health/knee.
      </p>
      <ul className={panelClass}>
        {all.map((tag) => (
          <TagLine
            key={tag.id}
            tag={tag}
            others={all
              .filter((other) => other.id !== tag.id)
              .map((other) => ({ id: other.id, label: other.path }))}
          />
        ))}
      </ul>
    </div>
  );
}
