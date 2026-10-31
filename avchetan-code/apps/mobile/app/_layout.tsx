import '../global.css';
import { createLogger, toAppError } from '@avchetan/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { type AppServices, getAppServices } from '../src/app-services';
import { queryClient, refreshAll } from '../src/query-client';
import { registerBackgroundWork } from '../src/services/background';
import { watchForeground } from '../src/services/foreground';
import { ServicesProvider } from '../src/services-context';
import { AppTheme } from '../src/theme/theme';
import { HelpLink } from '../src/ui/parts';

const log = createLogger('app');

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
        </Stack>
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
        void registerBackgroundWork();
        stopWatching = watchForeground(AppState, () => {
          // Android may have stopped timers, and the background task may have changed rows.
          refreshAll();
          void services.extraction.wake();
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
