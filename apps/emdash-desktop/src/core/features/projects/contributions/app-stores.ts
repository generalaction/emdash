import { ProjectManagerStore } from '@core/features/projects/api/browser/stores/project-manager';
import { projectManagerStoreToken } from '@core/features/projects/contributions/app-store-tokens';
import {
  contributeScopedStore,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

export const projectsAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: projectManagerStoreToken,
    create: () => new ProjectManagerStore(),
    dispose: (store) => store.dispose(),
  }),
];
