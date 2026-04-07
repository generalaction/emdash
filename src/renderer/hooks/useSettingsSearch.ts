import { useMemo, useState, useCallback, useRef, useEffect } from 'react';

export interface SearchableSetting {
  id: string;
  label: string;
  description: string;
  category: string;
  keywords: string[];
  synonyms: string[];
  tabId: string;
}

// Comprehensive settings index with semantic keywords and synonyms
export const SETTINGS_INDEX: SearchableSetting[] = [
  // General Tab
  {
    id: 'telemetry',
    label: 'Telemetry',
    description: 'Help improve Emdash by sending anonymous usage data',
    category: 'Privacy',
    keywords: ['telemetry', 'analytics', 'tracking', 'data collection', 'usage'],
    synonyms: ['statistics', 'metrics', 'monitoring', 'reporting', 'analytics'],
    tabId: 'general',
  },
  {
    id: 'auto-generate-task-names',
    label: 'Auto-generate task names',
    description: 'Automatically generate task names from context',
    category: 'Tasks',
    keywords: ['task names', 'auto generate', 'automatic naming', 'task titles'],
    synonyms: ['naming', 'titles', 'automatic names', 'generate names'],
    tabId: 'general',
  },
  {
    id: 'auto-infer-task-names',
    label: 'Auto-infer task names',
    description: 'Infer task names from the first message',
    category: 'Tasks',
    keywords: ['infer names', 'detect names', 'smart naming'],
    synonyms: ['guess names', 'auto detect', 'smart titles'],
    tabId: 'general',
  },
  {
    id: 'auto-approve-by-default',
    label: 'Auto-approve by default',
    description: 'Automatically approve tool operations without asking',
    category: 'Tasks',
    keywords: ['auto approve', 'permissions', 'tool approval', 'automatic approval'],
    synonyms: ['skip prompts', 'less strict', 'automatic permissions', 'approve automatically'],
    tabId: 'general',
  },
  {
    id: 'create-worktree-by-default',
    label: 'Create worktree by default',
    description: 'Create a git worktree for each new task',
    category: 'Tasks',
    keywords: ['worktree', 'git worktree', 'branch isolation', 'task isolation'],
    synonyms: ['git branches', 'isolated workspace', 'separate branch'],
    tabId: 'general',
  },
  {
    id: 'auto-trust-worktrees',
    label: 'Auto-trust worktrees',
    description: 'Automatically trust repositories in new worktrees',
    category: 'Tasks',
    keywords: ['trust', 'worktree trust', 'repository trust', 'git trust'],
    synonyms: ['trusted repos', 'auto trust', 'repository verification'],
    tabId: 'general',
  },
  {
    id: 'notifications-enabled',
    label: 'Enable notifications',
    description: 'Show notification messages',
    category: 'Notifications',
    keywords: ['notifications', 'alerts', 'messages', 'banner'],
    synonyms: ['popups', 'alerts', 'notify', 'warnings'],
    tabId: 'general',
  },
  {
    id: 'notification-sound',
    label: 'Notification sound',
    description: 'Play a sound when notifications appear',
    category: 'Notifications',
    keywords: ['sound', 'audio', 'notification sound', 'beep'],
    synonyms: ['chime', 'alert sound', 'ding', 'notification audio'],
    tabId: 'general',
  },
  {
    id: 'os-notifications',
    label: 'OS notifications',
    description: 'Show native operating system notifications',
    category: 'Notifications',
    keywords: ['os notifications', 'native notifications', 'system notifications'],
    synonyms: ['desktop alerts', 'native alerts', 'system alerts'],
    tabId: 'general',
  },
  {
    id: 'sound-focus-mode',
    label: 'Sound focus mode',
    description: 'When to play notification sounds',
    category: 'Notifications',
    keywords: ['focus mode', 'sound mode', 'notification timing'],
    synonyms: ['quiet mode', 'do not disturb', 'sound settings'],
    tabId: 'general',
  },
  {
    id: 'sound-profile',
    label: 'Sound profile',
    description: 'Choose the notification sound style',
    category: 'Notifications',
    keywords: ['sound profile', 'audio theme', 'notification style'],
    synonyms: ['sound theme', 'audio profile', 'notification tone'],
    tabId: 'general',
  },

  // Agents Tab
  {
    id: 'default-agent',
    label: 'Default agent',
    description: 'Choose the default AI agent for new tasks',
    category: 'Agents',
    keywords: ['default agent', 'default model', 'preferred agent', 'ai provider'],
    synonyms: ['default ai', 'main agent', 'preferred model', 'default llm'],
    tabId: 'clis-models',
  },
  {
    id: 'review-agent',
    label: 'Review agent',
    description: 'Enable code review with an AI agent',
    category: 'Agents',
    keywords: ['review', 'code review', 'review agent', 'pr review'],
    synonyms: ['code check', 'review bot', 'pr reviewer', 'code analysis'],
    tabId: 'clis-models',
  },
  {
    id: 'review-prompt',
    label: 'Review prompt',
    description: 'Custom instructions for the review agent',
    category: 'Agents',
    keywords: ['review prompt', 'custom instructions', 'review settings'],
    synonyms: ['review instructions', 'custom prompt', 'review guidelines'],
    tabId: 'clis-models',
  },
  {
    id: 'cli-agents',
    label: 'CLI agents',
    description: 'Manage installed CLI agents and their status',
    category: 'Agents',
    keywords: ['cli agents', 'command line', 'installed agents', 'agent status'],
    synonyms: ['terminal agents', 'cli tools', 'command agents'],
    tabId: 'clis-models',
  },

  // Integrations Tab
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connect external services like GitHub, Linear, Jira',
    category: 'Integrations',
    keywords: ['integrations', 'github', 'linear', 'jira', 'gitlab', 'services'],
    synonyms: ['connections', 'external services', 'third party', 'apps'],
    tabId: 'integrations',
  },
  {
    id: 'workspace-provider',
    label: 'Workspace provider',
    description: 'Configure workspace provisioning settings',
    category: 'Integrations',
    keywords: ['workspace', 'provisioning', 'cloud workspace', 'remote'],
    synonyms: ['cloud dev', 'remote workspace', 'workspace setup'],
    tabId: 'integrations',
  },

  // Repository Tab
  {
    id: 'branch-prefix',
    label: 'Branch prefix',
    description: 'Prefix for automatically generated branch names',
    category: 'Repository',
    keywords: ['branch prefix', 'branch naming', 'git branches', 'prefix'],
    synonyms: ['branch name', 'naming convention', 'git prefix'],
    tabId: 'repository',
  },
  {
    id: 'push-on-create',
    label: 'Push on create',
    description: 'Automatically push branches when creating a PR',
    category: 'Repository',
    keywords: ['push', 'auto push', 'git push', 'branch push'],
    synonyms: ['auto publish', 'automatic push', 'push branches'],
    tabId: 'repository',
  },
  {
    id: 'auto-close-issues',
    label: 'Auto-close linked issues',
    description: 'Close linked issues when PR is created',
    category: 'Repository',
    keywords: ['close issues', 'linked issues', 'auto close', 'issue tracking'],
    synonyms: ['close tickets', 'auto resolve', 'issue automation'],
    tabId: 'repository',
  },

  // Interface Tab
  {
    id: 'theme',
    label: 'Theme',
    description: 'Choose your preferred color theme',
    category: 'Appearance',
    keywords: ['theme', 'color scheme', 'dark mode', 'light mode', 'appearance'],
    synonyms: ['colors', 'visual style', 'ui theme', 'dark theme', 'light theme'],
    tabId: 'interface',
  },
  {
    id: 'terminal-font-family',
    label: 'Terminal font family',
    description: 'Custom font for the integrated terminal',
    category: 'Terminal',
    keywords: ['terminal font', 'font family', 'monospace', 'terminal style'],
    synonyms: ['console font', 'terminal typeface', 'font settings'],
    tabId: 'interface',
  },
  {
    id: 'terminal-font-size',
    label: 'Terminal font size',
    description: 'Font size for the integrated terminal',
    category: 'Terminal',
    keywords: ['font size', 'terminal size', 'text size', 'zoom'],
    synonyms: ['terminal zoom', 'text zoom', 'font scaling'],
    tabId: 'interface',
  },
  {
    id: 'auto-copy-selection',
    label: 'Auto-copy on selection',
    description: 'Automatically copy text when selected in terminal',
    category: 'Terminal',
    keywords: ['auto copy', 'copy selection', 'clipboard', 'terminal copy'],
    synonyms: ['automatic copy', 'select to copy', 'clipboard sync'],
    tabId: 'interface',
  },
  {
    id: 'mac-option-is-meta',
    label: 'Mac Option is Meta',
    description: 'Use Option key as Meta key in terminal',
    category: 'Terminal',
    keywords: ['option key', 'meta key', 'mac terminal', 'keyboard'],
    synonyms: ['alt key', 'terminal keys', 'modifier keys'],
    tabId: 'interface',
  },
  {
    id: 'keyboard-shortcuts',
    label: 'Keyboard shortcuts',
    description: 'Customize keyboard shortcuts for common actions',
    category: 'Keyboard',
    keywords: ['keyboard', 'shortcuts', 'keybindings', 'hotkeys', 'custom keys'],
    synonyms: ['key combos', 'shortcut keys', 'keyboard commands', 'accelerators'],
    tabId: 'interface',
  },
  {
    id: 'auto-right-sidebar',
    label: 'Auto right sidebar',
    description: 'Automatically show/hide right sidebar based on context',
    category: 'Workspace',
    keywords: ['sidebar', 'right panel', 'auto hide', 'auto show'],
    synonyms: ['side panel', 'right sidebar', 'panel behavior'],
    tabId: 'interface',
  },
  {
    id: 'resource-monitor',
    label: 'Resource monitor',
    description: 'Show system resource usage in the sidebar',
    category: 'Workspace',
    keywords: ['resource monitor', 'cpu', 'memory', 'system stats'],
    synonyms: ['performance', 'system monitor', 'usage stats', 'resources'],
    tabId: 'interface',
  },
  {
    id: 'browser-preview',
    label: 'Browser preview',
    description: 'Enable built-in browser preview for web projects',
    category: 'Workspace',
    keywords: ['browser', 'preview', 'web preview', 'live preview'],
    synonyms: ['web view', 'browser view', 'site preview', 'live reload'],
    tabId: 'interface',
  },
  {
    id: 'task-hover-action',
    label: 'Task hover action',
    description: 'Action to show when hovering over tasks',
    category: 'Workspace',
    keywords: ['task hover', 'hover action', 'delete', 'archive'],
    synonyms: ['hover behavior', 'task actions', 'mouse hover'],
    tabId: 'interface',
  },
  {
    id: 'hidden-tools',
    label: 'Hidden tools',
    description: 'Manage which tools are hidden from the interface',
    category: 'Tools',
    keywords: ['hidden tools', 'tool visibility', 'show tools', 'hide tools'],
    synonyms: ['tool settings', 'visible tools', 'tool preferences'],
    tabId: 'interface',
  },
];

