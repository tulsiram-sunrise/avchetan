import {
  describeRoutine,
  draftFromRule,
  newRuleDraft,
  ROUTINE_STARTERS,
  type RuleDraft,
  ruleFromDraft,
} from '@avchetan/core';
import { type Routine, routineRule, starterRoutineId } from '@avchetan/db/sqlite';
import { describeRepeatRule, isValidLocalTime } from '@avchetan/shared';
import { useState } from 'react';
import { useDayCoverageOn, useSetDayCoverageOn, useToday } from '../queries/days';
import { useAction } from '../queries/organize';
import { useRoutines } from '../queries/routines';
import { useServices } from '../services-context';
import { RuleEditor } from './rule-editor';
import { ActionError, fieldClass, panelClass, QuietButton } from './ui';
import { useUndo } from './undo-bar';

type Kind = 'assumed' | 'confirm';

const KIND_LABEL: Record<Kind, string> = {
  confirm: 'Tick off',
  assumed: 'Assumed',
};

type FormState = {
  title: string;
  kind: Kind;
  rule: RuleDraft;
  timed: boolean;
  windowStart: string;
  windowEnd: string;
};

function formFor(routine: Routine | null, today: string): FormState {
  const rule = routine ? routineRule(routine) : null;
  return {
    title: routine?.title ?? '',
    kind: routine?.kind === 'assumed' ? 'assumed' : 'confirm',
    rule: rule ? draftFromRule(rule) : newRuleDraft(today),
    timed: Boolean(routine?.windowStart),
    windowStart: routine?.windowStart ?? '08:00',
    windowEnd: routine?.windowEnd ?? '09:00',
  };
}

function RoutineForm(props: { routine: Routine | null; onDone: () => void }) {
  const today = useToday();
  const create = useAction('routine.create');
  const update = useAction('routine.update');
  const [form, setForm] = useState(() => formFor(props.routine, today));
  const set = (change: Partial<FormState>) => setForm((f) => ({ ...f, ...change }));
  const rule = ruleFromDraft(form.rule);
  const badTime =
    form.timed && (!isValidLocalTime(form.windowStart) || !isValidLocalTime(form.windowEnd));
  const problem = !form.title.trim()
    ? 'Give it a name.'
    : !rule.ok
      ? rule.problem
      : badTime
        ? 'Set both times.'
        : null;
  const saving = create.isPending || update.isPending;

  const save = () => {
    if (problem || !rule.ok) return;
    const fields = {
      title: form.title,
      kind: form.kind,
      repeatRule: rule.rule,
      windowStart: form.timed ? form.windowStart : null,
      windowEnd: form.timed ? form.windowEnd : null,
      today,
    };
    if (props.routine) {
      update.mutate({ id: props.routine.id, ...fields }, { onSuccess: props.onDone });
    } else {
      create.mutate(fields, { onSuccess: props.onDone });
    }
  };

  return (
    <form
      className="flex flex-col gap-3 p-4"
      aria-label={props.routine ? `Edit ${props.routine.title}` : 'New routine'}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          className={fieldClass}
          value={form.title}
          placeholder="Water plants"
          // biome-ignore lint/a11y/noAutofocus: the form opens because the person asked for it.
          autoFocus
          onChange={(event) => set({ title: event.target.value })}
        />
      </label>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="pb-1 font-medium">Kind</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="routine-kind"
            checked={form.kind === 'confirm'}
            onChange={() => set({ kind: 'confirm' })}
          />
          Tick it off: a chore you do, such as watering the plants
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="routine-kind"
            checked={form.kind === 'assumed'}
            onChange={() => set({ kind: 'assumed' })}
          />
          Assumed: it happens unless an entry says otherwise, such as sleep or work hours
        </label>
      </fieldset>
      <RuleEditor draft={form.rule} onChange={(draft) => set({ rule: draft })} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.timed}
            onChange={(event) => set({ timed: event.target.checked })}
          />
          At a time
        </label>
        {form.timed ? (
          <>
            <input
              type="time"
              aria-label="From"
              className={fieldClass}
              value={form.windowStart}
              onChange={(event) => set({ windowStart: event.target.value })}
            />
            <span>to</span>
            <input
              type="time"
              aria-label="To"
              className={fieldClass}
              value={form.windowEnd}
              onChange={(event) => set({ windowEnd: event.target.value })}
            />
            <span className="text-xs text-ink-muted">(may end the next morning)</span>
          </>
        ) : null}
      </div>
      <p role="status" className="text-sm text-ink-muted">
        {problem ?? (rule.ok ? describeRepeatRule(rule.rule) : null)}
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={problem !== null || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <QuietButton onClick={props.onDone}>Cancel</QuietButton>
      </div>
      <ActionError errors={[create.error, update.error]} />
    </form>
  );
}

function RoutineLine(props: { routine: Routine; onEdit: () => void }) {
  const { routine } = props;
  const today = useToday();
  const { actions } = useServices();
  const undo = useUndo();
  const pause = useAction('routine.pause');
  const resume = useAction('routine.resume');
  const paused = routine.pausedAt !== null;
  const readable = routineRule(routine) !== null;

  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={paused ? 'text-ink-muted' : ''}>
            {routine.title}
            <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink-muted">
              {KIND_LABEL[routine.kind as Kind] ?? routine.kind}
            </span>
            {paused ? (
              <span className="ml-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">
                Paused
              </span>
            ) : null}
          </span>
          <span className="text-xs text-ink-muted">{describeRoutine(routine)}</span>
        </div>
        {readable ? (
          <QuietButton label={`Edit ${routine.title}`} onClick={props.onEdit}>
            Edit
          </QuietButton>
        ) : null}
        {paused ? (
          <QuietButton
            label={`Resume ${routine.title}`}
            onClick={() => resume.mutate({ id: routine.id, today })}
          >
            Resume
          </QuietButton>
        ) : (
          <QuietButton
            label={`Pause ${routine.title}`}
            onClick={() => pause.mutate({ id: routine.id })}
          >
            Pause
          </QuietButton>
        )}
        <QuietButton
          label={`Delete ${routine.title}`}
          onClick={() =>
            undo.later({
              key: routine.id,
              message: 'Routine deleted.',
              commit: () => actions.run('routine.delete', { id: routine.id }),
            })
          }
        >
          Delete
        </QuietButton>
      </div>
      <ActionError errors={[pause.error, resume.error]} />
    </li>
  );
}

