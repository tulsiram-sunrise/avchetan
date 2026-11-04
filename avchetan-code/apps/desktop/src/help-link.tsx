import { createLogger } from '@avchetan/shared';
import { openHelp, troubleshootingUrl } from './help';
import { emitAppEvent } from './native/events';

const log = createLogger('help');

/** "Help" link to the troubleshooting section for an error code. */
export function HelpLink(props: { code: string }) {
  return (
    <a
      className="text-accent underline"
      href={troubleshootingUrl(props.code)}
      onClick={(event) => {
        event.preventDefault();
        openHelp(props.code).catch(() => log.warn('could not open help', { code: props.code }));
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
