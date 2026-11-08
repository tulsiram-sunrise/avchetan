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
  speechRequest,
  speechSupport,
} from '../../src/services/speech';
import { useServices } from '../../src/services-context';
import { Button, Failure, HelpLink } from '../../src/ui/parts';

const LABELS: Record<SpeechLocale, string> = {
  mixed: 'Hindi + English (switches as you speak)',
  'en-IN': 'English (India)',
  'hi-IN': 'Hindi (English words in Devanagari too)',
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
  const chosen = settings.data?.locale ?? 'mixed';
  const { languages } = speechRequest(chosen, phoneLocale(), Number(Platform.Version));
  const readiness = useQuery({
    queryKey: ['native', 'speech-locales', ...languages],
    enabled: support.ok,
    queryFn: async () => {
      const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({});
      return languages.map((language) => ({
        language,
        readiness: localeReadiness(language, supported),
      }));
    },
  });
  const download = useMutation({
    mutationFn: (locale: string) =>
      ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale }),
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
      {chosen === 'mixed' ? (
        <Text className="text-sm text-inkMuted">
          Starts in English and switches to Hindi when it hears Hindi, so English comes out in
          English letters and Hindi in Devanagari. Needs Android 14 and both languages on the phone;
          some phones ignore the switch and stay in English.
        </Text>
      ) : null}
      {support.ok && readiness.data
        ? readiness.data.map(({ language, readiness: state }) => (
            <View key={language} className="gap-2">
              <Text className="text-sm text-inkMuted">
                {state === 'installed'
                  ? `${language} is ready offline.`
                  : state === 'downloadable'
                    ? `${language} isn't on this phone yet. Download it once to use voice offline.`
                    : `The phone didn't say whether ${language} is ready offline. Try 🎤; if it doesn't work, download the language in Android settings.`}{' '}
                {state === 'installed' ? null : <HelpLink code="speech_offline_unavailable" />}
              </Text>
              {state === 'downloadable' ? (
                <View className="flex-row">
                  <Button
                    label={
                      download.isSuccess && download.variables === language
                        ? 'Download started'
                        : `Download ${language}`
                    }
                    disabled={download.isPending}
                    onPress={() => download.mutate(language)}
                  />
                </View>
              ) : null}
            </View>
          ))
        : null}
      <Failure error={save.error ?? download.error ?? readiness.error} />
    </ScrollView>
  );
}
