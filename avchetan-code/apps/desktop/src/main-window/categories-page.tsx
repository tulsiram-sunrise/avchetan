import type { Category } from '@avchetan/db/sqlite';
import { useState } from 'react';
import { useAction, useActiveCategories, useCategoryUsage } from '../queries/organize';
import { ActionError, EditableText, fieldClass, MergeSelect, panelClass, QuietButton } from './ui';

function CategoryLine(props: { category: Category; others: Category[]; uses: number }) {
  const { category, others, uses } = props;
  const rename = useAction('category.rename');
  const keep = useAction('category.keep');
  const merge = useAction('category.merge');
  const archive = useAction('category.archive');

  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <EditableText
            value={category.name}
            label="category name"
            onSave={(name) => rename.mutate({ id: category.id, name })}
          />
          <span className="text-xs text-ink-muted">{uses}</span>
          {category.needsReview ? (
            <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">
              New
            </span>
          ) : null}
        </div>
        {category.needsReview ? (
          <QuietButton onClick={() => keep.mutate({ id: category.id })}>Keep</QuietButton>
        ) : null}
        {category.origin === 'seed' ? null : (
          <>
            <MergeSelect
              options={others.map((other) => ({ id: other.id, label: other.name }))}
              onMerge={(intoId) => merge.mutate({ id: category.id, intoId })}
            />
            <QuietButton onClick={() => archive.mutate({ id: category.id })}>Archive</QuietButton>
          </>
        )}
      </div>
      {category.description ? (
        <p className="text-xs text-ink-muted">{category.description}</p>
      ) : null}
      <ActionError errors={[rename.error, keep.error, merge.error, archive.error]} />
    </li>
  );
}

export function CategoriesPage() {
  const categories = useActiveCategories();
  const usage = useCategoryUsage();
  const create = useAction('category.create');
  const [name, setName] = useState('');
  const all = categories.data ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-ink-muted">
        The AI sorts entries into these. It adds a new one, marked New, only when nothing fits.
      </p>
      <ul className={panelClass}>
        {all.map((category) => (
          <CategoryLine
            key={category.id}
            category={category}
            others={all.filter((other) => other.id !== category.id)}
            uses={usage.data?.get(category.id) ?? 0}
          />
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ name: name.trim(), description: null }, { onSuccess: () => setName('') });
        }}
      >
        <input
          aria-label="New category name"
          className={fieldClass}
          placeholder="New category"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={!name.trim() || create.isPending}
        >
          Add
        </button>
      </form>
      <ActionError errors={[create.error]} />
    </div>
  );
}
