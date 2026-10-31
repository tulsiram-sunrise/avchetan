import '../global.css';
import { createLogger, toAppError } from '@avchetan/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { type AppServices, openAppServices } from '../src/app-services';
import { openHelp } from '../src/help';
import { createExpoPlatform } from '../src/platform';
import { ServicesProvider } from '../src/services-context';

const log = createLogger('app');
const queryClient = new QueryClient();

type Startup =
  | { status: 'opening' }
  | { status: 'failed' }
  | { status: 'ready'; services: AppServices };

function StartupFailed() {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-white p-6 dark:bg-neutral-950">
      <Text className="text-center text-base text-neutral-900 dark:text-neutral-100">
        Avchetan couldn't open its database. Close the app and open it again.
      </Text>
      <Pressable onPress={() => void openHelp('database_unavailable')}>
        <Text className="text-base text-blue-600 dark:text-blue-400">Open the guide</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [startup, setStartup] = useState<Startup>({ status: 'opening' });

  useEffect(() => {
    createExpoPlatform()
      .then(openAppServices)
      .then(
        (services) => {
          services.extraction.start();
          setStartup({ status: 'ready', services });
        },
        (error) => {
          log.error('startup failed', { code: toAppError(error).code });
          setStartup({ status: 'failed' });
        },
      );
  }, []);

  if (startup.status === 'failed') return <StartupFailed />;
  if (startup.status === 'opening') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ServicesProvider services={startup.services}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </ServicesProvider>
  );
}
