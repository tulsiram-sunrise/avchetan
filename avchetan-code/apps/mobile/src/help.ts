import { Linking } from 'react-native';

/** Published user guide (GitHub Pages). Error codes are headings in troubleshooting.md. */
const GUIDE_URL = 'https://tulsiram-sunrise.github.io/avchetan/user-guide';

/** Opens a troubleshooting section in the browser. */
export function openHelp(code: string): Promise<void> {
  return Linking.openURL(`${GUIDE_URL}/troubleshooting#${code}`);
}
