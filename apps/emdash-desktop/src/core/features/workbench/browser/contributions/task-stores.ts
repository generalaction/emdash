import { conversationManagerStoreToken } from '@core/features/conversations/browser/contributions/task-stores';
import { gitRepositoryStoreToken } from '@core/features/source-control/browser/contributions/project-stores';
import type { TaskScopedStoreContext } from '@core/features/tasks/browser/contributions/task-stores';
import { terminalManagerStoreToken } from '@core/features/terminals/browser/contributions/task-stores';
import {
  contributeScopedStore,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { TaskComposition } from '../task-composition';
import { taskCompositionStoreToken } from './task-store-tokens';

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
