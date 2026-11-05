import { Linking } from 'react-native';

/** Published user guide (GitHub Pages). Error codes are headings in troubleshooting.md. */
const GUIDE_URL = 'https://tulsiram-sunrise.github.io/avchetan/user-guide';

/** New GitHub issue with the bug-report form. */
const REPORT_PROBLEM_URL =
  'https://github.com/tulsiram-sunrise/avchetan/issues/new?template=bug-report.yml';

export function openGuide(): Promise<void> {
  return Linking.openURL(`${GUIDE_URL}/`);
}

export function openReportProblem(): Promise<void> {
  return Linking.openURL(REPORT_PROBLEM_URL);
}

/** Opens a troubleshooting section in the browser. */
export function openHelp(section: string): Promise<void> {
  return Linking.openURL(`${GUIDE_URL}/troubleshooting#${section}`);
}
