import { useMutation } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { type ReactNode, useEffect, useRef } from 'react';
import { AppState, Text, View } from 'react-native';
import { expoDeviceLock } from '../platform/device-lock';
import { isOpenWhileLocked, unlockApp, unlockMessage, useAppLock } from '../services/app-lock';
import { useServices } from '../services-context';
import { Button, HelpLink } from './parts';

/** Long enough for a widget capture's Save to send the app away before a prompt would show. */
const AUTO_PROMPT_DELAY_MS = 300;

export function useUnlock() {
  const { store } = useServices();
  return useMutation({ mutationFn: (reason: string) => unlockApp(store, expoDeviceLock, reason) });
}

/** In place of every screen but capture while the app is locked (app-lock.md). */
function LockScreen() {
  const unlock = useUnlock();
  const focused = useIsFocused();
  const asked = useRef(false);
  const { mutate } = unlock;

  // Ask once, when this screen is the one in front and the app is on screen.
  useEffect(() => {
    if (!focused || asked.current) return;
    const timer = setTimeout(() => {
      if (asked.current || AppState.currentState !== 'active') return;
      asked.current = true;
      mutate('Unlock Avchetan');
    }, AUTO_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focused, mutate]);

  const message = unlockMessage(unlock.data ?? null);
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-surface p-6">
      <Text className="text-4xl" accessibilityElementsHidden importantForAccessibility="no">
        🔒
      </Text>
      <Text className="text-lg font-semibold text-ink">Avchetan is locked</Text>
      <Button
        primary
        label="Unlock"
        disabled={unlock.isPending}
        onPress={() => unlock.mutate('Unlock Avchetan')}
      />
      {message ? (
        <Text accessibilityRole="alert" className="text-center text-sm text-danger">
          {message} <HelpLink code="app_lock_unavailable" />
        </Text>
      ) : null}
      <Button label="+ Write something" onPress={() => router.push('/capture')} />
      <Text className="text-center text-sm text-inkMuted">
        Writing works while locked; nothing you wrote before is shown.
      </Text>
    </View>
  );
}

/**
 * The root Stack's `screenLayout`: a locked screen's content is replaced, not covered, so nothing
 * written before is rendered behind the lock.
 */
export function lockedScreenLayout({
  route,
  children,
}: {
  route: { name: string };
  children: ReactNode;
}) {
  if (isOpenWhileLocked(route.name)) return <>{children}</>;
  return <LockGate>{children}</LockGate>;
}

function LockGate({ children }: { children: ReactNode }) {
  const locked = useAppLock((state) => state.locked);
  return locked ? <LockScreen /> : <>{children}</>;
}
