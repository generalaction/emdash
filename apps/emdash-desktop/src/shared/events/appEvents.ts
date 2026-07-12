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

/** A number-family shortcut (tab/task 1-9) pressed while a browser webview has focus. */
export const numberShortcutChannel = defineEvent<{
  source: { kind: 'browser'; browserId: string };
  family: 'tab' | 'task';
  /** 0-based position (digit - 1). */
  index: number;
}>('number-shortcut:pressed');

export type NumberShortcutModifier = 'Meta' | 'Control' | 'Alt' | 'Shift';

/** Modifier state forwarded while an embedded browser webview owns keyboard focus. */
export const numberShortcutModifierChannel = defineEvent<{
  source: { kind: 'browser'; browserId: string };
  /** Null clears held state when the webview loses focus. */
  modifier: NumberShortcutModifier | null;
  held: boolean;
}>('number-shortcut:modifier');

export const browserAppShortcutChannel = defineEvent<{
  source: { kind: 'browser'; browserId: string };
  shortcutKey: ShortcutSettingsKey;
}>('browser:app-shortcut');

export const notificationFocusTaskChannel = defineEvent<{
  projectId: string;
  taskId: string;
  conversationId?: string;
}>('notification:focus-task');

export const ptyStartedChannel = defineEvent<{
  id: string;
}>('pty:started');

export type PlanEvent = {
  type: 'write_blocked' | 'remove_blocked';
  root: string;
  path: string;
  code?: string;
  message?: string;
};

export const planEventChannel = defineEvent<PlanEvent>('plan:event');

export const ptyDataChannel = defineEvent<string>('pty:data');

export const ptyExitChannel = defineEvent<{
  exitCode: number;
  signal?: number;
}>('pty:exit');

/** Emitted by main process when a PTY is definitively killed (e.g. on deleteTask/deleteConversation). */
export const ptyKilledChannel = defineEvent<{ id: string }>('pty:killed');

/** Emitted by main process when a lifecycle/dev-server shell session is created.
 *  These sessions are standalone PTYs — they are NOT backed by a DB conversation record.
 *  The renderer uses sessionId (not conversationId) to connect to the PTY terminal.
 */
export const shellSessionStartedChannel = defineEvent<{
  taskId: string;
  /** Opaque UUID identifying this PTY session — not a DB conversationId. */
  sessionId: string;
  ptyId: string;
  title: string;
}>('shell:session-started');

/** Emitted when an agent installation status changes (probe, install, update, or selection change). */
export const agentInstallationStatusUpdatedChannel = defineEvent<AgentInstallationStatus>(
  'agent:installation-status-updated'
);
