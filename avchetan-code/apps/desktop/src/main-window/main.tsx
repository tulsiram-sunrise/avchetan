import { bootstrap } from '../bootstrap';
import { MainApp } from './main-app';

declare global {
  interface Window {
    /** Set by src-tauri/src/windows.rs when it creates this window. */
    __AVCHETAN_INITIAL_VIEW__?: string;
  }
}

const requested = window.__AVCHETAN_INITIAL_VIEW__;
const initialView = requested === 'settings' || requested === 'setup' ? requested : 'timeline';

void bootstrap(() => <MainApp initialView={initialView} />);
