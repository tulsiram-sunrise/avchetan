import { useState } from 'react';
import type { MainView } from '../native/events';
import { useAppEvent, useTableInvalidation } from '../use-app-event';
import { SettingsPage } from './settings-page';
import { Timeline } from './timeline';

const VIEWS: { id: MainView; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'settings', label: 'Settings' },
];

/** The full window. Hidden (not closed) when the user closes it. */
export function MainApp(props: { initialView: MainView }) {
  const [view, setView] = useState<MainView>(props.initialView);
  useTableInvalidation();
  useAppEvent('main:navigate', (payload) => setView(payload.view));

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
        {view === 'timeline' ? <Timeline /> : <SettingsPage />}
      </main>
    </div>
  );
}
