import { defineEvent } from '@shared/ipc/events';
import type { PullRequest } from '@shared/pull-requests';
import type { Task } from '@shared/tasks';

export const taskCreatedChannel = defineEvent<{ task: Task }>('task:created');

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
