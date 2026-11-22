import { configureLogging, createLogger, errorFields, toAppError } from '@avchetan/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { type AppServices, openAppServices } from './app-services';
import { HelpLink } from './help-link';
import { createTauriPlatform } from './platform';
import { createDesktopLogSink, pluginLogWriter } from './platform/log-sink';
import { createQueryClient } from './query-client';
import { ServicesProvider } from './services-context';
import './styles.css';

const log = createLogger('bootstrap');

/** Shared startup for both windows: logging, services, query client, error screen. */
export async function bootstrap(
  render: (services: AppServices) => ReactNode,
  beforeRender?: (services: AppServices) => Promise<void>,
): Promise<void> {
  configureLogging({
    level: import.meta.env.DEV ? 'debug' : 'info',
    sink: createDesktopLogSink({ write: pluginLogWriter, console: import.meta.env.DEV }),
  });
  // Errors nothing caught: where they were thrown, never their text.
  window.addEventListener('error', (event) =>
    log.error('uncaught error', errorFields(event.error)),
  );
  window.addEventListener('unhandledrejection', (event) =>
    log.error('unhandled rejection', errorFields(event.reason)),
  );
  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root');
  const root = createRoot(container);

  try {
    const services = await openAppServices(createTauriPlatform());
    await beforeRender?.(services);
    const queryClient = createQueryClient();
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ServicesProvider services={services}>{render(services)}</ServicesProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  } catch (error) {
    const appError = toAppError(error);
    log.error('startup failed', errorFields(appError));
    root.render(<StartupError code={appError.code} />);
  }
}

function StartupError(props: { code: string }) {
  return (
    <div className="m-3 rounded-[var(--radius-panel)] border border-line bg-surface-raised p-4 text-sm">
      <p className="font-medium">Avchetan couldn't open its database.</p>
      <p className="mt-1 text-ink-muted">
        Quit Avchetan from the tray and start it again. If that doesn't help, follow the guide.
      </p>
      <p className="mt-2 text-ink-muted">
        Error code: <code>{props.code}</code> · <HelpLink code="database_unavailable" />
      </p>
    </div>
  );
}
