import type { Project } from '@avchetan/db/sqlite';
import { useState } from 'react';
import { useAction, useProjects } from '../queries/organize';
import { CollectionPage } from './collection-page';
import { ActionError, EditableText, fieldClass, panelClass, QuietButton } from './ui';

function ProjectLine(props: { project: Project; onOpen: () => void }) {
  const { project } = props;
  const archive = useAction('project.archive');
  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="text-left hover:text-accent hover:underline"
            onClick={props.onOpen}
          >
            {project.name}
          </button>
          {project.description ? (
            <p className="text-xs text-ink-muted">{project.description}</p>
          ) : null}
        </div>
        <QuietButton onClick={() => archive.mutate({ id: project.id })}>Archive</QuietButton>
      </div>
      <ActionError errors={[archive.error]} />
    </li>
  );
}

/** The Projects page: active projects, and one project's page when opened. */
export function ProjectsPage(props: {
  requestedProject?: string | null;
  onOpenTag: (path: string) => void;
  onOpenDay: (day: string) => void;
}) {
  const projects = useProjects();
  const create = useAction('project.create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [openId, setOpenId] = useState<string | null>(props.requestedProject ?? null);
  const all = projects.data ?? [];

  if (openId) {
    return (
      <ProjectPage
        id={openId}
        project={all.find((project) => project.id === openId)}
        loaded={projects.isSuccess}
        onBack={() => setOpenId(null)}
        onOpenTag={props.onOpenTag}
        onOpenDay={props.onOpenDay}
      />
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Entries are linked to a project only if it's listed here. The description helps the AI
        recognize it. Click a project to see its entries, totals and tasks, and to rename it.
      </p>
      {all.length > 0 ? (
        <ul className={panelClass}>
          {all.map((project) => (
            <ProjectLine key={project.id} project={project} onOpen={() => setOpenId(project.id)} />
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

function ProjectPage(props: {
  id: string;
  project: Project | undefined;
  loaded: boolean;
  onBack: () => void;
  onOpenTag: (path: string) => void;
  onOpenDay: (day: string) => void;
}) {
  const rename = useAction('project.rename');
  const { project } = props;
  if (props.loaded && !project) {
    // Archived or deleted on another device.
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-ink-muted">This project isn't active any more.</p>
        <QuietButton onClick={props.onBack}>Back to Projects</QuietButton>
      </div>
    );
  }
  if (!project) return null;
  return (
    <div className="flex flex-col gap-1">
      <CollectionPage
        of={{ projectId: project.id }}
        title={
          <EditableText
            value={project.name}
            label="project name"
            onSave={(name) => rename.mutate({ id: project.id, name })}
          />
        }
        color={project.color}
        back={{ label: 'Projects', onBack: props.onBack }}
        empty={`Nothing is linked to ${project.name} yet. Mention it in an entry ("worked on ${project.name} for an hour") and the AI links the entry here.`}
        onOpenTag={props.onOpenTag}
        onOpenDay={props.onOpenDay}
      />
      <ActionError errors={[rename.error]} />
    </div>
  );
}
