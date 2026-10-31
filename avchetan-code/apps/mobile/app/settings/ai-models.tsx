import { ScrollView } from 'react-native';
import { ModelSlotForm } from '../../src/ui/model-form';

export default function AiModelsScreen() {
  return (
    <ScrollView className="flex-1 bg-surface" keyboardShouldPersistTaps="handled">
      <ModelSlotForm slot="extraction" />
      <ModelSlotForm slot="analysis" />
    </ScrollView>
  );
}
