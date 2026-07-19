import { Hand, ListTodo, ShieldAlert, ShieldCheck } from 'lucide-react';

export type PermissionModeIconKind = 'ask' | 'approve' | 'full-access' | 'plan';

interface PermissionModeIconItem {
  id: string;
  name: string;
  description?: string;
}

export function permissionModeIconKind({
  id,
  name,
  description,
}: PermissionModeIconItem): PermissionModeIconKind {
  const text = `${id} ${name} ${description ?? ''}`.toLowerCase();
  if (/bypass|full[ -]?access|unrestricted|danger|yolo/.test(text)) return 'full-access';
  if (/\bplan(?:ning)?\b/.test(text)) return 'plan';
  if (/read[ -]?only|ask|default|deny/.test(text)) return 'ask';
  return 'approve';
}

export function PermissionModeIcon({
  item,
  size = '0.75rem',
}: {
  item: PermissionModeIconItem | null;
  size?: string;
}) {
  const kind = item ? permissionModeIconKind(item) : 'approve';
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
