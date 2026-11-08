import {
  DEFAULT_DENY_LIST,
  type EntryWindowContext,
  isDenied,
  loadContextSettings,
  matchRules,
  parseTitlePattern,
  saveContextSettings,
} from '@avchetan/core';
import type { ContextRule } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { GUIDE_URL, openExternal } from '../help';
import { emitAppEvent } from '../native/events';
import { useAction, useProjects } from '../queries/organize';
import { useServices } from '../services-context';
import { ActionError, fieldClass, panelClass, QuietButton } from './ui';

const log = createLogger('settings');

const settingsKey = ['settings', 'context'] as const;
const rulesKey = ['context_rules'] as const;

function announceSettings() {
  // The dock re-reads them for the next capture and updates the tray.
  emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
    log.warn('could not announce a context settings change'),
  );
}

/** Settings → Capture box → Window context (docs/product/window-context.md). */
export function WindowContextSetting() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => loadContextSettings(store) });
  const change = useMutation({
    mutationFn: (changes: Parameters<typeof saveContextSettings>[1]) =>
      saveContextSettings(store, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKey });
      announceSettings();
    },
  });
  const current = settings.data;
  const busy = !current || change.isPending;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Window context</h2>
      <p className="text-sm text-ink-muted">
        When the shortcut opens the capture box, Avchetan notes the app and window title you were
        in. Rules below turn that into a project and tags.{' '}
        <button
          type="button"
          className="underline"
          onClick={() =>
            void openExternal(`${GUIDE_URL}/capture-on-windows#window-context-and-rules`).catch(
              () => log.warn('could not open a link'),
            )
          }
        >
          How it works
        </button>
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={current?.enabled ?? true}
          disabled={busy}
          onChange={(event) => change.mutate({ enabled: event.target.checked })}
        />
        Note the window I was in
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={current?.browserTitles ?? false}
          disabled={busy || !current?.enabled}
          onChange={(event) => change.mutate({ browserTitles: event.target.checked })}
        />
        Keep page titles in browsers (otherwise only the browser's name)
      </label>
      {current ? (
        <DenyList
          denyList={current.denyList}
          disabled={busy}
          onChange={(denyList) => change.mutate({ denyList })}
        />
      ) : null}
      <ActionError errors={[change.error]} />
      <RulesList />
    </section>
  );
}

function DenyList(props: {
  denyList: string[];
  disabled: boolean;
  onChange: (denyList: string[]) => void;
}) {
  const { platform } = useServices();
  const [typed, setTyped] = useState('');
  const recent = useQuery({
    queryKey: ['context', 'recent-apps'],
    queryFn: () => platform.shell.recentApps(),
  });
  const add = (app: string) => {
    const name = app.trim();
    if (!name || isDenied(name, props.denyList)) return;
    props.onChange([...props.denyList, name]);
    setTyped('');
  };
  const addable = (recent.data ?? []).filter(({ app }) => !isDenied(app, props.denyList));
  const removedDefaults = DEFAULT_DENY_LIST.filter((app) => !isDenied(app, props.denyList));

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Never note these apps</h3>
      <ul className={panelClass}>
        {props.denyList.length === 0 ? (
          <li className="px-3 py-2 text-sm text-ink-muted">No apps</li>
        ) : (
          props.denyList.map((app) => (
            <li key={app} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">{app}</span>
              <QuietButton
                disabled={props.disabled}
                onClick={() => props.onChange(props.denyList.filter((other) => other !== app))}
              >
                Remove
              </QuietButton>
            </li>
          ))
        )}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add(typed);
        }}
      >
        <input
          aria-label="App to add, by file name"
          placeholder="App file name, e.g. Signal.exe"
          className={`${fieldClass} flex-1`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <QuietButton disabled={props.disabled || !typed.trim()} onClick={() => add(typed)}>
          Add
        </QuietButton>
      </form>
      {addable.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          Recent apps:
          {addable.map(({ app, app_name }) => (
            <QuietButton key={app} disabled={props.disabled} onClick={() => add(app)}>
              + {app_name}
            </QuietButton>
          ))}
        </p>
      ) : null}
      {removedDefaults.length > 0 ? (
        <p className="text-sm text-ink-muted">
          <QuietButton
            disabled={props.disabled}
            onClick={() => props.onChange([...props.denyList, ...removedDefaults])}
          >
            Add the password managers back
          </QuietButton>
        </p>
      ) : null}
    </div>
  );
}

