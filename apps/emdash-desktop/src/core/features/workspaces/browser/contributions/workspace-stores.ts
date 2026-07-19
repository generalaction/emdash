import type { GitRepositoryStore } from '@core/features/source-control/browser/stores/git-repository-store';
import {
  contributeScopedStore,
  scopedStoreToken,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { LifecycleScriptsStore } from '../lifecycle-scripts';

export type WorkspaceScopedStoreContext = Readonly<{
  projectId: string;
  workspaceId: string;
  path: string;
  gitRepository: GitRepositoryStore;
  sshConnectionId?: string;
}>;

export const lifecycleScriptsStoreToken = scopedStoreToken<LifecycleScriptsStore>(
  'workspaces.lifecycle-scripts'
);

export const workspacesScopedStoreContributions: readonly ScopedStoreContribution<WorkspaceScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: lifecycleScriptsStoreToken,
      create: ({ projectId, workspaceId, path, sshConnectionId }) =>
        new LifecycleScriptsStore(projectId, workspaceId, sshConnectionId ? undefined : path),
      dispose: (store) => store.dispose(),
    }),
  ];
