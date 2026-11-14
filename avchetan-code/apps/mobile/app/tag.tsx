import { Stack, useLocalSearchParams } from 'expo-router';
import { CollectionView } from '../src/ui/collection-view';

/** One tag's page, with the tags nested under it. The path is a param: it may hold slashes. */
export default function TagScreen() {
  const { path = '' } = useLocalSearchParams<{ path: string }>();
  return (
    <>
      <Stack.Screen options={{ title: `#${path}` }} />
      <CollectionView
        of={{ tagPath: path }}
        empty={`Nothing carries #${path} yet. Add it to an entry ("ran 5 km #${path}") and the entry, its numbers and tasks show here.`}
      />
    </>
  );
}
