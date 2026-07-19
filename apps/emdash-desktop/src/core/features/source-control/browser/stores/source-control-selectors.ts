import {
  asMounted,
  getProjectStore,
} from '@core/features/projects/browser/stores/project-selectors';
import { gitRepositoryStoreToken } from '@core/features/source-control/browser/contributions/project-stores';
import {
  diffTabManagerStoreToken,
  gitCheckoutStoreToken,
} from '@core/features/source-control/browser/contributions/workspace-store-tokens';
import { workspaceRegistry } from '@core/features/workspaces/browser/stores/workspace-registry';
import type { DiffTabManager } from '../diff-view/stores/diff-tab-manager';
import type { GitCheckoutStore } from './git-checkout-store';
import type { GitRepositoryStore } from './git-repository-store';

/** Call only inside `observer` components (or other MobX reactions). */
export function getGitRepositoryStore(projectId: string): GitRepositoryStore | undefined {
  return asMounted(getProjectStore(projectId))?.get(gitRepositoryStoreToken);
}

/** Call only inside `observer` components (or other MobX reactions). */
export function getGitCheckoutStore(workspaceId: string): GitCheckoutStore | undefined {
  return workspaceRegistry.get(workspaceId)?.get(gitCheckoutStoreToken);
}

export function getDiffTabManagerStore(workspaceId: string): DiffTabManager | undefined {
  return workspaceRegistry.get(workspaceId)?.get(diffTabManagerStoreToken);
}
