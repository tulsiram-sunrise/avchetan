import { type CommandOutcome, type CommandPlan, parseCommand } from '@avchetan/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useAppLock } from '../services/app-lock';
import { phoneSuggestions, planPhoneCommand } from '../services/command-plan';
import { phoneCommandDeps } from '../services/commands';
import { useServices } from '../services-context';
import { useUnlock } from './lock-screen';
import { Button, Failure } from './parts';

/**
 * The capture box while the text starts with `/` (§14 of tasks-routines-reminders.md): what the
 * command will do, and a button to do it. Task titles are shown only when the app is unlocked.
 */
export function CommandPanel(props: {
  text: string;
  setText: (text: string) => void;
  onOutcome: (outcome: CommandOutcome) => void;
}) {
  const { text, setText, onOutcome } = props;
  const services = useServices();
  const { store } = services;
  const locked = useAppLock((state) => state.locked);
  const unlock = useUnlock();
  const deps = useMemo(() => phoneCommandDeps(services), [services]);
  const openTasks = useQuery({
    queryKey: ['tasks', 'open', 'commands'],
    queryFn: () => store.queries.openTasks(store.db),
    enabled: !locked,
  });
  const run = useMutation({
    mutationFn: (start: () => Promise<CommandOutcome>) => start(),
    onSuccess: onOutcome,
  });

  if (locked) {
    return (
      <View className="gap-2">
        <Text className="text-sm text-inkMuted">Unlock to run commands</Text>
        <Button
          label="Unlock"
          disabled={unlock.isPending}
          onPress={() => unlock.mutate('Unlock to run this command')}
        />
      </View>
    );
  }

  const parsed = parseCommand(text);
  if (!parsed || !openTasks.data) return null;
  const plan: CommandPlan = planPhoneCommand(deps, parsed, openTasks.data);
  const suggestions = parsed.command ? [] : phoneSuggestions(parsed.word);

  return (
    <View className="gap-2">
      {suggestions.map((name) => (
        <Button key={name} label={`/${name}`} onPress={() => setText(`/${name} `)} />
      ))}
      <PlanView plan={plan} busy={run.isPending} onRun={(start) => run.mutate(start)} />
      <Failure error={run.error} />
    </View>
  );
}

function PlanView(props: {
  plan: CommandPlan;
  busy: boolean;
  onRun: (start: () => Promise<CommandOutcome>) => void;
}) {
  const { plan, busy, onRun } = props;
  switch (plan.kind) {
    case 'hint':
      return <Text className="text-sm text-inkMuted">{plan.text}</Text>;
    case 'error':
      return (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {plan.message}
        </Text>
      );
    case 'run':
      return <Button primary label={plan.label} disabled={busy} onPress={() => onRun(plan.run)} />;
    case 'choose':
      return (
        <View className="gap-2">
          <Text className="text-sm text-inkMuted">Several tasks match. Tap the one you did</Text>
          {plan.options.map((option) => (
            <Button
              key={option.key}
              label={`Done: ${option.label}`}
              disabled={busy}
              onPress={() => onRun(option.run)}
            />
          ))}
        </View>
      );
    case 'ask_ai':
      return null;
  }
}
