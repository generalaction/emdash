import { conversationTaskStoreContributions } from '@core/features/conversations/browser/contributions/task-stores';
import { sourceControlTaskStoreContributions } from '@core/features/source-control/browser/contributions/task-stores';
import type { TaskScopedStoreContext } from '@core/features/tasks/browser/contributions/task-stores';
import { terminalTaskStoreContributions } from '@core/features/terminals/browser/contributions/task-stores';
import { workbenchTaskStoreContributions } from '@core/features/workbench/browser/contributions/task-stores';
import type { ScopedStoreContribution } from '@core/primitives/scoped-stores/browser';

export const taskStoreContributions: readonly ScopedStoreContribution<TaskScopedStoreContext>[] = [
  ...conversationTaskStoreContributions,
  ...sourceControlTaskStoreContributions,
  ...terminalTaskStoreContributions,
  ...workbenchTaskStoreContributions,
];