function ruleSummary(rule: ContextRule, projectName: string | undefined): string {
  const title = rule.titlePattern
    ? ` · title ${parseTitlePattern(rule.titlePattern).kind === 'regex' ? 'matches' : 'contains'} ${rule.titlePattern}`
    : '';
  const adds = [projectName, ...rule.tagPaths.map((path) => `#${path}`)].filter(Boolean);
  return `${rule.appPattern}${title} → ${adds.length > 0 ? adds.join(' · ') : 'nothing'}`;
}

function RulesList() {
  const { store } = useServices();
  const rules = useQuery({
    queryKey: rulesKey,
    queryFn: () => store.repos.contextRules.list(store.db),
  });
  const projects = useProjects().data ?? [];
  const setEnabled = useAction('contextRule.setEnabled');
  const remove = useAction('contextRule.delete');
  const [editing, setEditing] = useState<ContextRule | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Rules</h3>
      <ul className={panelClass}>
        {(rules.data ?? []).length === 0 ? (
          <li className="px-3 py-2 text-sm text-ink-muted">
            {rules.isSuccess ? 'No rules yet. Make one here, or from an entry.' : ''}
          </li>
        ) : (
          (rules.data ?? []).map((rule) =>
            editing !== 'new' && editing?.id === rule.id ? (
              <li key={rule.id} className="px-3 py-2">
                <RuleForm rule={rule} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={rule.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  aria-label="Rule on"
                  checked={rule.enabled}
                  disabled={setEnabled.isPending}
                  onChange={(event) =>
                    setEnabled.mutate({ id: rule.id, enabled: event.target.checked })
                  }
                />
                <span
                  className={`min-w-0 flex-1 break-words ${rule.enabled ? '' : 'text-ink-muted'}`}
                >
                  {ruleSummary(rule, projects.find(({ id }) => id === rule.projectId)?.name)}
                </span>
                <QuietButton onClick={() => setEditing(rule)}>Edit</QuietButton>
                <QuietButton
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: rule.id })}
                >
                  Delete
                </QuietButton>
              </li>
            ),
          )
        )}
      </ul>
      {editing === 'new' ? (
        <RuleForm onDone={() => setEditing(null)} />
      ) : (
        <div>
          <QuietButton onClick={() => setEditing('new')}>Add a rule</QuietButton>
        </div>
      )}
      <ActionError errors={[setEnabled.error, remove.error]} />
    </div>
  );
}

const escapeForPattern = (text: string) => text.replace(/[\\^$.|?*+()[\]{}/]/g, '\\$&');

/**
 * Add or edit a rule. `sample` is an entry's window (Make a rule from this): the form starts
 * from it and says whether the rule matches it.
 */
