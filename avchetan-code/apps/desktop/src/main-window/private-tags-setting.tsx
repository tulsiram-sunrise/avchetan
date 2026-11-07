import { useState } from 'react';
import { useAction, useTags } from '../queries/organize';
import { ActionError, fieldClass } from './ui';

/** Settings → AI → Private tags (docs/product/private-entries.md#private-tags). */
export function PrivateTagsSetting() {
  const tags = useTags().data ?? [];
  const add = useAction('tag.addPrivate');
  const setPrivate = useAction('tag.setPrivate');
  const [path, setPath] = useState('');
  const marked = tags.filter((tag) => tag.makesPrivate);
  const suggestions = tags.filter((tag) => !tag.makesPrivate).map((tag) => tag.path);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Private tags</h2>
      <p className="text-sm text-ink-muted">
        An entry with one of these tags, or a tag under it, is private: only an AI on your own PC or
        hub reads it, as with <code>!private</code>. Counts the tags you type and the ones a window
        rule adds.
      </p>
      {marked.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {marked.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center gap-1 rounded-full bg-line px-2 py-0.5 text-sm"
            >
              🔒 #{tag.path}
              <button
                type="button"
                aria-label={`Stop making #${tag.path} private`}
                title="Stop making this tag private"
                className="rounded px-1 text-ink-muted hover:text-ink"
                disabled={setPrivate.isPending}
                onClick={() => setPrivate.mutate({ id: tag.id, makesPrivate: false })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">None yet.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = path.trim().replace(/^#/, '');
          if (typed) add.mutate({ path: typed }, { onSuccess: () => setPath('') });
        }}
      >
        <input
          aria-label="Tag to make private"
          className={`${fieldClass} w-56`}
          list="private-tag-suggestions"
          placeholder="health"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <datalist id="private-tag-suggestions">
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <button
          type="submit"
          className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface disabled:opacity-50"
          disabled={add.isPending || !path.trim()}
        >
          Add
        </button>
      </form>
      <ActionError errors={[add.error, setPrivate.error]} />
    </section>
  );
}
