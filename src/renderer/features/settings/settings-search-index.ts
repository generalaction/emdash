import { AGENT_PROVIDERS } from '@shared/agent-provider-registry';
import { OPEN_IN_APPS } from '@shared/openInApps';
import type { SettingsPageTab } from './components/SettingsPage';

export interface SettingsSearchEntry {
  id: string;
  tab: SettingsPageTab;
  anchor?: string;
  title: string;
  description?: string;
  category?: string;
  keywords?: string[];
}

const STATIC_ENTRIES: SettingsSearchEntry[] = [
  {
    id: 'general:telemetry',
    tab: 'general',
    anchor: 'telemetry',
    category: 'General',
    title: 'Privacy & Telemetry',
    description: 'Help improve Emdash by sending anonymous usage data.',
    keywords: ['privacy', 'telemetry', 'analytics', 'tracking', 'usage', 'anonymous'],
  },
  {
    id: 'general:auto-generate-task-names',
    tab: 'general',
    anchor: 'auto-generate-task-names',
    category: 'General',
    title: 'Auto-generate task names',
    description: 'Automatically suggests a task name when creating a new task.',
    keywords: ['task', 'name', 'auto', 'generate', 'naming'],
  },
  {
    id: 'general:auto-trust-worktrees',
    tab: 'general',
    anchor: 'auto-trust-worktrees',
    category: 'General',
    title: 'Auto-trust worktree directories',
    description: 'Skip the folder trust prompt in Claude Code for new tasks.',
    keywords: ['claude', 'claude code', 'trust', 'worktree', 'folder', 'permissions'],
  },
  {
    id: 'general:notifications',
    tab: 'general',
    anchor: 'notifications',
    category: 'General',
    title: 'Notifications',
    description: 'Get notified when agents need your attention.',
    keywords: [
      'notifications',
      'sound',
      'audio',
      'banner',
      'os',
      'system notifications',
      'focus',
      'unfocused',
      'alert',
    ],
  },
  {
    id: 'general:update',
    tab: 'general',
    anchor: 'update',
    category: 'General',
    title: 'Version & Updates',
    description: 'Check for updates and install the latest version.',
    keywords: ['update', 'updates', 'version', 'release', 'install', 'download', 'auto-update'],
  },
  {
    id: 'account:account',
    tab: 'account',
    anchor: 'account',
    category: 'Account',
    title: 'Account',
    description: 'Sign in or out of your Emdash account.',
    keywords: ['account', 'sign in', 'sign out', 'login', 'logout', 'session', 'user'],
  },
  {
    id: 'clis-models:default-agent',
    tab: 'clis-models',
    anchor: 'default-agent',
    category: 'Agents',
    title: 'Default agent',
    description: 'The agent that will be selected by default when creating a new task.',
    keywords: ['default', 'agent', 'preferred', 'cli'],
  },
  {
    id: 'clis-models:review-prompt',
    tab: 'clis-models',
    anchor: 'review-prompt',
    category: 'Agents',
    title: 'Review Prompt',
    description: 'Customize the prompt used when reviewing tasks.',
    keywords: ['review', 'prompt', 'template', 'instructions'],
  },
  {
    id: 'clis-models:cli-agents',
    tab: 'clis-models',
    anchor: 'cli-agents',
    category: 'Agents',
    title: 'CLI agents',
    description: 'Detect and install coding CLI agents.',
    keywords: ['cli', 'agents', 'install', 'detect', 'available'],
  },
  {
    id: 'integrations:integrations',
    tab: 'integrations',
    anchor: 'integrations',
    category: 'Integrations',
    title: 'Integrations',
    description: 'Connect external services like GitHub, GitLab, Linear, Jira, and Plain.',
    keywords: [
      'integrations',
      'github',
      'gitlab',
      'linear',
      'jira',
      'plain',
      'forgejo',
      'connect',
      'oauth',
    ],
  },
  {
    id: 'repository:branch-prefix',
    tab: 'repository',
    anchor: 'branch-prefix',
    category: 'Repository',
    title: 'Branch prefix',
    description: 'Configure the branch prefix used when creating worktrees.',
    keywords: [
      'branch',
      'prefix',
      'git',
      'naming',
      'worktree',
      'push',
      'gitignore',
      'agent config',
    ],
  },
  {
    id: 'interface:theme',
    tab: 'interface',
    anchor: 'theme',
    category: 'Interface',
    title: 'Color mode',
    description: 'Choose how Emdash looks.',
    keywords: ['theme', 'color', 'dark', 'light', 'appearance', 'system'],
  },
  {
    id: 'interface:terminal',
    tab: 'interface',
    anchor: 'terminal',
    category: 'Interface',
    title: 'Terminal',
    description: 'Configure terminal font and selection behavior.',
    keywords: ['terminal', 'font', 'monospace', 'copy', 'selection', 'pty'],
  },
  {
    id: 'interface:keyboard',
    tab: 'interface',
    anchor: 'keyboard-shortcuts',
    category: 'Interface',
    title: 'Keyboard shortcuts',
    description: 'Customize keyboard shortcuts.',
    keywords: ['keyboard', 'shortcut', 'shortcuts', 'hotkey', 'hotkeys', 'binding', 'keybinding'],
  },
  {
    id: 'interface:tools',
    tab: 'interface',
    anchor: 'tools',
    category: 'Interface',
    title: 'Tools',
    description: 'Show or hide editors and IDEs in the open-in menu.',
    keywords: ['tools', 'open in', 'editor', 'ide', 'vscode', 'cursor', 'finder', 'iterm'],
  },
];

function buildAgentEntries(): SettingsSearchEntry[] {
  return AGENT_PROVIDERS.map((provider) => ({
    id: `clis-models:agent:${provider.id}`,
    tab: 'clis-models' as const,
    anchor: 'cli-agents',
    category: 'Agents',
    title: provider.name,
    description: provider.description,
    keywords: [
      provider.id,
      provider.name,
      ...(provider.commands ?? []),
      provider.cli ?? '',
      'agent',
      'cli',
    ].filter(Boolean),
  }));
}

function buildOpenInToolEntries(): SettingsSearchEntry[] {
  return Object.values(OPEN_IN_APPS).map((app) => ({
    id: `interface:tool:${app.id}`,
    tab: 'interface' as const,
    anchor: 'tools',
    category: 'Interface',
    title: app.label,
    description: 'Show or hide in the open-in menu.',
    keywords: [app.id, app.label, 'open in', 'editor', 'ide', 'tool'],
  }));
}

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  ...STATIC_ENTRIES,
  ...buildAgentEntries(),
  ...buildOpenInToolEntries(),
];

export function filterByQuery<T>(
  items: T[],
  query: string,
  getFields: (item: T) => Array<string | undefined>
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => getFields(item).some((field) => field?.toLowerCase().includes(q)));
}

export function searchSettings(
  entries: SettingsSearchEntry[],
  query: string
): SettingsSearchEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const tokens = trimmed.split(/\s+/).filter(Boolean);

  const matches = (entry: SettingsSearchEntry): boolean => {
    const haystack = [
      entry.title,
      entry.description ?? '',
      entry.category ?? '',
      ...(entry.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  };

  const score = (entry: SettingsSearchEntry): number => {
    const title = entry.title.toLowerCase();
    if (title === trimmed) return 0;
    if (title.startsWith(trimmed)) return 1;
    if (title.includes(trimmed)) return 2;
    return 3;
  };

  return entries.filter(matches).sort((a, b) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title);
  });
}
