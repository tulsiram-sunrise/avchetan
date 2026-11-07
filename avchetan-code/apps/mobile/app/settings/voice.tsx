import {
  loadVoiceSettings,
  SPEECH_LOCALES,
  type SpeechLocale,
  saveVoiceSettings,
} from '@avchetan/core';
import { describeError } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import {
  localeReadiness,
  phoneLocale,
  speechLanguage,
  speechSupport,
} from '../../src/services/speech';
import { useServices } from '../../src/services-context';
import { Button, Failure, HelpLink } from '../../src/ui/parts';

const LABELS: Record<SpeechLocale, string> = {
  'hi-IN': 'Hindi + English (India)',
  'en-IN': 'English (India)',
  phone: 'Phone language',
};

const settingsKey = ['settings', 'voice'] as const;

/** More → Voice (docs/product/voice-capture.md#more--voice-phone). */
export default function VoiceScreen() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => loadVoiceSettings(store) });
  const save = useMutation({
    mutationFn: (locale: SpeechLocale) => saveVoiceSettings(store, { locale }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
  const support = speechSupport(ExpoSpeechRecognitionModule, Number(Platform.Version));
  const chosen = settings.data?.locale ?? 'hi-IN';
  const language = speechLanguage(chosen, phoneLocale());
  const readiness = useQuery({
    queryKey: ['native', 'speech-locales', language],
    enabled: support.ok,
    queryFn: async () =>
      localeReadiness(language, await ExpoSpeechRecognitionModule.getSupportedLocales({})),
  });
  const download = useMutation({
    mutationFn: () =>
      ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: language }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['native', 'speech-locales'] }),
  });

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
      <Text className="text-sm text-inkMuted">
        Tap 🎤 in the capture box, or on the widget, and talk. The phone turns it into text itself,
        offline; your voice is never sent anywhere or recorded.
      </Text>
      {!support.ok ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {support.reason === 'old_android'
            ? 'Voice needs Android 13 or newer, where speech can be recognised on the phone.'
            : `${describeError({ code: support.code, message: '' }).message}.`}{' '}
          <HelpLink code={support.code} />
        </Text>
      ) : null}
      <View className="gap-2">
        <Text className="text-sm text-ink">Language</Text>
        {SPEECH_LOCALES.map((locale) => (
          <Pressable
            key={locale}
            accessibilityRole="radio"
            accessibilityState={{ checked: chosen === locale }}
            onPress={() => save.mutate(locale)}
            className="flex-row items-center gap-3 border-b border-line py-2"
          >
            <Text className="text-base text-ink">{chosen === locale ? '◉' : '○'}</Text>
            <Text className="text-base text-ink">
              {LABELS[locale]}
              {locale === 'phone' ? ` (${phoneLocale()})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      {support.ok && readiness.data ? (
        <View className="gap-2">
          <Text className="text-sm text-inkMuted">
            {readiness.data === 'installed'
              ? `${language} is ready offline.`
              : readiness.data === 'downloadable'
                ? `${language} isn't on this phone yet. Download it once to use voice offline.`
                : `The phone didn't say whether ${language} is ready offline. Try 🎤; if it doesn't work, download the language in Android settings.`}{' '}
            {readiness.data === 'installed' ? null : <HelpLink code="speech_offline_unavailable" />}
          </Text>
          {readiness.data === 'downloadable' ? (
            <View className="flex-row">
              <Button
                label={download.isSuccess ? 'Download started' : 'Download'}
                disabled={download.isPending || download.isSuccess}
                onPress={() => download.mutate()}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <Failure error={save.error ?? download.error ?? readiness.error} />
    </ScrollView>
  );
}
