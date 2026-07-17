import { computed, makeObservable } from 'mobx';
import type { GitRepositoryStore } from '@core/features/projects/browser/stores/git-repository-store';
import type { ConnectionState } from '@core/primitives/ssh/api';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { appState } from '@renderer/lib/stores/app-state';
import { releaseFileModelManager } from '../editor/stores/file-model-manager';
import { GitCheckoutStore } from './git-checkout-store';
import { LifecycleScriptsStore } from './lifecycle-scripts';

export class WorkspaceStore {
  readonly workspaceId: string;
  readonly path: string;
  readonly gitRepository: GitRepositoryStore;
  readonly sshConnectionId: string | undefined;
  readonly gitCheckout: GitCheckoutStore;
  readonly lifecycleScripts: LifecycleScriptsStore;

  constructor(
    private readonly projectId: string,
    workspaceId: string,
    path: string,
    gitRepository: GitRepositoryStore,
    sshConnectionId?: string
  ) {
    makeObservable(this, { connectionState: computed });
    this.workspaceId = workspaceId;
    this.path = path;
    this.sshConnectionId = sshConnectionId;
    if (!sshConnectionId) modelRegistry.bindWorkspaceRoot(projectId, workspaceId, path);
    this.gitRepository = gitRepository;
    this.gitCheckout = new GitCheckoutStore(projectId, workspaceId, path, this.gitRepository);
    this.lifecycleScripts = new LifecycleScriptsStore(
      projectId,
      workspaceId,
      sshConnectionId ? undefined : path
    );
  }

  get connectionState(): ConnectionState | null {
    if (!this.sshConnectionId) return null;
    return appState.sshConnections.stateFor(this.sshConnectionId);
  }

  reconnect(): void {
    if (this.sshConnectionId) {
      void appState.sshConnections.connect(this.sshConnectionId).catch(() => {});
    }
  }

  activate(): void {
    this.gitCheckout.start();
  }

  initialize(): void {
    this.activate();
  }

  dispose(): void {
    this.gitCheckout.dispose();
    this.lifecycleScripts.dispose();
    // Last task on this workspace has been released (ref-count hit 0 in
    // WorkspaceRegistryStore), so the per-workspace Monaco model manager and its
    // registered models can be torn down. No open editors remain at this point.
    releaseFileModelManager(this.workspaceId);
    if (!this.sshConnectionId) {
      modelRegistry.unbindWorkspaceRoot(this.projectId, this.workspaceId);
    }
  }
}
