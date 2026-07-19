import {
  projectSettingsStoreToken,
  type ProjectScopedStoreContext,
} from '@core/features/projects/contributions/project-stores';
import {
  contributeScopedStore,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { TaskManagerStore } from '../stores/task-manager';
import { taskManagerStoreToken } from './project-store-tokens';

export const taskProjectScopedStoreContributions: readonly ScopedStoreContribution<ProjectScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: taskManagerStoreToken,
      create: ({ data }, stores) =>
        new TaskManagerStore(data.id, stores.get(projectSettingsStoreToken), stores),
      dispose: (store) => store.dispose(),
    }),
  ];
