import { conversationManagerStoreToken } from '@core/features/conversations/contributions/browser/task-stores';
import { gitRepositoryStoreToken } from '@core/features/source-control/contributions/browser/project-stores';
import type { TaskScopedStoreContext } from '@core/features/tasks/contributions/browser/task-stores';
import { terminalManagerStoreToken } from '@core/features/terminals/contributions/browser/task-stores';
import { TaskComposition } from '@core/features/workbench/api/browser/task-composition';
import { taskCompositionStoreToken } from '@core/features/workbench/contributions/browser/task-store-tokens';
import {
  contributeScopedStore,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

export const workbenchTaskStoreContributions: readonly ScopedStoreContribution<TaskScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: taskCompositionStoreToken,
      create: ({ projectId, taskId, task, projectStores }, stores) =>
        new TaskComposition(
          projectId,
          taskId,
          task,
          stores.get(terminalManagerStoreToken),
          stores.get(conversationManagerStoreToken),
          projectStores.get(gitRepositoryStoreToken)
        ),
      ready: (composition) => composition.space.ready,
      activate: (composition) => composition.activate(),
      dispose: (composition) => composition.dispose(),
    }),
  ];
