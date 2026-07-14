import type { AgentInstallationStatus } from '@shared/core/agents/agent-payload';
import { defineEvent } from '@shared/lib/ipc/events';
import type { ShortcutSettingsKey, TabNavigationDirection } from '@shared/shortcuts';

// App editing actions (renderer → main, no payload)
export const appUndoChannel = defineEvent<void>('app:undo');
export const appRedoChannel = defineEvent<void>('app:redo');
export const appPasteChannel = defineEvent<void>('app:paste');

export type TerminalContextMenuAction = 'paste' | 'select-all' | 'clear';

export const terminalContextMenuActionChannel = defineEvent<{
  requestId: string;
  action: TerminalContextMenuAction;
}>('terminal-context-menu:action');

// Menu events (main → renderer, no payload)
export const menuOpenSettingsChannel = defineEvent<void>('menu:open-settings');
export const menuCheckForUpdatesChannel = defineEvent<void>('menu:check-for-updates');
export const menuUndoChannel = defineEvent<void>('menu:undo');
export const menuRedoChannel = defineEvent<void>('menu:redo');
export const menuCloseTabChannel = defineEvent<void>('menu:close-tab');
export const menuQuitRequestedChannel = defineEvent<void>('menu:quit-requested');
export const menuGiveFeedbackChannel = defineEvent<void>('menu:give-feedback');

/** Emitted by main process when the window maximize state changes (Linux custom controls). */
export const windowMaximizeChangedChannel = defineEvent<{ maximized: boolean }>(
  'window:maximize-changed'
);

export const externalLinkOpenRequestedChannel = defineEvent<{ url: string }>(
  'external-link:open-requested'
);

export const tabNavigationShortcutChannel = defineEvent<{
  source: { kind: 'browser'; browserId: string };
  direction: TabNavigationDirection;
}>('tab-navigation:shortcut');

export const browserAppShortcutChannel = defineEvent<{
  source: { kind: 'browser'; browserId: string };
  shortcutKey: ShortcutSettingsKey;
}>('browser:app-shortcut');

export const notificationFocusTaskChannel = defineEvent<{
  projectId: string;
  taskId: string;
  conversationId?: string;
}>('notification:focus-task');

export type PlanEvent = {
  type: 'write_blocked' | 'remove_blocked';
  root: string;
  path: string;
  code?: string;
  message?: string;
};

export const planEventChannel = defineEvent<PlanEvent>('plan:event');

/** Emitted when an agent installation status changes (probe, install, update, or selection change). */
export const agentInstallationStatusUpdatedChannel = defineEvent<AgentInstallationStatus>(
  'agent:installation-status-updated'
);
