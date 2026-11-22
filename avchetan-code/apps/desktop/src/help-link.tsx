import { createLogger, helpSection, logErrorShown } from '@avchetan/shared';
import { useEffect } from 'react';
import { openHelp, troubleshootingUrl } from './help';
import { emitAppEvent } from './native/events';

const log = createLogger('help');

/**
 * "Help" link to the troubleshooting section for an error code (ERROR_HELP). Nothing for a code
 * whose message is the whole fix.
 */
export function HelpLink(props: { code: string }) {
  // Every error shown with a Help link is in the log (docs/conventions/errors-and-logging.md).
  useEffect(() => logErrorShown(props.code), [props.code]);
  const section = helpSection(props.code);
  if (!section) return null;
  return (
    <a
      className="text-accent underline"
      href={troubleshootingUrl(section)}
      onClick={(event) => {
        event.preventDefault();
        openHelp(section).catch(() => log.warn('could not open help', { section }));
      }}
    >
      Help
    </a>
  );
}

/** Opens the Setup check, which every connection error links to. */
export function SetupCheckLink() {
  return (
    <button
      type="button"
      className="text-accent underline"
      onClick={() =>
        void emitAppEvent('main:navigate', { view: 'check' }).catch(() =>
          log.warn('could not open the setup check'),
        )
      }
    >
      Setup check
    </button>
  );
}
