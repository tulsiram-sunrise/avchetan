import { openUrl } from '@tauri-apps/plugin-opener';

/** Published user guide (GitHub Pages). Error codes are headings in troubleshooting.md. */
export const GUIDE_URL = 'https://tulsiram-sunrise.github.io/avchetan/user-guide';

export function troubleshootingUrl(code: string): string {
  return `${GUIDE_URL}/troubleshooting#${code}`;
}

/** Opens a guide page in the system browser (a plain link would navigate the webview away). */
export function openHelp(code: string): Promise<void> {
  return openUrl(troubleshootingUrl(code));
}
