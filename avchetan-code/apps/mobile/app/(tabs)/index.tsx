import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { useServices } from '../../src/services-context';

export default function TodayScreen() {
  const { store } = useServices();
  const pending = useQuery({
    queryKey: ['pending-count'],
    queryFn: () => store.queries.pendingCount(store.db),
  });

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
      <Text className="text-base text-neutral-900 dark:text-neutral-100">
        {pending.data === undefined ? 'Loading…' : `${pending.data} entries waiting`}
      </Text>
    </View>
  );
}
