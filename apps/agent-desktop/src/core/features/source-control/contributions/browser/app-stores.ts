import { projectManagerStoreToken } from '@core/features/projects/contributions/app-store-tokens';
import { PullRequestRefreshController } from '@core/features/source-control/browser/stores/pull-request-refresh-controller';
import {
  contributeScopedStore,
  scopedStoreToken,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

const pullRequestRefreshControllerToken = scopedStoreToken<PullRequestRefreshController>(
  'source-control.pull-request-refresh'
);

export const sourceControlAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: pullRequestRefreshControllerToken,
    create: (_context, stores) =>
      new PullRequestRefreshController(stores.get(projectManagerStoreToken)),
    activate: (controller) => controller.activate(),
    dispose: (controller) => controller.dispose(),
  }),
];
