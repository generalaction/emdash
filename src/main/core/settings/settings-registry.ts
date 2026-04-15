import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import type { OpenInAppId } from '@shared/openInApps';

export const DEFAULT_AGENT_ID = 'claude';

type SettingsDefaultsMap = {
  [K in AppSettingsKey]: AppSettings[K] | (() => AppSettings[K]);
};

export const SETTINGS_DEFAULTS = {
  localProject: () => ({
    defaultProjectsDirectory: join(homedir(), 'emdash', 'repositories'),
    defaultWorktreeDirectory: join(homedir(), 'emdash', 'worktrees'),
    branchPrefix: 'emdash',
    pushOnCreate: true,
    writeAgentConfigToGitIgnore: true,
  }),
  tasks: {
    autoGenerateName: true,
    autoApproveByDefault: false,
    autoTrustWorktrees: true,
  },
  notifications: {
    enabled: true,
    sound: true,
    osNotifications: true,
    soundFocusMode: 'always' as const,
  },
  terminal: {
    autoCopyOnSelection: false,
  },
  theme: 'emlight' as const,
  defaultAgent: DEFAULT_AGENT_ID,
  keyboard: {},
  openIn: {
    default: 'terminal' as const,
    hidden: [] as OpenInAppId[],
  },
  interface: {
    taskHoverAction: 'delete' as const,
    autoRightSidebarBehavior: false,
  },
  browserPreview: {
    enabled: true,
  },
} satisfies SettingsDefaultsMap;

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  const d = SETTINGS_DEFAULTS[key];
  return (typeof d === 'function' ? (d as () => AppSettings[K])() : d) as AppSettings[K];
}
