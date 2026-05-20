import type { ShortcutSettingsKey } from '@shared/shortcuts';

export interface CommandDef {
  id: string;
  label: string;
  description?: string;
  group?: string;
  scope: 'app' | 'project' | 'task' | 'task-sub';
  shortcutKey?: ShortcutSettingsKey;
  /** Token resolved to a LucideIcon by the renderer's COMMAND_ICONS map. */
  iconKey?: string;
}

/**
 * Preserves literal tuple types for exhaustive ID unions while widening each
 * value to the full CommandDef interface.
 */
function defineCommandDefs<const T extends readonly CommandDef[]>(defs: T): T {
  return defs;
}

export const APP_COMMAND_DEFS = defineCommandDefs([
  {
    id: 'app.settings',
    label: 'Open Settings',
    description: 'Open application settings',
    scope: 'app',
    shortcutKey: 'settings',
    group: 'App',
    iconKey: 'settings',
  },
  {
    id: 'app.newProject',
    label: 'New Project',
    description: 'Add a new local or SSH project',
    scope: 'app',
    shortcutKey: 'newProject',
    group: 'App',
    iconKey: 'folder-plus',
  },
  {
    id: 'app.newTask',
    label: 'New Task',
    description: 'Create a new task in this project',
    scope: 'app',
    shortcutKey: 'newTask',
    group: 'App',
    iconKey: 'square-plus',
  },
  {
    id: 'app.giveFeedback',
    label: 'Give Feedback',
    description: 'Send feedback to the emdash team',
    scope: 'app',
    group: 'App',
    iconKey: 'message-square-share',
  },
  {
    id: 'app.toggleTheme',
    label: 'Toggle Theme',
    description: 'Switch between light and dark themes',
    scope: 'app',
    group: 'View',
    iconKey: 'palette',
  },
  {
    id: 'app.navigateBack',
    label: 'Go Back',
    description: 'Navigate to the previous location',
    scope: 'app',
    shortcutKey: 'navigateBack',
    group: 'Navigation',
    iconKey: 'arrow-left',
  },
  {
    id: 'app.navigateForward',
    label: 'Go Forward',
    description: 'Navigate to the next location',
    scope: 'app',
    shortcutKey: 'navigateForward',
    group: 'Navigation',
    iconKey: 'arrow-right',
  },
] as const);

export const TASK_COMMAND_DEFS = defineCommandDefs([
  {
    id: 'task.newConversation',
    label: 'New Conversation',
    description: 'Create a new conversation in the current task',
    scope: 'task',
    shortcutKey: 'newConversation',
    group: 'Conversations',
    iconKey: 'message-square-plus',
  },
  {
    id: 'task.sidebarChanges',
    label: 'View Changes',
    description: 'Open the Changes panel in the right sidebar',
    scope: 'task',
    shortcutKey: 'sidebarChanges',
    group: 'View',
    iconKey: 'file-diff',
  },
  {
    id: 'task.sidebarConversations',
    label: 'View Conversations',
    description: 'Open the Conversations panel in the right sidebar',
    scope: 'task',
    shortcutKey: 'sidebarConversations',
    group: 'View',
    iconKey: 'message-square',
  },
  {
    id: 'task.sidebarFiles',
    label: 'View Files',
    description: 'Open the Files panel in the right sidebar',
    scope: 'task',
    shortcutKey: 'sidebarFiles',
    group: 'View',
    iconKey: 'folder-open',
  },
  {
    id: 'task.viewTerminals',
    label: 'View Terminals',
    description: 'Open the terminal drawer',
    scope: 'task',
    group: 'View',
    iconKey: 'terminal',
  },
  {
    id: 'task.toggleTerminalDrawer',
    label: 'Toggle Terminal Drawer',
    description: 'Show or hide the terminal drawer',
    scope: 'task',
    shortcutKey: 'toggleTerminalDrawer',
    group: 'Panel',
    iconKey: 'terminal',
  },
  {
    id: 'task.toggleRightSidebar',
    label: 'Toggle Right Sidebar',
    description: 'Show or hide the right sidebar',
    scope: 'task',
    shortcutKey: 'toggleRightSidebar',
    group: 'Panel',
    iconKey: 'panel-right',
  },
  {
    id: 'task.newTerminal',
    label: 'New Terminal',
    description: 'Create a new terminal session',
    scope: 'task',
    shortcutKey: 'newTerminal',
    group: 'Terminals',
    iconKey: 'square-terminal',
  },
  {
    id: 'task.gitFetch',
    label: 'Git Fetch',
    description: 'Fetch latest changes from remote',
    scope: 'task',
    group: 'Git',
    iconKey: 'git-pull-request',
  },
  {
    id: 'task.gitPull',
    label: 'Git Pull',
    description: 'Pull latest changes from remote',
    scope: 'task',
    group: 'Git',
    iconKey: 'arrow-down-to-line',
  },
  {
    id: 'task.gitPush',
    label: 'Git Push',
    description: 'Push commits to remote',
    scope: 'task',
    group: 'Git',
    iconKey: 'arrow-up-to-line',
  },
  {
    id: 'task.pin',
    label: 'Pin Task',
    description: 'Pin this task to keep it at the top',
    scope: 'task',
    group: 'Task',
    iconKey: 'pin',
  },
  {
    id: 'task.nextTask',
    label: 'Next Task',
    description: 'Switch to the next task',
    scope: 'task',
    group: 'Navigation',
    iconKey: 'chevron-down',
  },
  {
    id: 'task.prevTask',
    label: 'Previous Task',
    description: 'Switch to the previous task',
    scope: 'task',
    group: 'Navigation',
    iconKey: 'chevron-up',
  },
] as const);

export const ALL_COMMAND_DEFS = [...APP_COMMAND_DEFS, ...TASK_COMMAND_DEFS] as const;

export type AppCommandId = (typeof APP_COMMAND_DEFS)[number]['id'];
export type TaskCommandId = (typeof TASK_COMMAND_DEFS)[number]['id'];
export type CommandId = (typeof ALL_COMMAND_DEFS)[number]['id'];
