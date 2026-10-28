import { configureLogging, createLogger, toAppError } from '@avchetan/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { type AppServices, openAppServices } from './app-services';
import { HelpLink } from './help-link';
import { createTauriPlatform } from './platform';
import { ServicesProvider } from './services-context';
import './styles.css';

const log = createLogger('bootstrap');

/** Shared startup for both windows: logging, services, query client, error screen. */
export async function bootstrap(
  render: (services: AppServices) => ReactNode,
  beforeRender?: (services: AppServices) => Promise<void>,
): Promise<void> {
  configureLogging({ level: import.meta.env.DEV ? 'debug' : 'info' });
  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root');
  const root = createRoot(container);

  try {
    const services = await openAppServices(createTauriPlatform());
    await beforeRender?.(services);
    // Local SQLite reads are cheap and change only through our own writes.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
    });
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ServicesProvider services={services}>{render(services)}</ServicesProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  } catch (error) {
    const appError = toAppError(error);
    log.error('startup failed', { code: appError.code });
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
