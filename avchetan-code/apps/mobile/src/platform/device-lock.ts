import { createLogger, type UnlockOutcome } from '@avchetan/shared';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import type { DeviceLock } from '../services/app-lock';

const log = createLogger('device-lock');

/** expo-screen-capture keys its blocks; this one is the app lock's. */
const PREVIEW_KEY = 'app-lock';

export function outcomeOf(result: LocalAuthentication.LocalAuthenticationResult): UnlockOutcome {
  if (result.success) return 'verified';
  switch (result.error) {
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
      return 'cancelled';
    case 'not_enrolled':
    case 'passcode_not_set':
    case 'not_available':
      return 'unavailable';
    default:
      return 'failed';
  }
}

/** Biometrics, with the phone's screen lock (PIN, pattern, password) as the fallback. */
export const expoDeviceLock: DeviceLock = {
  available: async () =>
    (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE,
  authenticate: async (reason) =>
    outcomeOf(
      await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      }),
    ),
  hidePreview: async (hide) => {
    try {
      if (hide) await ScreenCapture.preventScreenCaptureAsync(PREVIEW_KEY);
      else await ScreenCapture.allowScreenCaptureAsync(PREVIEW_KEY);
    } catch {
      log.warn('could not change the recent-apps cover');
    }
  },
};
