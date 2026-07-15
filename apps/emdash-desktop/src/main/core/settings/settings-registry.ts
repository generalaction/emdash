import { homedir } from 'node:os';
import { join } from 'node:path';
import { asAgentProviderId } from '@emdash/plugins/agents/types';
import { DEFAULT_BROWSER_PROFILE_ID, DEFAULT_BROWSER_PROFILES } from '@shared/browser';
import type { AppSettings, AppSettingsKey } from '@shared/core/app-settings';
import { TERMINAL_FONT_SIZE_DEFAULT } from '@shared/core/terminals/terminal-settings';
import type { OpenInAppId } from '@shared/openInApps';
import { getDefaultLocalWorktreeDirectory } from './worktree-defaults';

export const DEFAULT_AGENT_ID = asAgentProviderId('claude');

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
    autoApproveByDefault: false,
    autoTrustWorktrees: true,
    createBranchAndWorktree: true,
    deleteBranchByDefault: false,
    preserveNameCapitalization: false,
    includeIssueContextByDefault: true,
  },
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
    macOptionIsMeta: false,
    defaultShell: 'system' as const,
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
    showLeftSidebarLineChanges: true,
    showLeftSidebarPrStatus: true,
    showLeftSidebarTimestamps: true,
    hideContextBar: false,
  },
  browserPreview: {
    enabled: true,
  },
  announcements: {
    initialized: false,
    dismissedIds: [] as string[],
  },
  browser: {
    defaultProfileId: DEFAULT_BROWSER_PROFILE_ID,
    relaxCorsForLocalhost: false,
    profiles: DEFAULT_BROWSER_PROFILES,
  },
  resourceMonitor: {
    enabled: false,
  },
  changesViewMode: {
    unstaged: 'flat' as const,
    staged: 'flat' as const,
    pr: 'flat' as const,
  },
} satisfies SettingsDefaultsMap;

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  const d = SETTINGS_DEFAULTS[key];
  return (typeof d === 'function' ? (d as () => AppSettings[K])() : d) as AppSettings[K];
}
