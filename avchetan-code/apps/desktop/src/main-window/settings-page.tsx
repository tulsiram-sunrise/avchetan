import { createLogger, systemTimeZone, toAppError } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getVersion } from '@tauri-apps/api/app';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useMemo, useState } from 'react';
import { GUIDE_URL, openExternal, REPORT_PROBLEM_URL } from '../help';
import { HelpLink } from '../help-link';
import { emitAppEvent } from '../native/events';
import { useBriefSettings, useSaveBriefSettings } from '../queries/brief';
import {
  useSetSubmitKey,
  useSetTimeZone,
  useSubmitKey,
  useTimeZoneChoice,
} from '../queries/settings';
import { changeHotkey } from '../services/hotkey';
import type { SubmitKey } from '../services/submit-key';
import { useServices } from '../services-context';
import { AiModelsSetting } from './ai-models-setting';
import { CommandsSetting } from './commands-setting';
import { DataSetting } from './data-setting';
import { HubSetting } from './hub-setting';
import { LearnedSetting } from './learned-setting';
import { SyncSetting } from './sync-setting';
import { QuietButton } from './ui';
import { UsageSetting } from './usage-setting';

const log = createLogger('settings');

function openView(view: 'setup' | 'check') {
  void emitAppEvent('main:navigate', { view }).catch(() =>
    log.warn('could not open view', { view }),
  );
}

export function SettingsPage() {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex gap-2">
        <QuietButton onClick={() => openView('check')}>Setup check</QuietButton>
        <QuietButton onClick={() => openView('setup')}>Run setup again</QuietButton>
      </div>
      <AiModelsSetting />
      <LearnedSetting />
      <CommandsSetting />
      <DailyBriefSetting />
      <HubSetting />
      <SyncSetting />
      <DataSetting />
      <UsageSetting />
      <ShortcutSetting />
      <SubmitKeySetting />
      <TimeZoneSetting />
      <AutostartSetting />
      <AboutSetting />
    </div>
  );
}

function AboutSetting() {
  const version = useQuery({ queryKey: ['native', 'version'], queryFn: getVersion });
  const open = (url: string) => () =>
    void openExternal(url).catch(() => log.warn('could not open a link'));

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">About</h2>
      <p className="text-sm text-ink-muted">Avchetan {version.data ?? ''}</p>
      <div className="flex gap-2">
        <QuietButton onClick={open(`${GUIDE_URL}/`)}>User guide</QuietButton>
        <QuietButton onClick={open(REPORT_PROBLEM_URL)}>Report a problem</QuietButton>
      </div>
    </section>
  );
}

const SUBMIT_KEY_OPTIONS: { value: SubmitKey; label: string }[] = [
  { value: 'enter', label: 'Enter saves, Shift+Enter starts a new line' },
  { value: 'shift_enter', label: 'Shift+Enter saves, Enter starts a new line' },
];

function SubmitKeySetting() {
  const current = useSubmitKey();
  const change = useSetSubmitKey();
  const selected = change.isPending ? change.variables : current.data;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 font-medium">Saving an entry</legend>
      {SUBMIT_KEY_OPTIONS.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="submit-key"
            value={option.value}
            checked={selected === option.value}
            disabled={!current.isSuccess}
            onChange={() => change.mutate(option.value)}
          />
          {option.label}
        </label>
      ))}
      {change.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this setting. Try again. <HelpLink code={toAppError(change.error).code} />
        </p>
      ) : null}
    </fieldset>
  );
}

function ShortcutSetting() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['native', 'hotkey'],
    queryFn: () => platform.shell.hotkeyStatus(),
  });
  const [value, setValue] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (shortcut: string) => changeHotkey(store, platform.shell, shortcut),
    onSuccess: (next) => {
      queryClient.setQueryData(['native', 'hotkey'], next);
      if (next.registered) setValue(null);
    },
  });

  const current = status.data?.shortcut ?? '';
  const failedCode =
    change.data && !change.data.registered
      ? (change.data.error ?? 'hotkey_unavailable')
      : change.error
        ? toAppError(change.error).code
        : null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Shortcut</h2>
      <p className="text-sm text-ink-muted">
        Press this anywhere in Windows to open the capture box.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (value?.trim()) change.mutate(value.trim());
        }}
      >
        <input
          aria-label="Shortcut"
          className="w-56 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm"
          value={value ?? current}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ctrl+Shift+Space"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={change.isPending || value === null || value.trim() === current}
        >
          Save
        </button>
      </form>
      {failedCode ? (
        <p role="alert" className="text-sm text-danger">
          That shortcut can't be used (another app may own it). Try another.{' '}
          <HelpLink code={failedCode} />
        </p>
      ) : null}
    </section>
  );
}

function DailyBriefSetting() {
  const settings = useBriefSettings();
  const save = useSaveBriefSettings();
  const [time, setTime] = useState<string | null>(null);
  const shown = time ?? settings.data?.time ?? '';

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Daily brief</h2>
      <p className="text-sm text-ink-muted">
        A short look back at each day with entries, at the top of the day in Days, with a
        notification when it's ready. Made by your answers model, or by your hub.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.data?.enabled ?? true}
          disabled={!settings.isSuccess || save.isPending}
          onChange={(event) => save.mutate({ enabled: event.target.checked })}
        />
        Make a daily brief
      </label>
      <label className="flex items-center gap-2 text-sm">
        At
        <input
          type="time"
          aria-label="Brief time"
          className="rounded-lg border border-line bg-surface-raised px-2 py-1 text-sm"
          value={shown}
          disabled={!settings.isSuccess || !settings.data?.enabled || save.isPending}
          onChange={(event) => setTime(event.target.value)}
          onBlur={() => {
            if (time && time !== settings.data?.time) {
              save.mutate({ time }, { onSettled: () => setTime(null) });
            }
          }}
        />
      </label>
      {save.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this setting. Try again. <HelpLink code={toAppError(save.error).code} />
        </p>
      ) : null}
    </section>
  );
}

function TimeZoneSetting() {
  const choice = useTimeZoneChoice();
  const change = useSetTimeZone();
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Time zone</h2>
      <p className="text-sm text-ink-muted">
        Decides which day an entry belongs to, and what "tomorrow" means. A day ends at midnight.
      </p>
      <select
        aria-label="Time zone"
        className="w-72 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm"
        value={choice.data ?? ''}
        disabled={!choice.isSuccess || change.isPending}
        onChange={(event) => change.mutate(event.target.value || null)}
      >
        <option value="">Same as Windows ({systemTimeZone()})</option>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      {change.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this setting. Try again. <HelpLink code={toAppError(change.error).code} />
        </p>
      ) : null}
    </section>
  );
}

function AutostartSetting() {
  const queryClient = useQueryClient();
  const enabled = useQuery({ queryKey: ['native', 'autostart'], queryFn: isEnabled });
  const toggle = useMutation({
    mutationFn: (on: boolean) => (on ? enable() : disable()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['native', 'autostart'] }),
  });

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Start with Windows</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled.data ?? false}
          disabled={!enabled.isSuccess || toggle.isPending}
          onChange={(event) => toggle.mutate(event.target.checked)}
        />
        Start Avchetan when I sign in, so the shortcut always works
      </label>
    </section>
  );
}
