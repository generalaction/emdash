import type { PermissionModeIconKind } from '@emdash/ui/react/components';

type PermissionModePresentation = {
  iconKind: PermissionModeIconKind;
  name?: string;
};

const providerModePresentations: Record<
  string,
  Readonly<Record<string, PermissionModePresentation>>
> = {
  claude: {
    auto: { iconKind: 'approve' },
    default: { iconKind: 'ask' },
    acceptEdits: { iconKind: 'approve' },
    plan: { iconKind: 'plan' },
    dontAsk: { iconKind: 'ask' },
    bypassPermissions: { iconKind: 'full-access' },
  },
  codex: {
    'read-only': { iconKind: 'ask' },
    agent: { iconKind: 'approve' },
    'agent-full-access': { iconKind: 'full-access' },
  },
  opencode: {
    build: { iconKind: 'approve', name: 'Build' },
    plan: { iconKind: 'plan', name: 'Plan' },
  },
};

export function permissionModePresentation(
  providerId: string,
  modeId: string,
  name: string
): Required<PermissionModePresentation> {
  const presentation = providerModePresentations[providerId]?.[modeId];
  return {
    iconKind: presentation?.iconKind ?? 'approve',
    name: presentation?.name ?? name,
  };
}
