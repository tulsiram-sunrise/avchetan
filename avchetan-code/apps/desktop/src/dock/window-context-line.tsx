import { ruleOutcome } from '@avchetan/core';
import { useProjects } from '../queries/organize';
import { useDockStore } from '../stores/dock-store';

/**
 * Under the capture box: the window the next entry is saved with, and what rules add.
 * × drops it from this entry (window-context.md#what-it-looks-like).
 */
export function WindowContextLine() {
  const window = useDockStore((state) => state.window);
  const setWindow = useDockStore((state) => state.setWindow);
  const projects = useProjects().data ?? [];
  if (!window) return null;

  const { app_name, window_title } = window.context;
  const outcome = ruleOutcome(window.matches);
  const project = projects.find(({ id }) => id === outcome.projectId)?.name;
  const adds = [project, ...outcome.tagPaths.map((path) => `#${path}`)].filter(Boolean);

  return (
    <div className="flex items-start gap-2 px-1 pt-1 text-xs text-ink-muted">
      <div className="min-w-0 flex-1">
        <p className="truncate" title={window_title ?? app_name}>
          <span className="text-ink">{app_name}</span>
          {window_title ? ` · ${window_title}` : ''}
        </p>
        {adds.length > 0 ? <p className="truncate">rule: {adds.join(' · ')}</p> : null}
      </div>
      <button
        type="button"
        aria-label="Don't save the window with this entry"
        title="Don't save the window with this entry"
        className="rounded px-1 hover:bg-line hover:text-ink"
        onClick={() => setWindow(null)}
      >
        ×
      </button>
    </div>
  );
}
