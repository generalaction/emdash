import { defineEvent } from '@shared/ipc/events';
import type { PullRequest } from '@shared/pull-requests';
import type { Task } from '@shared/tasks';

/**
 * Broadcast when a task row is inserted by any path (UI flow, MCP task_create,
 * future automation). Renderer subscribes to add the task without a full reload.
 */
export const taskCreatedChannel = defineEvent<Task>('task:created');

/**
 * Broadcast when task metadata changes outside the current renderer store so
 * open task lists can merge the latest record in place.
 */
export const taskUpdatedChannel = defineEvent<Task>('task:updated');

/**
 * Broadcast when a task is deleted externally so open views can remove it.
 */
export const taskDeletedChannel = defineEvent<{
  taskId: string;
  projectId: string;
}>('task:deleted');

export const taskStatusUpdatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  status: string;
}>('task:status-updated');

export const taskPrUpdatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  workspaceId: string;
  prs: PullRequest[];
}>('task:pr-updated');

export type ProvisionStep =
  | 'resolving-worktree'
  | 'initialising-workspace'
  | 'running-provision-script'
  | 'connecting'
  | 'setting-up-workspace'
  | 'starting-sessions';

export const taskProvisionProgressChannel = defineEvent<{
  taskId: string;
  projectId: string;
  step: ProvisionStep;
  message: string;
}>('task:provision-progress');