export function RuleForm(props: {
  rule?: ContextRule;
  sample?: EntryWindowContext;
  onDone: () => void;
}) {
  const { rule, sample } = props;
  const create = useAction('contextRule.create');
  const update = useAction('contextRule.update');
  const initialTitle = rule?.titlePattern ?? '';
  const [app, setApp] = useState(rule?.appPattern ?? sample?.app ?? '');
  const [isPattern, setIsPattern] = useState(parseTitlePattern(initialTitle).kind === 'regex');
  const [title, setTitle] = useState(
    isPattern ? initialTitle.slice(1, -1) : initialTitle || (sample?.window_title ?? ''),
  );
  const [projectId, setProjectId] = useState(rule?.projectId ?? '');
  const [tags, setTags] = useState((rule?.tagPaths ?? []).join(', '));

  const titlePattern = title.trim() ? (isPattern ? `/${title.trim()}/` : title.trim()) : null;
  const parsed = parseTitlePattern(titlePattern);
  const fields = {
    appPattern: app,
    titlePattern,
    projectId: projectId || null,
    tagPaths: tags
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean),
    enabled: rule?.enabled ?? true,
  };
  const matchesSample =
    sample && app.trim() ? matchRules(sample, [{ id: 'sample', ...fields }]).length > 0 : null;
  const saving = create.isPending || update.isPending;
  const save = async () => {
    if (rule) await update.mutateAsync({ id: rule.id, ...fields });
    else await create.mutateAsync(fields);
    props.onDone();
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void save().catch(() => log.warn('could not save a rule'));
      }}
    >
      <label className="flex flex-col gap-1">
        App (file name, * for any characters)
        <input className={fieldClass} value={app} onChange={(e) => setApp(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        Title contains (optional)
        <input
          className={fieldClass}
          value={title}
          placeholder={isPattern ? '— (?<project>[^—]+) — Visual Studio Code' : 'my-project'}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isPattern}
          onChange={(e) => {
            const on = e.target.checked;
            // Turning a pattern on keeps the same meaning: the text, matched literally.
            if (on && !isPattern) setTitle(escapeForPattern(title.trim()));
            setIsPattern(on);
          }}
        />
        Pattern (regular expression; name a part <code>(?&lt;project&gt;…)</code> to use it as{' '}
        <code>{'{project}'}</code> in tags)
      </label>
      {parsed.kind === 'invalid' ? (
        <p role="alert" className="text-danger">
          This pattern doesn't work: {parsed.message}
        </p>
      ) : null}
      <ProjectPicker value={projectId} onChange={setProjectId} />
      <label className="flex flex-col gap-1">
        Tags, separated by commas
        <input
          className={fieldClass}
          value={tags}
          placeholder="code, {project}"
          onChange={(e) => setTags(e.target.value)}
        />
      </label>
      {matchesSample !== null ? (
        <p className={matchesSample ? 'text-ok' : 'text-warn'}>
          {matchesSample ? 'Matches this entry’s window.' : 'Doesn’t match this entry’s window.'}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-1 text-white disabled:opacity-50"
          disabled={saving || !app.trim() || parsed.kind === 'invalid'}
        >
          {rule ? 'Save rule' : 'Add rule'}
        </button>
        <QuietButton onClick={props.onDone}>Cancel</QuietButton>
      </div>
      <ActionError errors={[create.error, update.error]} />
    </form>
  );
}

const NEW_PROJECT = '__new__';

/** The rule's project, with New project… so a rule doesn't wait for the Projects page (audit bug 9). */
function ProjectPicker(props: { value: string; onChange: (id: string) => void }) {
  const projects = useProjects().data ?? [];
  const create = useAction('project.create');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const { onChange } = props;

  // The dock writes the project; pick it once it shows up in the list.
  useEffect(() => {
    if (!waitingFor) return;
    const made = projects.find((project) => project.name.toLowerCase() === waitingFor);
    if (made) {
      onChange(made.id);
      setWaitingFor(null);
      setAdding(false);
      setName('');
    }
  }, [projects, waitingFor, onChange]);

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, description: null },
      { onSuccess: () => setWaitingFor(trimmed.toLowerCase()) },
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        Project
        <select
          className={fieldClass}
          value={adding ? NEW_PROJECT : props.value}
          onChange={(e) => {
            if (e.target.value === NEW_PROJECT) setAdding(true);
            else {
              setAdding(false);
              props.onChange(e.target.value);
            }
          }}
        >
          <option value="">None</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
          <option value={NEW_PROJECT}>New project…</option>
        </select>
      </label>
      {adding ? (
        <div className="flex items-center gap-2">
          <input
            className={`${fieldClass} flex-1`}
            aria-label="New project name"
            placeholder="Name, like Engineering"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <QuietButton disabled={!name.trim() || create.isPending} onClick={add}>
            Add project
          </QuietButton>
        </div>
      ) : null}
      <ActionError errors={[create.error]} />
    </div>
  );
}
