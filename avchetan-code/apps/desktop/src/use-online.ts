import { useSyncExternalStore } from 'react';
import { useServices } from './services-context';

export function useOnline(): boolean {
  const { platform } = useServices();
  return useSyncExternalStore(
    (onChange) => platform.network.subscribe(onChange),
    () => platform.network.isOnline(),
  );
}
