import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import type { Task } from '@shared/core/tasks/tasks';
import { defineEvent } from '@shared/lib/ipc/events';

export const taskCreatedChannel = defineEvent<{ task: Task }>('task:created');

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

export type LifecycleScriptType = 'setup' | 'run' | 'teardown';
