import '../global.css';
import { createLogger, toAppError } from '@avchetan/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { type AppServices, getAppServices } from '../src/app-services';
import { queryClient, refreshAll } from '../src/query-client';
import { registerBackgroundWork } from '../src/services/background';
import { reminderDay, scheduleBriefReminder } from '../src/services/brief-reminder';
import { watchAppState } from '../src/services/foreground';
import { ServicesProvider } from '../src/services-context';
import { AppTheme } from '../src/theme/theme';
import { HelpLink } from '../src/ui/parts';

const log = createLogger('app');

/** A link straight to a screen (the widget opens `/capture`) still has the tabs beneath it. */
export const unstable_settings = { initialRouteName: '(tabs)' };

// A reminder that arrives while the app is open still shows.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** A tapped brief reminder opens Days on its day, which makes or fetches the brief. */
function OpenTappedReminder() {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const day = reminderDay(response ?? null);
    if (!day) return;
    router.navigate({ pathname: '/', params: { day } });
    void Notifications.clearLastNotificationResponseAsync();
  }, [response]);
  return null;
}

type Startup =
  | { status: 'opening' }
  | { status: 'failed' }
  | { status: 'ready'; services: AppServices };

function AppRoutes({ startup }: { startup: Startup }) {
  if (startup.status === 'failed') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-surface p-6">
        <Text className="text-center text-base text-ink">
          Avchetan couldn't open its database. Close the app and open it again.{' '}
          <HelpLink code="database_unavailable" />
        </Text>
      </View>
    );
  }
  if (startup.status === 'opening') {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <ServicesProvider services={startup.services}>
      <QueryClientProvider client={queryClient}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="capture"
            options={{
              presentation: 'formSheet',
              headerShown: false,
              sheetAllowedDetents: [0.6],
              sheetGrabberVisible: true,
            }}
          />
          <Stack.Screen name="log/[id]" options={{ title: 'Entry' }} />
          <Stack.Screen name="settings/ai-models" options={{ title: 'AI models' }} />
          <Stack.Screen name="settings/sync" options={{ title: 'Sync' }} />
          <Stack.Screen name="settings/data" options={{ title: 'Your data' }} />
          <Stack.Screen name="settings/brief" options={{ title: 'Daily brief' }} />
          <Stack.Screen name="settings/private-tags" options={{ title: 'Private tags' }} />
          <Stack.Screen name="settings/voice" options={{ title: 'Voice' }} />
          <Stack.Screen name="settings/learned" options={{ title: 'What Avchetan learned' }} />
          <Stack.Screen name="settings/pair" options={{ title: 'Scan pairing code' }} />
          <Stack.Screen name="settings/check" options={{ title: 'Setup check' }} />
          <Stack.Screen name="setup" options={{ title: 'Welcome', headerBackVisible: false }} />
        </Stack>
        <OpenTappedReminder />
      </QueryClientProvider>
    </ServicesProvider>
  );
}

export default function RootLayout() {
  const [startup, setStartup] = useState<Startup>({ status: 'opening' });

  useEffect(() => {
    let stopWatching = () => {};
    getAppServices().then(
      (services) => {
        services.extraction.start();
        services.sync.start();
        services.brief.start();
        void scheduleBriefReminder(services.store);
        void registerBackgroundWork();
        stopWatching = watchAppState(AppState, {
          onActive: () => {
            // Android may have stopped timers, and the background task may have changed rows.
            refreshAll();
            void services.extraction.wake();
            void services.sync.syncNow();
            void services.brief.wake();
            void scheduleBriefReminder(services.store);
          },
          // Timers stop now, so a change waiting out the sync debounce would wait until the app
          // came back. Requests still run, so send it before leaving.
          onLeave: () => void services.sync.syncNow(),
        });
        setStartup({ status: 'ready', services });
      },
      (error) => {
        log.error('startup failed', { code: toAppError(error).code });
        setStartup({ status: 'failed' });
      },
    );
    return () => stopWatching();
  }, []);

  return (
    <AppTheme>
      <StatusBar style="auto" />
      <AppRoutes startup={startup} />
    </AppTheme>
  );
}
