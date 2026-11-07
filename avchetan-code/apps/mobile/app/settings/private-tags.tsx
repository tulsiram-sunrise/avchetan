import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAddPrivateTag, usePrivateTags, useSetTagPrivate } from '../../src/queries/private';
import { Button, Failure, Field } from '../../src/ui/parts';

/** More → Private tags (docs/product/private-entries.md#private-tags). */
export default function PrivateTagsScreen() {
  const tags = usePrivateTags().data ?? [];
  const add = useAddPrivateTag();
  const setPrivate = useSetTagPrivate();
  const [path, setPath] = useState('');
  const marked = tags.filter((tag) => tag.makesPrivate);
  const typed = path.trim().replace(/^#/, '');

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName="gap-4 p-4"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-sm text-inkMuted">
        An entry with one of these tags, or a tag under it, is private: only an AI on your own PC or
        hub reads it, as with !private. Counts the tags you type. Changes here reach your other
        devices.
      </Text>
      {marked.length > 0 ? (
        marked.map((tag) => (
          <View
            key={tag.id}
            className="flex-row items-center justify-between border-b border-line pb-2"
          >
            <Text className="text-base text-ink">🔒 #{tag.path}</Text>
            <Button
              label="Remove"
              disabled={setPrivate.isPending}
              onPress={() => setPrivate.mutate({ id: tag.id, makesPrivate: false })}
            />
          </View>
        ))
      ) : (
        <Text className="text-sm text-inkMuted">None yet.</Text>
      )}
      <Field label="Tag to make private" placeholder="health" value={path} onChangeText={setPath} />
      <View className="flex-row">
        <Button
          primary
          label="Add"
          disabled={add.isPending || !typed}
          onPress={() => add.mutate(typed, { onSuccess: () => setPath('') })}
        />
      </View>
      <Failure error={add.error ?? setPrivate.error} />
    </ScrollView>
  );
}