/** Pick starters to add; nothing is added until ticked (product/tasks-routines-reminders.md §3). */
function StarterPicker(props: { added: ReadonlySet<string>; onDone: () => void }) {
  const today = useToday();
  const add = useAction('routine.addStarters');
  const [picked, setPicked] = useState<string[]>([]);
  const offered = ROUTINE_STARTERS.filter(
    (starter) => !props.added.has(starterRoutineId(starter.key)),
  );
  const groups: { kind: Kind; title: string }[] = [
    { kind: 'confirm', title: 'To tick off' },
    { kind: 'assumed', title: 'Assumed' },
  ];

  return (
    <section className={`${panelClass} gap-3 p-4`} aria-label="Ideas to start with">
      <p className="text-sm text-ink-muted">
        Tick any to add. Each starts today; edit the name, days or times after.
      </p>
      {groups.map((group) => {
        const starters = offered.filter((starter) => starter.kind === group.kind);
        if (starters.length === 0) return null;
        return (
          <fieldset key={group.kind} className="flex flex-col gap-1 border-0 text-sm">
            <legend className="pb-1 font-medium">{group.title}</legend>
            {starters.map((starter) => (
              <label key={starter.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.includes(starter.key)}
                  onChange={(event) =>
                    setPicked((keys) =>
                      event.target.checked
                        ? [...keys, starter.key]
                        : keys.filter((key) => key !== starter.key),
                    )
                  }
                />
                {starter.title}
                {starter.windowStart ? (
                  <span className="text-xs text-ink-muted">
                    {starter.windowStart}–{starter.windowEnd}
                    {starter.weekdays ? ', Mon–Fri' : ''}
                  </span>
                ) : null}
              </label>
            ))}
          </fieldset>
        );
      })}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={picked.length === 0 || add.isPending}
          onClick={() =>
            add.mutate(
              { keys: picked, today },
              {
                onSuccess: () => {
                  setPicked([]);
                  props.onDone();
                },
              },
            )
          }
        >
          {picked.length > 1 ? `Add ${picked.length}` : 'Add'}
        </button>
        <QuietButton onClick={props.onDone}>Close</QuietButton>
      </div>
      <ActionError errors={[add.error]} />
    </section>
  );
}

/** Regular schedule and chores, with add, edit, pause and delete. */
export function RoutinesPage() {
  const routines = useRoutines();
  const undo = useUndo();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [ideasOpen, setIdeasOpen] = useState<boolean | null>(null);
  const all = (routines.data ?? []).filter((routine) => !undo.isHidden(routine.id));
  const ids = new Set((routines.data ?? []).map((routine) => routine.id));
  const startersLeft = ROUTINE_STARTERS.some((starter) => !ids.has(starterRoutineId(starter.key)));
  // Offered on first open: while there are no routines, until closed.
  const showIdeas = startersLeft && (ideasOpen ?? (routines.isSuccess && all.length === 0));

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Chores you tick off, and things that simply happen, such as sleep or work hours. Each day’s
        appear on that day.
      </p>
      {showIdeas ? <StarterPicker added={ids} onDone={() => setIdeasOpen(false)} /> : null}
      {editing === 'new' ? (
        <div className={panelClass}>
          <RoutineForm routine={null} onDone={() => setEditing(null)} />
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-1 text-sm text-white"
            onClick={() => setEditing('new')}
          >
            New routine
          </button>
          {startersLeft && !showIdeas ? (
            <QuietButton onClick={() => setIdeasOpen(true)}>Ideas</QuietButton>
          ) : null}
        </div>
      )}
      {all.length > 0 ? (
        <ul className={panelClass}>
          {all.map((routine) =>
            editing === routine.id ? (
              <li key={routine.id}>
                <RoutineForm routine={routine} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <RoutineLine
                key={routine.id}
                routine={routine}
                onEdit={() => setEditing(routine.id)}
              />
            ),
          )}
        </ul>
      ) : routines.isSuccess && !showIdeas ? (
        <p className="text-sm text-ink-muted">No routines yet.</p>
      ) : null}
      <ActionError errors={[routines.error]} />
      <DayCoverageSetting />
    </div>
  );
}

/** Off by default (tasks-routines-reminders.md §11); kept per device. */
function DayCoverageSetting() {
  const on = useDayCoverageOn();
  const set = useSetDayCoverageOn();
  return (
    <section aria-label="Day coverage" className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on.data ?? false}
          disabled={!on.isSuccess || set.isPending}
          onChange={(event) => set.mutate(event.target.checked)}
        />
        Show day coverage in Days
      </label>
      <p className="text-sm text-ink-muted">
        How much of each day is accounted for: what you logged with a duration, plus routines such
        as sleep and work hours, plus 15% for small things nobody logs. The rest shows as
        unaccounted, which may well have been rest.
      </p>
      <ActionError errors={[set.error]} />
    </section>
  );
}
