import {
  applyMetricRows,
  type MetricRow,
  type MetricRowProblem,
  metricChoicesFor,
  metricRows,
  nextMetricKey,
} from '@avchetan/core';
import type { Activity } from '@avchetan/db/sqlite';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useEditActivityNumbers } from '../queries/writes';
import { usePalette } from '../theme/theme';
import { Button, Failure } from './parts';
import { PickSheet } from './pick-sheet';

/**
 * An activity's numbers, one row each: what it is (tap to choose) and the value. Typed units are
 * converted (5 mi → 8.05 km). Saving marks the activity *edited* and teaches the AI
 * (docs/product/finding-and-using-data.md#3-editing-an-activitys-numbers).
 */
export function MetricsEditor(props: { activity: Activity; onClose: () => void }) {
  const { activity } = props;
  const palette = usePalette();
  const edit = useEditActivityNumbers();
  const choices = metricChoicesFor(activity.metrics);
  const [rows, setRows] = useState<MetricRow[]>(() => {
    const current = metricRows(activity.metrics);
    return current.length > 0 ? current : [{ key: nextMetricKey([]), value: '' }];
  });
  const [problems, setProblems] = useState<MetricRowProblem[]>([]);
  const [picking, setPicking] = useState<number | null>(null);

  const change = (index: number, patch: Partial<MetricRow>) => {
    setRows((all) => all.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setProblems([]);
  };
  const save = () => {
    const result = applyMetricRows(activity.metrics, rows);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    edit.mutate({ id: activity.id, metrics: result.metrics }, { onSuccess: props.onClose });
  };
  const picked = picking === null ? undefined : rows[picking];

  return (
    <View className="gap-3 pt-2">
      {rows.map((row, index) => {
        const choice = choices.find((c) => c.key === row.key);
        const problem = problems.find((p) => p.index === index);
        return (
          // Rows have no ID; the index is their identity while the editor is open.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <View key={index} className="gap-1">
            <View className="flex-row items-center gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Number ${index + 1}: ${choice?.label ?? 'choose'}`}
                className="flex-1 rounded-lg border border-line px-3 py-2"
                onPress={() => setPicking(index)}
              >
                <Text className="text-sm text-ink">{choice?.label ?? 'Choose'} ▾</Text>
              </Pressable>
              <TextInput
                accessibilityLabel={`${choice?.label ?? 'Number'} value`}
                className="w-24 rounded-lg border border-line px-3 py-2 text-sm text-ink"
                placeholderTextColor={palette.inkMuted}
                placeholder={choice?.unit ? `5 ${choice.unit}` : '5'}
                value={row.value}
                onChangeText={(value) => change(index, { value })}
              />
              <Text className="w-10 text-xs text-inkMuted">{choice?.unit ?? ''}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${choice?.label ?? 'number'}`}
                hitSlop={8}
                onPress={() => {
                  setRows((all) => all.filter((_, i) => i !== index));
                  setProblems([]);
                }}
              >
                <Text className="text-base text-inkMuted">✕</Text>
              </Pressable>
            </View>
            {problem ? <Text className="text-xs text-danger">{problem.message}</Text> : null}
          </View>
        );
      })}
      <Text className="text-xs text-inkMuted">
        Type another unit if you like (5 mi, 1.5 h); it's converted. Empty a value to remove it.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Add a number"
          onPress={() =>
            setRows((all) => [...all, { key: nextMetricKey(all.map((r) => r.key)), value: '' }])
          }
        />
        <Button primary label="Save" disabled={edit.isPending} onPress={save} />
        <Button label="Cancel" onPress={props.onClose} />
      </View>
      <Failure error={edit.error} />
      <PickSheet
        open={
          picked
            ? {
                title: 'What is this number?',
                options: choices.map((c) => ({
                  value: c.key,
                  label: c.unit ? `${c.label} (${c.unit})` : c.label,
                })),
                selected: picked.key,
              }
            : undefined
        }
        onPick={(key) => {
          if (picking !== null) change(picking, { key });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}
