import type { SettingsPageTab } from '@/components/SettingsPage';

export interface SearchableSetting {
  id: string;
  label: string;
  description: string;
  aliases: string[];
  tabId: SettingsPageTab;
  /** DOM element id to scroll to when this result is selected. */
  elementId: string;
}

export interface SearchResult {
  setting: SearchableSetting;
  score: number;
}

// Hand-curated index of searchable settings. Order does not matter; results
// are ranked by score. When adding a new setting, prefer adding a few
// natural-language aliases over adding more weight tiers.
export const SETTINGS_INDEX: SearchableSetting[] = [
  // General Tab
  {
    id: 'telemetry',
    label: 'Telemetry',
    description: 'Help improve Emdash by sending anonymous usage data',
    aliases: ['analytics', 'tracking', 'data collection', 'usage', 'metrics', 'monitoring'],
    tabId: 'general',
    elementId: 'telemetry-card',
  },
  {
    id: 'auto-generate-task-names',
    label: 'Auto-generate task names',
    description: 'Automatically generate task names from context',
    aliases: ['naming', 'titles', 'automatic names', 'task titles'],
    tabId: 'general',
    elementId: 'auto-generate-task-names-row',
  },
  {
    id: 'auto-infer-task-names',
    label: 'Auto-infer task names',
    description: 'Infer task names from the first message',
    aliases: ['detect names', 'smart naming', 'guess names'],
    tabId: 'general',
    elementId: 'auto-infer-task-names-row',
  },
  {
    id: 'auto-approve-by-default',
    label: 'Auto-approve by default',
    description: 'Automatically approve tool operations without asking',
    aliases: ['permissions', 'tool approval', 'skip prompts', 'approve automatically'],
    tabId: 'general',
    elementId: 'auto-approve-by-default-row',
  },
  {
    id: 'create-worktree-by-default',
    label: 'Create worktree by default',
    description: 'Create a git worktree for each new task',
    aliases: ['worktree', 'git worktree', 'branch isolation', 'isolated workspace'],
    tabId: 'general',
    elementId: 'create-worktree-by-default-row',
  },
  {
    id: 'auto-trust-worktrees',
    label: 'Auto-trust worktrees',
    description: 'Automatically trust repositories in new worktrees',
    aliases: ['trust', 'repository trust', 'trusted repos'],
    tabId: 'general',
    elementId: 'auto-trust-worktrees-row',
  },
  {
    id: 'notifications-enabled',
    label: 'Enable notifications',
    description: 'Show notification messages',
    aliases: ['alerts', 'banner', 'popups', 'notify'],
    tabId: 'general',
    elementId: 'notification-settings-card',
  },
  {
    id: 'notification-sound',
    label: 'Notification sound',
    description: 'Play a sound when notifications appear',
    aliases: ['audio', 'beep', 'chime', 'ding', 'alert sound'],
    tabId: 'general',
    elementId: 'notification-settings-card',
  },
  {
    id: 'os-notifications',
    label: 'OS notifications',
    description: 'Show native operating system notifications',
    aliases: ['native notifications', 'system notifications', 'desktop alerts'],
    tabId: 'general',
    elementId: 'notification-settings-card',
  },
  {
    id: 'sound-focus-mode',
    label: 'Sound focus mode',
    description: 'When to play notification sounds',
    aliases: ['focus mode', 'quiet mode', 'do not disturb'],
    tabId: 'general',
    elementId: 'notification-settings-card',
  },
  {
    id: 'sound-profile',
    label: 'Sound profile',
    description: 'Choose the notification sound style',
    aliases: ['audio theme', 'sound theme', 'notification tone'],
    tabId: 'general',
    elementId: 'notification-settings-card',
  },

  // Agents Tab
  {
    id: 'default-agent',
    label: 'Default agent',
    description: 'Choose the default AI agent for new tasks',
    aliases: ['default model', 'preferred agent', 'ai provider', 'default llm'],
    tabId: 'clis-models',
    elementId: 'default-agent-settings-card',
  },
  {
    id: 'review-agent',
    label: 'Review agent',
    description: 'Enable code review with an AI agent',
    aliases: ['code review', 'pr review', 'review bot', 'code analysis'],
    tabId: 'clis-models',
    elementId: 'review-agent-settings-card',
  },
  {
    id: 'review-prompt',
    label: 'Review prompt',
    description: 'Custom instructions for the review agent',
    aliases: ['custom instructions', 'review instructions', 'review guidelines'],
    tabId: 'clis-models',
    elementId: 'review-agent-settings-card',
  },
  {
    id: 'cli-agents',
    label: 'CLI agents',
    description: 'Manage installed CLI agents and their status',
    aliases: ['command line', 'installed agents', 'terminal agents', 'cli tools'],
    tabId: 'clis-models',
    elementId: 'cli-agents-section',
  },

  // Integrations Tab
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connect external services like GitHub, Linear, Jira',
    aliases: ['connections', 'external services', 'third party', 'apps'],
    tabId: 'integrations',
    elementId: 'integrations-card',
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Connect your GitHub repositories',
    aliases: ['gh', 'git', 'repository', 'pull request', 'pr', 'octocat', 'source control'],
    tabId: 'integrations',
    elementId: 'integrations-card',
  },
  {
    id: 'gitlab',
    label: 'GitLab',
    description: 'Work on GitLab issues',
    aliases: ['gl', 'git', 'repository', 'merge request', 'mr', 'source control'],
    tabId: 'integrations',
    elementId: 'integrations-card',
  },
  {
    id: 'forgejo',
    label: 'Forgejo',
    description: 'Work on Forgejo issues',
    aliases: ['gitea', 'self-hosted', 'self hosted git', 'codeberg', 'repository'],
    tabId: 'integrations',
    elementId: 'integrations-card',
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Work on Linear tickets',
    aliases: ['tickets', 'issues', 'project management', 'issue tracker'],
    tabId: 'integrations',
    elementId: 'integrations-card',
  },
  {
    id: 'jira',
    label: 'Jira',
    description: 'Work on Jira tickets',
    aliases: ['atlassian', 'tickets', 'issues', 'project management'],
    tabId: 'integrations',
    elementId: 'integrations-card',
  },
  {
    id: 'plain',
    label: 'Plain',
    description: 'Work on support threads',
    aliases: ['support', 'customer support', 'helpdesk', 'support inbox'],
    tabId: 'integrations',
    elementId: 'integrations-card',
  },
  {
    id: 'sentry',
    label: 'Sentry',
    description: 'Fix errors from Sentry',
    aliases: ['errors', 'exceptions', 'monitoring', 'error tracking', 'observability'],
    tabId: 'integrations',
    elementId: 'integrations-card',
  },
  {
    id: 'workspace-provider',
    label: 'Workspace provider',
    description: 'Configure workspace provisioning settings',
    aliases: ['provisioning', 'cloud workspace', 'remote workspace'],
    tabId: 'integrations',
    elementId: 'workspace-provider-card',
  },

  // Repository Tab
  {
    id: 'branch-prefix',
    label: 'Branch prefix',
    description: 'Prefix for automatically generated branch names',
    aliases: ['branch naming', 'git branches', 'naming convention'],
    tabId: 'repository',
    elementId: 'repository-settings-card',
  },
  {
    id: 'push-on-create',
    label: 'Push on create',
    description: 'Automatically push branches when creating a PR',
    aliases: ['auto push', 'git push', 'auto publish'],
    tabId: 'repository',
    elementId: 'repository-settings-card',
  },
  {
    id: 'auto-close-issues',
    label: 'Auto-close linked issues',
    description: 'Close linked issues when PR is created',
    aliases: ['close tickets', 'issue automation', 'auto resolve'],
    tabId: 'repository',
    elementId: 'repository-settings-card',
  },

  // Interface Tab
  {
    id: 'theme',
    label: 'Theme',
    description: 'Choose your preferred color theme',
    aliases: ['color scheme', 'dark mode', 'light mode', 'appearance', 'colors', 'ui theme'],
    tabId: 'interface',
    elementId: 'theme-card',
  },
  {
    id: 'terminal-font-family',
    label: 'Terminal font family',
    description: 'Custom font for the integrated terminal',
    aliases: ['terminal font', 'monospace', 'console font', 'typeface'],
    tabId: 'interface',
    elementId: 'terminal-settings-card',
  },
  {
    id: 'terminal-font-size',
    label: 'Terminal font size',
    description: 'Font size for the integrated terminal',
    aliases: ['text size', 'terminal zoom', 'font scaling'],
    tabId: 'interface',
    elementId: 'terminal-settings-card',
  },
  {
    id: 'auto-copy-selection',
    label: 'Auto-copy on selection',
    description: 'Automatically copy text when selected in terminal',
    aliases: ['clipboard', 'select to copy', 'terminal copy'],
    tabId: 'interface',
    elementId: 'terminal-settings-card',
  },
  {
    id: 'mac-option-is-meta',
    label: 'Mac Option is Meta',
    description: 'Use Option key as Meta key in terminal',
    aliases: ['option key', 'meta key', 'alt key', 'modifier keys'],
    tabId: 'interface',
    elementId: 'terminal-settings-card',
  },
  {
    id: 'keyboard-shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Customize keyboard shortcuts for common actions',
    aliases: ['keybindings', 'hotkeys', 'shortcut keys', 'accelerators'],
    tabId: 'interface',
    elementId: 'keyboard-settings-card',
  },
  {
    id: 'auto-right-sidebar',
    label: 'Auto right sidebar',
    description: 'Automatically show/hide right sidebar based on context',
    aliases: ['side panel', 'right panel', 'panel behavior'],
    tabId: 'interface',
    elementId: 'right-sidebar-settings-card',
  },
  {
    id: 'resource-monitor',
    label: 'Resource monitor',
    description: 'Show system resource usage in the sidebar',
    aliases: ['cpu', 'memory', 'system stats', 'performance', 'usage stats'],
    tabId: 'interface',
    elementId: 'resource-monitor-settings-card',
  },
  {
    id: 'browser-preview',
    label: 'Browser preview',
    description: 'Enable built-in browser preview for web projects',
    aliases: ['web preview', 'live preview', 'web view', 'live reload'],
    tabId: 'interface',
    elementId: 'browser-preview-settings-card',
  },
  {
    id: 'task-hover-action',
    label: 'Task hover action',
    description: 'Action to show when hovering over tasks',
    aliases: ['hover behavior', 'task actions', 'mouse hover'],
    tabId: 'interface',
    elementId: 'task-hover-action-card',
  },
  {
    id: 'hidden-tools',
    label: 'Hidden tools',
    description: 'Manage which tools are hidden from the interface',
    aliases: ['tool visibility', 'show tools', 'hide tools', 'tool preferences'],
    tabId: 'interface',
    elementId: 'hidden-tools-settings-card',
  },
];

// Score a single field. Higher is better; 0 means no match.
function scoreField(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.8;
  if (t.includes(q)) return 0.5;
  return 0;
}

export function searchSettings(query: string): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: SearchResult[] = [];

  for (const setting of SETTINGS_INDEX) {
    let score = 0;
    score += scoreField(trimmed, setting.label) * 4;
    score += scoreField(trimmed, setting.description) * 2;
    for (const alias of setting.aliases) {
      score += scoreField(trimmed, alias) * 1.5;
    }

    if (score > 0) {
      results.push({ setting, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export function groupResultsByTab(results: SearchResult[]): Map<SettingsPageTab, SearchResult[]> {
  const grouped = new Map<SettingsPageTab, SearchResult[]>();

  for (const result of results) {
    const { tabId } = result.setting;
    const bucket = grouped.get(tabId);
    if (bucket) {
      bucket.push(result);
    } else {
      grouped.set(tabId, [result]);
    }
  }

  return grouped;
}
