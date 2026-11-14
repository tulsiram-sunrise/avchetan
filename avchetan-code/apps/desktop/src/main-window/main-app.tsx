import { type FilterChoice, NO_FILTERS } from '@avchetan/core';
import { useEffect, useState } from 'react';
import { LockScreen } from '../lock-screen';
import type { MainView } from '../native/events';
import { takePendingSearch } from '../services/search-handoff';
import { useAppEvent, useTableInvalidation } from '../use-app-event';
import { isHidden, useLockStatus } from '../use-lock';
import { CategoriesPage } from './categories-page';
import { CheckPage } from './check-page';
import { DaysPage } from './days-page';
import { isTyping } from './keys';
import { KeysSheet } from './keys-sheet';
import { PeoplePage } from './people-page';
import { ProjectsPage } from './projects-page';
import { ReviewPage } from './review-page';
import { SearchPage } from './search-page';
import { SettingsPage } from './settings-page';
import { SetupPage } from './setup-page';
import { TagsPage } from './tags-page';
import { TasksPage } from './tasks-page';
import { TrendsPage } from './trends-page';

const VIEWS: { id: MainView; label: string; hint?: string }[] = [
  // The view id stays 'timeline': the tray and the Rust window code open it by that name.
  { id: 'timeline', label: 'Days' },
  { id: 'search', label: 'Search', hint: 'Ctrl+F' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'people', label: 'People' },
  { id: 'review', label: 'Review' },
  { id: 'trends', label: 'Trends' },
  { id: 'categories', label: 'Categories' },
  { id: 'tags', label: 'Tags' },
  { id: 'projects', label: 'Projects' },
  { id: 'settings', label: 'Settings' },
];

/** Where a page was asked to open: a day with one entry in view, a person, a tag or a project. */
type Target = {
  day: string | null;
  entryId: string | null;
  personId: string | null;
  tagPath: string | null;
  projectId: string | null;
};

const NO_TARGET: Target = {
  day: null,
  entryId: null,
  personId: null,
  tagPath: null,
  projectId: null,
};

/** The full window. Hidden (not closed) when the user closes it. */
export function MainApp(props: { initialView: MainView; initialDay?: string | null }) {
  const [view, setView] = useState<MainView>(props.initialView);
  const [target, setTarget] = useState<Target>({ ...NO_TARGET, day: props.initialDay ?? null });
  // `/find words` in the capture box opened this window on Search (services/search-handoff.ts).
  const [searchText, setSearchText] = useState(() => takePendingSearch() ?? '');
  const [searchChoice, setSearchChoice] = useState<FilterChoice>(NO_FILTERS);
  const [searchFocus, setSearchFocus] = useState(0);
  const [keysOpen, setKeysOpen] = useState(false);
  useTableInvalidation();
  useAppEvent('main:navigate', (payload) => {
    setView(payload.view);
    if (payload.day) setTarget({ ...NO_TARGET, day: payload.day });
    if (payload.view === 'search' && payload.text) {
      takePendingSearch();
      setSearchText(payload.text);
      setSearchFocus((n) => n + 1);
    }
  });
  const lock = useLockStatus();
  const hidden = isHidden(lock);

  useEffect(() => {
    if (hidden) return;
    const onKey = (event: KeyboardEvent) => {
      // Ctrl+F works even from a field: it's the browser's own find key.
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setKeysOpen(false);
        setView('search');
        setSearchFocus((n) => n + 1);
        return;
      }
      if (event.key === '?' && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
        event.preventDefault();
        setKeysOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden]);

  // Locked: no page is rendered at all, so nothing written before sits behind the lock screen.
  if (hidden) return <LockScreen ready={lock.configured} />;

  const openTag = (tagPath: string) => {
    setTarget((t) => ({ ...t, tagPath }));
    setView('tags');
  };
  const openDay = (day: string) => {
    setTarget((t) => ({ ...t, day, entryId: null }));
    setView('timeline');
  };

  const page = (() => {
    switch (view) {
      case 'timeline':
        return (
          <DaysPage requestedDay={target.day} requestedEntry={target.entryId} onOpenTag={openTag} />
        );
      case 'search':
        return (
          <SearchPage
            text={searchText}
            onText={setSearchText}
            choice={searchChoice}
            onChoice={setSearchChoice}
            focusSignal={searchFocus}
            onOpenEntry={(day, entryId) => {
              setTarget({ ...NO_TARGET, day, entryId });
              setView('timeline');
            }}
            onOpenTasks={() => setView('tasks')}
            onOpenPerson={(personId) => {
              setTarget((t) => ({ ...t, personId }));
              setView('people');
            }}
          />
        );
      case 'tasks':
        return <TasksPage />;
      case 'people':
        return <PeoplePage requestedPerson={target.personId} />;
      case 'review':
        return <ReviewPage />;
      case 'trends':
        return (
          <TrendsPage
            onOpenEntry={(day, entryId) => {
              setTarget({ ...NO_TARGET, day, entryId });
              setView('timeline');
            }}
          />
        );
      case 'categories':
        return <CategoriesPage />;
      case 'tags':
        return <TagsPage requestedTag={target.tagPath} onOpenDay={openDay} />;
      case 'projects':
        return (
          <ProjectsPage
            requestedProject={target.projectId}
            onOpenTag={openTag}
            onOpenDay={openDay}
          />
        );
      case 'settings':
        return <SettingsPage />;
      case 'setup':
        return <SetupPage onDone={() => setView('timeline')} />;
      case 'check':
        return <CheckPage />;
    }
  })();

  return (
    <div className="flex h-screen">
      <nav aria-label="Sections" className="flex w-48 flex-col gap-1 border-r border-line p-3">
        <p className="px-2 pb-3 font-semibold">Avchetan</p>
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={view === item.id ? 'page' : undefined}
            aria-keyshortcuts={item.hint}
            className={`flex items-baseline rounded-lg px-2 py-1.5 text-left text-sm ${
              view === item.id ? 'bg-accent/15 font-medium text-accent' : 'hover:bg-surface-raised'
            }`}
            onClick={() => {
              // Clicking a section opens its own start, not a person or entry from search.
              setTarget((t) => ({
                ...t,
                entryId: null,
                personId: null,
                tagPath: null,
                projectId: null,
              }));
              setView(item.id);
            }}
          >
            <span className="flex-1">{item.label}</span>
            {item.hint ? <span className="text-xs text-ink-muted">{item.hint}</span> : null}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          aria-keyshortcuts="?"
          className="rounded-lg px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-surface-raised"
          onClick={() => setKeysOpen(true)}
        >
          Keys <kbd className="font-mono">?</kbd>
        </button>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">{page}</main>
      {keysOpen ? <KeysSheet onClose={() => setKeysOpen(false)} /> : null}
    </div>
  );
}
