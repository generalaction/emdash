import { Hand, ListTodo, ShieldAlert, ShieldCheck } from 'lucide-react';

export type PermissionModeIconKind = 'ask' | 'approve' | 'full-access' | 'plan';

export function PermissionModeIcon({
  kind = 'approve',
  size = '0.75rem',
}: {
  kind?: PermissionModeIconKind;
  size?: string;
}) {
  const Icon =
    kind === 'ask'
      ? Hand
      : kind === 'plan'
        ? ListTodo
        : kind === 'full-access'
          ? ShieldAlert
          : ShieldCheck;
  return (
    <Icon
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        color: kind === 'full-access' ? 'var(--em-surface-warning-foreground)' : undefined,
      }}
    />
  );
}
