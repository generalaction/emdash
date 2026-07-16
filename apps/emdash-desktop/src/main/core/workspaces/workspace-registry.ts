import { once } from '@emdash/shared';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { log } from '@main/lib/logger';
import type { Workspace } from './workspace';

export type TeardownMode = 'detach' | 'terminate';
export type WorkspaceTeardownMode = TeardownMode | 'archive' | 'terminate-provider';

type WorkspaceHooks = {
  onCreate?: (workspace: Workspace) => Promise<void>;
  onCreateSideEffect?: (workspace: Workspace) => void;
  onArchive?: (workspace: Workspace) => Promise<void>;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onProviderDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
};

export type WorkspaceAcquireResult = {
  workspace: Workspace;
  /** Transitional SSH-only capability for legacy SSH conversation adapters. */
  sshFilesRuntime?: IFilesRuntime;
};

export type WorkspaceFactoryResult = WorkspaceAcquireResult & WorkspaceHooks;

type WorkspaceEntry = {
  workspace: Workspace;
  sshFilesRuntime?: IFilesRuntime;
  refCount: number;
  projectId: string;
  onArchive?: (workspace: Workspace) => Promise<void>;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onProviderDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
  /** Single-flight release of the workspace's native leases. */
  release: () => Promise<void>;
};

async function releaseWorkspaceEntry(entry: WorkspaceEntry): Promise<void> {
  let releaseFailed = false;
  let releaseError: unknown;
  try {
    await entry.release();
  } catch (error) {
    releaseFailed = true;
    releaseError = error;
  }
  try {
    await entry.workspace.lifecycleService.dispose();
  } catch (error) {
    if (releaseFailed) {
      log.warn('WorkspaceRegistry: lifecycle cleanup also failed after release error', {
        workspaceId: entry.workspace.id,
        error: String(error),
      });
    } else {
      releaseFailed = true;
      releaseError = error;
    }
  }
  if (releaseFailed) throw releaseError;
}

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();
  private acquiring = new Map<string, Promise<WorkspaceAcquireResult>>();

  async acquire(
    key: string,
    projectId: string,
    factory: () => Promise<WorkspaceFactoryResult>
  ): Promise<WorkspaceAcquireResult> {
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      return { workspace: existing.workspace, sshFilesRuntime: existing.sshFilesRuntime };
    }

    const inFlight = this.acquiring.get(key);
    if (inFlight) {
      const acquired = await inFlight;
      const current = this.entries.get(key);
      if (current) current.refCount += 1;
      return acquired;
    }

    const pending = factory()
      .then(async (result) => {
        const workspace = result.workspace;
        this.entries.set(key, {
          workspace,
          sshFilesRuntime: result.sshFilesRuntime,
          refCount: 1,
          projectId,
          onArchive: result.onArchive,
          onDestroy: result.onDestroy,
          onProviderDestroy: result.onProviderDestroy,
          onDetach: result.onDetach,
          release: once(async () => {
            await workspace.dispose?.();
            if (!workspace.dispose) {
              await workspace.fileTree.dispose();
              await workspace.gitWorktree.dispose();
            }
          }),
        });
        result.onCreateSideEffect?.(workspace);
        await result.onCreate?.(workspace);
        return { workspace, sshFilesRuntime: result.sshFilesRuntime };
      })
      .finally(() => {
        this.acquiring.delete(key);
      });

    this.acquiring.set(key, pending);
    return pending;
  }

  async teardown(key: string, mode: WorkspaceTeardownMode = 'terminate'): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      const inFlight = this.acquiring.get(key);
      if (inFlight) {
        await inFlight;
        await this.teardown(key, mode);
      }
      return;
    }

    if (entry.refCount > 1) {
      entry.refCount -= 1;
      return;
    }

    this.entries.delete(key);
    let hookFailed = false;
    let hookError: unknown;
    let releaseFailed = false;
    let releaseError: unknown;
    try {
      if (mode === 'archive') {
        await entry.onArchive?.(entry.workspace);
      } else if (mode === 'terminate-provider') {
        await entry.onProviderDestroy?.(entry.workspace);
      } else if (mode === 'terminate') {
        await entry.onDestroy?.(entry.workspace);
      }
    } catch (error) {
      hookFailed = true;
      hookError = error;
    } finally {
      try {
        await releaseWorkspaceEntry(entry);
      } catch (error) {
        releaseFailed = true;
        releaseError = error;
      }
    }

    if (hookFailed) {
      if (releaseFailed) {
        log.warn('WorkspaceRegistry: workspace cleanup also failed after teardown hook error', {
          workspaceId: entry.workspace.id,
          error: String(releaseError),
        });
      }
      throw hookError;
    }
    if (releaseFailed) throw releaseError;

    if (mode === 'detach') {
      await entry.onDetach?.(entry.workspace);
    }
  }

  get(key: string): Workspace | undefined {
    return this.entries.get(key)?.workspace;
  }

  listForProject(projectId: string): { workspaceId: string; path: string }[] {
    return Array.from(this.entries.entries())
      .filter(([, entry]) => entry.projectId === projectId)
      .map(([workspaceId, entry]) => ({ workspaceId, path: entry.workspace.path }));
  }

  refCount(key: string): number {
    return this.entries.get(key)?.refCount ?? 0;
  }

  async teardownAllForProject(projectId: string, mode: TeardownMode = 'terminate'): Promise<void> {
    const keys = Array.from(this.entries.entries())
      .filter(([, e]) => e.projectId === projectId)
      .map(([k]) => k);
    await Promise.all(keys.map((k) => this.teardown(k, mode)));
  }

  async teardownAll(mode: TeardownMode = 'terminate'): Promise<void> {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(
      entries.map(async (entry) => {
        if (mode === 'terminate') {
          await entry.onDestroy?.(entry.workspace);
        }
        await entry.release();
        await entry.workspace.lifecycleService.dispose();
        if (mode === 'detach') {
          await entry.onDetach?.(entry.workspace);
        }
      })
    );
  }

  async releaseLeasesForProject(projectId: string): Promise<void> {
    const entries = Array.from(this.entries.values()).filter(
      (entry) => entry.projectId === projectId
    );
    await Promise.all(entries.map((entry) => entry.release()));
  }
}

export const workspaceRegistry = new WorkspaceRegistry();
