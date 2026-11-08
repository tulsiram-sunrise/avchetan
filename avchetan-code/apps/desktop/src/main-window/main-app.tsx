import { useState } from 'react';
import type { MainView } from '../native/events';
import { useAppEvent, useTableInvalidation } from '../use-app-event';
import { CategoriesPage } from './categories-page';
import { CheckPage } from './check-page';
import { DaysPage } from './days-page';
import { PeoplePage } from './people-page';
import { ProjectsPage } from './projects-page';
import { ReviewPage } from './review-page';
import { SettingsPage } from './settings-page';
import { SetupPage } from './setup-page';
import { TagsPage } from './tags-page';
import { TasksPage } from './tasks-page';

const VIEWS: { id: MainView; label: string }[] = [
  // The view id stays 'timeline': the tray and the Rust window code open it by that name.
  { id: 'timeline', label: 'Days' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'people', label: 'People' },
  { id: 'review', label: 'Review' },
  { id: 'categories', label: 'Categories' },
  { id: 'tags', label: 'Tags' },
  { id: 'projects', label: 'Projects' },
  { id: 'settings', label: 'Settings' },
];

function CurrentView(props: { view: MainView; day: string | null; onDone: () => void }) {
  const { view, onDone } = props;
  switch (view) {
    case 'timeline':
      return <DaysPage requestedDay={props.day} />;
    case 'tasks':
      return <TasksPage />;
    case 'people':
      return <PeoplePage />;
    case 'review':
      return <ReviewPage />;
    case 'categories':
      return <CategoriesPage />;
    case 'tags':
      return <TagsPage />;
    case 'projects':
      return <ProjectsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'setup':
      return <SetupPage onDone={onDone} />;
    case 'check':
      return <CheckPage />;
  }
}

/** The full window. Hidden (not closed) when the user closes it. */
export function MainApp(props: { initialView: MainView; initialDay?: string | null }) {
  const [view, setView] = useState<MainView>(props.initialView);
  const [day, setDay] = useState<string | null>(props.initialDay ?? null);
  useTableInvalidation();
  useAppEvent('main:navigate', (payload) => {
    setView(payload.view);
    if (payload.day) setDay(payload.day);
  });

  return (
    <div className="flex h-screen">
      <nav aria-label="Sections" className="flex w-48 flex-col gap-1 border-r border-line p-3">
        <p className="px-2 pb-3 font-semibold">Avchetan</p>
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={view === item.id ? 'page' : undefined}
            className={`rounded-lg px-2 py-1.5 text-left text-sm ${
              view === item.id ? 'bg-accent/15 font-medium text-accent' : 'hover:bg-surface-raised'
            }`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <CurrentView view={view} day={day} onDone={() => setView('timeline')} />
      </main>
    </div>
  );
}
