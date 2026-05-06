import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import type { OpenInAppId } from '@shared/openInApps';
import { getDefaultLocalWorktreeDirectory } from './worktree-defaults';

export const DEFAULT_AGENT_ID = 'claude';
export const DEFAULT_REVIEW_PROMPT =
  'Review all changes in this worktree. Focus on correctness, regressions, edge cases, and missing tests. List concrete issues first, then note residual risks.';

type SettingsDefaultsMap = {
  [K in AppSettingsKey]: AppSettings[K] | (() => AppSettings[K]);
};

export const SETTINGS_DEFAULTS = {
  localProject: () => ({
    defaultProjectsDirectory: join(homedir(), 'emdash', 'repositories'),
    defaultWorktreeDirectory: getDefaultLocalWorktreeDirectory(),
    branchPrefix: 'emdash',
    pushOnCreate: true,
    writeAgentConfigToGitIgnore: true,
  }),
  tasks: {
    autoGenerateName: true,
    autoTrustWorktrees: true,
  },
  agentAutoApproveDefaults: {},
  notifications: {
    enabled: true,
    sound: true,
    osNotifications: true,
    soundFocusMode: 'always' as const,
  },
  terminal: {
    autoCopyOnSelection: false,
  },
  theme: null,
  defaultAgent: DEFAULT_AGENT_ID,
  reviewPrompt: DEFAULT_REVIEW_PROMPT,
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
