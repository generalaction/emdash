import type { PermissionModeIconKind } from '@emdash/ui/react/components';

export function permissionModeIconKind(modeId: string): PermissionModeIconKind {
  switch (modeId) {
    case 'ask':
    case 'default':
    case 'dontAsk':
    case 'read-only':
      return 'ask';
    case 'plan':
      return 'plan';
    case 'agent-full-access':
    case 'bypass':
    case 'bypassPermissions':
      return 'full-access';
    default:
      return 'approve';
  }
}
