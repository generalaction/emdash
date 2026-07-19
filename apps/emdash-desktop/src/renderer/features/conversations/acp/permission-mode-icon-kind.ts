import type { PermissionModeIconKind } from '@emdash/ui/react/components';

const providerModeIconKinds: Record<string, Readonly<Record<string, PermissionModeIconKind>>> = {
  claude: {
    auto: 'approve',
    default: 'ask',
    acceptEdits: 'approve',
    plan: 'plan',
    dontAsk: 'ask',
    bypassPermissions: 'full-access',
  },
  codex: {
    'read-only': 'ask',
    agent: 'approve',
    'agent-full-access': 'full-access',
  },
  opencode: {
    build: 'approve',
    plan: 'plan',
  },
};

export function permissionModeIconKind(providerId: string, modeId: string): PermissionModeIconKind {
  return providerModeIconKinds[providerId]?.[modeId] ?? 'approve';
}
