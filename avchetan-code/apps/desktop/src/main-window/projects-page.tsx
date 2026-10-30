import type { Project } from '@avchetan/db/sqlite';
import { useState } from 'react';
import { useAction, useProjects } from '../queries/organize';
import { ActionError, EditableText, fieldClass, panelClass, QuietButton } from './ui';

function ProjectLine({ project }: { project: Project }) {
  const rename = useAction('project.rename');
  const archive = useAction('project.archive');
  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <EditableText
            value={project.name}
            label="project name"
            onSave={(name) => rename.mutate({ id: project.id, name })}
          />
        </div>
        <QuietButton onClick={() => archive.mutate({ id: project.id })}>Archive</QuietButton>
      </div>
      <ActionError errors={[rename.error, archive.error]} />
    </li>
  );
}

export function ProjectsPage() {
  const projects = useProjects();
  const create = useAction('project.create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const all = projects.data ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Entries are linked to a project only if it's listed here. The description helps the AI
        recognize it.
      </p>
      {all.length > 0 ? (
        <ul className={panelClass}>
          {all.map((project) => (
            <ProjectLine key={project.id} project={project} />
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { name: name.trim(), description: description.trim() || null },
            {
              onSuccess: () => {
                setName('');
                setDescription('');
              },
            },
          );
        }}
      >
        <input
          aria-label="New project name"
          className={fieldClass}
          placeholder="New project"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          aria-label="Project description"
          className={`${fieldClass} min-w-64 flex-1`}
          placeholder="What it's about (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
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
