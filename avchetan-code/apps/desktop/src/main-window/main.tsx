import { bootstrap } from '../bootstrap';
import { mainViewSchema } from '../native/events';
import { MainApp } from './main-app';

declare global {
  interface Window {
    /** Set by src-tauri/src/windows.rs when it creates this window. */
    __AVCHETAN_INITIAL_VIEW__?: string;
    /** A day to open in Days (a brief notification); checked there as YYYY-MM-DD. */
    __AVCHETAN_INITIAL_DAY__?: string;
  }
}

const requested = mainViewSchema.safeParse(window.__AVCHETAN_INITIAL_VIEW__);
const initialView = requested.success ? requested.data : 'timeline';

const initialDay = /^\d{4}-\d{2}-\d{2}$/.test(window.__AVCHETAN_INITIAL_DAY__ ?? '')
  ? (window.__AVCHETAN_INITIAL_DAY__ ?? null)
  : null;

void bootstrap(() => <MainApp initialView={initialView} initialDay={initialDay} />);
