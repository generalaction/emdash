import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import type { OpenInAppId } from '@shared/openInApps';
import { TERMINAL_FONT_SIZE_DEFAULT } from '@shared/terminal-settings';
import { getDefaultLocalWorktreeDirectory } from './worktree-defaults';

export const DEFAULT_AGENT_ID = 'claude';

type SettingsDefaultsMap = {
  [K in AppSettingsKey]: AppSettings[K] | (() => AppSettings[K]);
};

export const SETTINGS_DEFAULTS = {
  project: {
    pushOnCreate: true,
    branchPrefix: 'emdash',
    appendRandomBranchSuffix: true,
    tmuxByDefault: false,
  },
  localProject: () => ({
    defaultProjectsDirectory: join(homedir(), 'emdash', 'repositories'),
    defaultWorktreeDirectory: getDefaultLocalWorktreeDirectory(),
    writeAgentConfigToGitIgnore: true,
  }),
  tasks: {
    autoGenerateName: true,
    autoTrustWorktrees: true,
    createBranchAndWorktree: true,
  },
  agentAutoApproveDefaults: {},
  notifications: {
    enabled: true,
    sound: true,
    customSoundPath: '',
    osNotifications: true,
    soundFocusMode: 'always' as const,
  },
  terminal: {
    fontSize: TERMINAL_FONT_SIZE_DEFAULT,
    autoCopyOnSelection: false,
  },
  theme: null,
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
  resourceMonitor: {
    enabled: false,
  },
} satisfies SettingsDefaultsMap;

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  const d = SETTINGS_DEFAULTS[key];
  return (typeof d === 'function' ? (d as () => AppSettings[K])() : d) as AppSettings[K];
}
