import type { WorkspaceScopedStoreContext } from '@core/features/workspaces/browser/contributions/workspace-stores';
import {
  contributeScopedStore,
  type ScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';
import { DiffTabManager } from '../diff-view/stores/diff-tab-manager';
import { GitCheckoutStore } from '../stores/git-checkout-store';
import { diffTabManagerStoreToken, gitCheckoutStoreToken } from './workspace-store-tokens';

export const sourceControlWorkspaceStoreContributions: readonly ScopedStoreContribution<WorkspaceScopedStoreContext>[] =
  [
    contributeScopedStore({
      token: gitCheckoutStoreToken,
      create: ({ projectId, workspaceId, path }) =>
        new GitCheckoutStore(projectId, workspaceId, path),
      activate: (store) => store.start(),
      dispose: (store) => store.dispose(),
    }),
    contributeScopedStore({
      token: diffTabManagerStoreToken,
      create: () => new DiffTabManager(),
      dispose: (store) => store.dispose(),
    }),
  ];
