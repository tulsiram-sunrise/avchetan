import { createLogger } from '@avchetan/shared';
import { openHelp, troubleshootingUrl } from './help';

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
