import { projectManagerStoreToken } from '@core/features/projects/contributions/app-store-tokens';
import { TaskActivationCoordinator } from '@core/features/tasks/browser/stores/task-activation-coordinator';
import { navigationStoreToken } from '@core/primitives/navigation/browser/app-stores';
import {
  contributeScopedStore,
  getAppStores,
  scopedStoreToken,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

const taskActivationCoordinatorToken = scopedStoreToken<TaskActivationCoordinator>(
  'tasks.activation-coordinator'
);

export const taskAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: taskActivationCoordinatorToken,
    create: (_context, stores) =>
      new TaskActivationCoordinator(
        stores.get(navigationStoreToken),
        stores.get(projectManagerStoreToken)
      ),
    activate: (coordinator) => coordinator.start(),
    dispose: (coordinator) => coordinator.dispose(),
  }),
];

export function getTaskActivationCoordinator(): TaskActivationCoordinator {
  return getAppStores().get(taskActivationCoordinatorToken);
}
