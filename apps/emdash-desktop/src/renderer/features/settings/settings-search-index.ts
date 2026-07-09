import type { SettingsPageTab } from './components/SettingsPage';

export type SettingsSearchPlatform = 'darwin' | 'linux' | 'win32';

export type SettingsSearchItem = {
  id: string;
  tab: SettingsPageTab;
  section: string;
  title: string;
  description?: string;
  keywords?: string[];
  platforms?: SettingsSearchPlatform[];
};

export type SettingsSearchResult = SettingsSearchItem & {
  score: number;
};

export type SettingsSearchResultGroup = {
  section: string;
  tab: SettingsPageTab;
  results: SettingsSearchResult[];
};

export const SETTINGS_SEARCH_ITEMS = [
  {
    id: 'general-app-version',
    tab: 'general',
    section: 'General',
    title: 'App version',
    description: 'Check for updates and view the installed Emdash version.',
    keywords: ['update', 'updates', 'release'],
  },
  {
    id: 'privacy-telemetry',
    tab: 'general',
    section: 'General',
    title: 'Privacy & Telemetry',
    description: 'Enable or disable anonymous product telemetry.',
    keywords: ['analytics', 'tracking', 'posthog'],
  },
  {
    id: 'auto-generate-task-names',
    tab: 'general',
    section: 'Tasks',
    title: 'Auto-generate task names',
    description: 'Automatically suggests a task name when creating a new task.',
    keywords: ['task title', 'name'],
  },
  {
    id: 'auto-approve-by-default',
    tab: 'general',
    section: 'Tasks',
    title: 'Auto-approve by default',
    description: 'Skip permission prompts for supported agents.',
    keywords: ['permissions', 'prompts', 'agent'],
  },
  {
    id: 'auto-trust-worktrees',
    tab: 'general',
    section: 'Tasks',
    title: 'Auto-trust worktree directories',
    description: 'Skip folder trust prompts in supported CLIs for new tasks.',
    keywords: ['claude', 'copilot', 'trust', 'worktree'],
  },
  {
    id: 'create-branch-and-worktree',
    tab: 'general',
    section: 'Tasks',
    title: 'Create branch and worktree by default',
    description: 'Start new From Branch tasks in a dedicated branch and worktree.',
    keywords: ['git', 'branch', 'workspace'],
  },
  {
    id: 'preserve-task-name-capitalization',
    tab: 'general',
    section: 'Tasks',
    title: 'Preserve task name capitalization',
    description: 'Keep uppercase letters in generated and manually entered task names.',
    keywords: ['case', 'task title'],
  },
  {
    id: 'include-issue-context-by-default',
    tab: 'general',
    section: 'Tasks',
    title: 'Include issue context by default',
    description: 'Add the selected issue to the initial agent prompt.',
    keywords: ['github', 'linear', 'jira', 'prompt'],
  },
  {
    id: 'enable-tmux',
    tab: 'general',
    section: 'Tasks',
    title: 'Enable tmux',
    description: 'Run agent sessions and terminals in tmux sessions by default.',
    keywords: ['terminal', 'sessions'],
  },
  {
    id: 'notifications',
    tab: 'general',
    section: 'Notifications',
    title: 'Notifications',
    description: 'Get notified when agents need your attention.',
    keywords: ['alerts', 'system banners'],
  },
  {
    id: 'notification-sound',
    tab: 'general',
    section: 'Notifications',
    title: 'Sound',
    description: 'Play audio cues for agent events.',
    keywords: ['audio', 'cue'],
  },
  {
    id: 'notification-custom-sound',
    tab: 'general',
    section: 'Notifications',
    title: 'Custom sound',
    description: 'Use an audio file instead of the built-in cue.',
    keywords: ['audio file', 'wav', 'mp3'],
  },
  {
    id: 'notification-sound-timing',
    tab: 'general',
    section: 'Notifications',
    title: 'Sound timing',
    description: 'When to play sounds.',
    keywords: ['audio', 'cue'],
  },
  {
    id: 'os-notifications',
    tab: 'general',
    section: 'Notifications',
    title: 'OS notifications',
    description: 'Show system banners when agents need attention or finish.',
    keywords: ['system', 'banners', 'alerts'],
  },
  {
    id: 'account',
    tab: 'account',
    section: 'Account',
    title: 'Account',
    description: 'Manage your Emdash account.',
    keywords: ['login', 'profile'],
  },
  {
    id: 'agents',
    tab: 'clis-models',
    section: 'Agents',
    title: 'Agents',
    description: 'Manage CLI agents and model configurations.',
    keywords: ['models', 'claude', 'codex', 'copilot', 'cli'],
  },
  {
    id: 'integrations',
    tab: 'integrations',
    section: 'Integrations',
    title: 'Integrations',
    description: 'Connect external services and tools.',
    keywords: ['github', 'gitlab', 'linear', 'jira', 'issues'],
  },
  {
    id: 'ssh-connections',
    tab: 'connections',
    section: 'Connections',
    title: 'SSH connections',
    description: 'Reusable remote hosts for SSH projects.',
    keywords: ['remote', 'server', 'host'],
  },
  {
    id: 'branch-prefix',
    tab: 'repository',
    section: 'Repository',
    title: 'Branch prefix',
    description: 'Prefix new task branch names.',
    keywords: ['git', 'branch'],
  },
  {
    id: 'random-branch-suffix',
    tab: 'repository',
    section: 'Repository',
    title: 'Random branch suffix',
    description: 'Add a random suffix to branch names.',
    keywords: ['git', 'branch'],
  },
  {
    id: 'auto-push-on-create',
    tab: 'repository',
    section: 'Repository',
    title: 'Auto-push on create',
    description: 'Push the new branch and set upstream after creation.',
    keywords: ['git', 'remote', 'upstream'],
  },
  {
    id: 'auto-update-gitignore',
    tab: 'repository',
    section: 'Repository',
    title: 'Auto-update .gitignore',
    description: 'Add CLI hook config paths to .gitignore.',
    keywords: ['git', 'ignore', 'hooks'],
  },
  {
    id: 'color-mode',
    tab: 'interface',
    section: 'Appearance',
    title: 'Color mode',
    description: 'Choose how Emdash looks.',
    keywords: ['theme', 'dark', 'light', 'system'],
  },
  {
    id: 'default-terminal-shell',
    tab: 'interface',
    section: 'Terminal',
    title: 'Default terminal shell',
    description: 'Used for new local terminals.',
    keywords: ['shell', 'bash', 'zsh', 'powershell'],
  },
  {
    id: 'terminal-font',
    tab: 'interface',
    section: 'Terminal',
    title: 'Terminal font',
    description: 'Choose the font family for the terminal.',
    keywords: ['typeface', 'monospace'],
  },
  {
    id: 'terminal-font-size',
    tab: 'interface',
    section: 'Terminal',
    title: 'Terminal font size',
    description: 'Adjust the font size used by terminal sessions and CLI agents.',
    keywords: ['text size', 'cli'],
  },
  {
    id: 'auto-copy-selected-text',
    tab: 'interface',
    section: 'Terminal',
    title: 'Auto-copy selected text',
    description: 'Automatically copy text selected in the terminal.',
    keywords: ['clipboard', 'selection'],
  },
  {
    id: 'use-option-as-meta-key',
    tab: 'interface',
    section: 'Terminal',
    title: 'Use Option as Meta key',
    description: 'Treat the Option key as the Meta key in the terminal.',
    keywords: ['keyboard', 'mac', 'terminal'],
    platforms: ['darwin'],
  },
  {
    id: 'left-sidebar-line-changes',
    tab: 'interface',
    section: 'Sidebar',
    title: 'Left sidebar line changes',
    description: 'Show added and removed line counts for tasks.',
    keywords: ['diff', 'changes'],
  },
  {
    id: 'left-sidebar-pr-status',
    tab: 'interface',
    section: 'Sidebar',
    title: 'Left sidebar PR status',
    description: 'Show GitHub PR merge and status icons for tasks.',
    keywords: ['pull request', 'github'],
  },
  {
    id: 'left-sidebar-timestamps',
    tab: 'interface',
    section: 'Sidebar',
    title: 'Left sidebar timestamps',
    description: 'Show the relative task timestamp in the left sidebar.',
    keywords: ['time', 'date'],
  },
  {
    id: 'resource-monitor',
    tab: 'interface',
    section: 'Interface',
    title: 'Resource monitor',
    description: 'Track CPU and memory usage for running agents.',
    keywords: ['cpu', 'memory', 'performance'],
  },
  {
    id: 'context-bar',
    tab: 'interface',
    section: 'Interface',
    title: 'Context bar',
    description: 'Hide the on-screen context trigger.',
    keywords: ['trigger', 'shortcut'],
  },
  {
    id: 'keyboard-shortcuts',
    tab: 'interface',
    section: 'Keyboard shortcuts',
    title: 'Keyboard shortcuts',
    description: 'Customize app shortcuts.',
    keywords: ['hotkeys', 'keybindings'],
  },
  {
    id: 'tools-visibility',
    tab: 'interface',
    section: 'Tools',
    title: 'Tools',
    description: 'Show or hide tools in the open menu.',
    keywords: ['visibility', 'open menu'],
  },
  {
    id: 'default-browser-profile',
    tab: 'browser',
    section: 'Browser',
    title: 'Default browser profile',
    description: 'New browser tabs open with this profile.',
    keywords: ['web', 'profile'],
  },
  {
    id: 'disable-cors-localhost',
    tab: 'browser',
    section: 'Browser',
    title: 'Disable CORS for localhost',
    description: 'Allows localhost pages to call APIs without matching CORS headers.',
    keywords: ['web', 'cors', 'localhost'],
  },
  {
    id: 'browser-profiles',
    tab: 'browser',
    section: 'Browser',
    title: 'Browser profiles',
    description: 'Create, rename, clear, and delete browser profiles.',
    keywords: ['web', 'cookies', 'logins'],
  },
] satisfies SettingsSearchItem[];

