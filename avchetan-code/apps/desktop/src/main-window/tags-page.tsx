import { slugifyPath } from '@avchetan/shared';
import { useState } from 'react';
import { useAction, useTags } from '../queries/organize';
import { CollectionPage } from './collection-page';
import { ActionError, EditableText, MergeSelect, panelClass, QuietButton } from './ui';

type TagRow = { id: string; path: string; color: string | null; uses: number };

function TagLine(props: {
  tag: TagRow;
  others: { id: string; label: string }[];
  onOpen: () => void;
}) {
  const { tag, others } = props;
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
          <button
            type="button"
            className="min-w-0 truncate text-left hover:text-accent hover:underline"
            onClick={props.onOpen}
          >
            {tag.path}
          </button>
          <span className="text-xs text-ink-muted">{tag.uses}</span>
        </div>
        <MergeSelect options={others} onMerge={(intoId) => merge.mutate({ id: tag.id, intoId })} />
      </div>
      <ActionError errors={[merge.error, recolor.error]} />
    </li>
  );
}

/** The Tags page: every tag, and one tag's page when opened. */
export function TagsPage(props: {
  /** A tag path to open (from a chip on Days). */
  requestedTag?: string | null;
  onOpenDay: (day: string) => void;
}) {
  const tags = useTags();
  const all = tags.data ?? [];
  // A path, not an ID: chips know paths. Renaming on the page follows the new path.
  const [openPath, setOpenPath] = useState<string | null>(props.requestedTag ?? null);

  if (openPath) {
    return (
      <TagPage
        path={openPath}
        tag={all.find((tag) => tag.path === openPath)}
        loaded={tags.isSuccess}
        onBack={() => setOpenPath(null)}
        onOpenTag={setOpenPath}
        onOpenDay={props.onOpenDay}
      />
    );
  }

  if (tags.isSuccess && all.length === 0) {
    return (
      <p className="max-w-xl text-sm text-ink-muted">
        No tags yet. Type #something in an entry, like "ran 5 km #running", or let the AI add them.
      </p>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Click a tag to see its entries, totals and tasks, and to rename it. Use a slash to nest
        tags, like health/knee.
      </p>
      <ul className={panelClass}>
        {all.map((tag) => (
          <TagLine
            key={tag.id}
            tag={tag}
            onOpen={() => setOpenPath(tag.path)}
            others={all
              .filter((other) => other.id !== tag.id)
              .map((other) => ({ id: other.id, label: other.path }))}
          />
        ))}
      </ul>
    </div>
  );
}

function TagPage(props: {
  path: string;
  tag: TagRow | undefined;
  loaded: boolean;
  onBack: () => void;
  onOpenTag: (path: string) => void;
  onOpenDay: (day: string) => void;
}) {
  const move = useAction('tag.move');
  const { tag } = props;
  if (props.loaded && !tag) {
    // Renamed, merged or deleted on another device.
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-ink-muted">#{props.path} isn't a tag any more.</p>
        <QuietButton onClick={props.onBack}>Back to Tags</QuietButton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <CollectionPage
        of={{ tagPath: props.path }}
        title={
          tag ? (
            <span className="flex items-baseline">
              #
              <EditableText
                value={tag.path}
                label="tag path"
                onSave={(path) =>
                  move.mutate(
                    { id: tag.id, path },
                    // The repository stores the path in this form; follow it.
                    { onSuccess: () => props.onOpenTag(slugifyPath(path)) },
                  )
                }
              />
            </span>
          ) : (
            `#${props.path}`
          )
        }
        color={tag?.color ?? null}
        back={{ label: 'Tags', onBack: props.onBack }}
        empty={`Nothing carries #${props.path} yet. Add it to an entry ("ran 5 km #${props.path}") and the entry, its numbers and tasks show here.`}
        onOpenTag={props.onOpenTag}
        onOpenDay={props.onOpenDay}
      />
      <ActionError errors={[move.error]} />
    </div>
  );
}
