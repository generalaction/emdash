import { defineEvent } from '@shared/ipc/events';

// App editing actions (renderer → main, no payload)
export const appUndoChannel = defineEvent<void>('app:undo');
export const appRedoChannel = defineEvent<void>('app:redo');
export const appPasteChannel = defineEvent<void>('app:paste');

// Menu events (main → renderer, no payload)
export const menuOpenSettingsChannel = defineEvent<void>('menu:open-settings');
export const menuCheckForUpdatesChannel = defineEvent<void>('menu:check-for-updates');
export const menuUndoChannel = defineEvent<void>('menu:undo');
export const menuRedoChannel = defineEvent<void>('menu:redo');
export const menuCloseTabChannel = defineEvent<void>('menu:close-tab');

export const gitStatusChangedChannel = defineEvent<{
  taskPath: string;
  error?: string;
}>('git:status-changed');

export const notificationFocusTaskChannel = defineEvent<{
  taskId: string;
}>('notification:focus-task');

export const ptyStartedChannel = defineEvent<{
  id: string;
}>('pty:started');

export type PlanEvent = {
  type: 'write_blocked' | 'remove_blocked';
  root: string;
  relPath: string;
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

export type DependencyStatePayload = {
  id: string;
  category: 'core' | 'agent';
  status: 'available' | 'missing' | 'error';
  version: string | null;
  path: string | null;
  checkedAt: number;
  error?: string;
};

/** Emitted after each dependency probe completes (path resolution or version check). */
export const dependencyStatusUpdatedChannel = defineEvent<{
  id: string;
  state: DependencyStatePayload;
}>('dependency:status-updated');