export interface SearchResult {
  setting: SearchableSetting;
  score: number;
  matches: {
    label: boolean;
    description: boolean;
    keywords: boolean;
    synonyms: boolean;
  };
}

function calculateSimilarity(query: string, text: string): number {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // Exact match
  if (textLower === queryLower) return 1;

  // Starts with query
  if (textLower.startsWith(queryLower)) return 0.9;

  // Contains query as whole word
  if (new RegExp(`\\b${queryLower}\\b`).test(textLower)) return 0.8;

  // Contains query
  if (textLower.includes(queryLower)) return 0.6;

  // Check for word-by-word partial matches
  const queryWords = queryLower.split(/\s+/);
  const textWords = textLower.split(/\s+/);

  let matchCount = 0;
  for (const queryWord of queryWords) {
    if (queryWord.length < 2) continue;
    for (const textWord of textWords) {
      if (textWord.includes(queryWord) || queryWord.includes(textWord)) {
        matchCount++;
        break;
      }
    }
  }

  if (matchCount > 0) {
    return 0.4 * (matchCount / queryWords.length);
  }

  return 0;
}

export function searchSettings(query: string): SearchResult[] {
  if (!query.trim()) return [];

  const results: SearchResult[] = [];

  for (const setting of SETTINGS_INDEX) {
    let score = 0;
    const matches = {
      label: false,
      description: false,
      keywords: false,
      synonyms: false,
    };

    // Check label (highest weight)
    const labelScore = calculateSimilarity(query, setting.label);
    if (labelScore > 0) {
      score += labelScore * 4;
      matches.label = true;
    }

    // Check description
    const descScore = calculateSimilarity(query, setting.description);
    if (descScore > 0) {
      score += descScore * 2;
      matches.description = true;
    }

    // Check keywords
    for (const keyword of setting.keywords) {
      const keywordScore = calculateSimilarity(query, keyword);
      if (keywordScore > 0) {
        score += keywordScore * 1.5;
        matches.keywords = true;
      }
    }

    // Check synonyms (semantic matching)
    for (const synonym of setting.synonyms) {
      const synonymScore = calculateSimilarity(query, synonym);
      if (synonymScore > 0) {
        score += synonymScore * 1.2;
        matches.synonyms = true;
      }
    }

    if (score > 0.3) {
      results.push({ setting, score, matches });
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}

export function useSettingsSearch() {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return {
    query,
    setQuery,
    inputRef,
    focusSearch,
  };
}

export function groupResultsByTab(results: SearchResult[]) {
  const grouped = new Map<string, SearchResult[]>();

  for (const result of results) {
    const tabId = result.setting.tabId;
    if (!grouped.has(tabId)) {
      grouped.set(tabId, []);
    }
    grouped.get(tabId)!.push(result);
  }

  return grouped;
}

// Highlight matches - returns array of strings and indices for highlighting
export function getHighlightSegments(
  text: string,
  query: string
): Array<{ text: string; match: boolean }> {
  if (!query.trim()) return [{ text, match: false }];

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  const segments: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;

  // Find all occurrences
  let index = textLower.indexOf(queryLower);
  while (index !== -1) {
    // Add text before match
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index), match: false });
    }

    // Add highlighted match
    segments.push({ text: text.slice(index, index + query.length), match: true });

    lastIndex = index + query.length;
    index = textLower.indexOf(queryLower, lastIndex);
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), match: false });
  }

  return segments.length > 0 ? segments : [{ text, match: false }];
}
