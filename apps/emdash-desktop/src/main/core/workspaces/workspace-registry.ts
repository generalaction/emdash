import { once } from '@emdash/shared';
import type { Workspace } from './workspace';

export type TeardownMode = 'detach' | 'terminate';

type WorkspaceHooks = {
  onCreate?: (workspace: Workspace) => Promise<void>;
  onCreateSideEffect?: (workspace: Workspace) => void;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
};

export type WorkspaceAcquireResult = {
  workspace: Workspace;
};

export type WorkspaceFactoryResult = WorkspaceAcquireResult & WorkspaceHooks;

type WorkspaceEntry = {
  workspace: Workspace;
  refCount: number;
  projectId: string;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
  /** Single-flight release of the workspace's native leases. */
  release: () => Promise<void>;
};

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
      return { workspace: existing.workspace };
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
          refCount: 1,
          projectId,
          onDestroy: result.onDestroy,
          onDetach: result.onDetach,
          release: once(async () => {
            await workspace.dispose?.();
          }),
        });
        result.onCreateSideEffect?.(workspace);
        await result.onCreate?.(workspace);
        return { workspace };
      })
      .finally(() => {
        this.acquiring.delete(key);
      });

    this.acquiring.set(key, pending);
    return pending;
  }

  async teardown(key: string, mode: TeardownMode = 'terminate'): Promise<void> {
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
    if (mode === 'terminate') {
      await entry.onDestroy?.(entry.workspace);
    }
    await entry.release();
    await entry.workspace.lifecycleService.dispose();
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
