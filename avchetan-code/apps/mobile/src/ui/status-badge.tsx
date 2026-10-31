import type { RawLogStatus } from '@avchetan/db';
import { Text } from 'react-native';

const LABELS: Record<RawLogStatus, { text: string; className: string }> = {
  pending_llm: { text: 'Pending', className: 'text-warn' },
  processed: { text: '✓ Organized', className: 'text-ok' },
  error: { text: 'Error', className: 'text-danger' },
  skipped: { text: 'Saved', className: 'text-inkMuted' },
};

export function StatusBadge({ status }: { status: RawLogStatus }) {
  const { text, className } = LABELS[status];
  return <Text className={`text-xs font-medium ${className}`}>{text}</Text>;
}
