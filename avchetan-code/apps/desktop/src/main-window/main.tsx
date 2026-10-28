import { bootstrap } from '../bootstrap';
import { MainApp } from './main-app';

declare global {
  interface Window {
    /** Set by src-tauri/src/windows.rs when it creates this window. */
    __AVCHETAN_INITIAL_VIEW__?: string;
  }
}

const initialView = window.__AVCHETAN_INITIAL_VIEW__ === 'settings' ? 'settings' : 'timeline';

void bootstrap(() => <MainApp initialView={initialView} />);