export function normalizeSettingsSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function scoreItem(item: SettingsSearchItem, query: string): number {
  const title = normalizeSettingsSearchText(item.title);
  const description = normalizeSettingsSearchText(item.description ?? '');
  const section = normalizeSettingsSearchText(item.section);
  const keywords = normalizeSettingsSearchText((item.keywords ?? []).join(' '));
  const haystack = `${title} ${description} ${section} ${keywords}`.trim();

  if (!query) return 0;
  if (title === query) return 100;
  if (title.startsWith(query)) return 90;
  if (title.includes(query)) return 80;
  if (section.includes(query)) return 65;
  if (keywords.includes(query)) return 55;
  if (description.includes(query)) return 45;

  const terms = query.split(' ');
  if (terms.every((term) => haystack.includes(term))) return 30;
  return 0;
}

export function searchSettings(
  query: string,
  {
    platform,
    items = SETTINGS_SEARCH_ITEMS,
  }: {
    platform?: SettingsSearchPlatform;
    items?: readonly SettingsSearchItem[];
  } = {}
): SettingsSearchResult[] {
  const normalizedQuery = normalizeSettingsSearchText(query);
  if (!normalizedQuery) return [];

  return items
    .filter((item) => !item.platforms || !platform || item.platforms.includes(platform))
    .map((item) => ({ ...item, score: scoreItem(item, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.section.localeCompare(b.section) || a.title.localeCompare(b.title)
    );
}

export function groupSettingsSearchResults(
  results: readonly SettingsSearchResult[]
): SettingsSearchResultGroup[] {
  const groups = new Map<string, SettingsSearchResultGroup>();

  for (const result of results) {
    const key = `${result.tab}:${result.section}`;
    const group = groups.get(key);
    if (group) {
      group.results.push(result);
    } else {
      groups.set(key, { tab: result.tab, section: result.section, results: [result] });
    }
  }

  return [...groups.values()];
}
