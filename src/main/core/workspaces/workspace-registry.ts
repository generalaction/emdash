import type { Workspace } from './workspace';

type WorkspaceHooks = {
  onCreate?: (workspace: Workspace) => Promise<void>;
  onCreateSideEffect?: (workspace: Workspace) => void;
  onDestroy?: (workspace: Workspace) => Promise<void>;
};

export type WorkspaceFactoryResult = { workspace: Workspace } & WorkspaceHooks;

type WorkspaceEntry = {
  workspace: Workspace;
  refCount: number;
  onDestroy?: (workspace: Workspace) => Promise<void>;
};

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();
  private acquiring = new Map<string, Promise<Workspace>>();

  async acquire(key: string, factory: () => Promise<WorkspaceFactoryResult>): Promise<Workspace> {
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      return existing.workspace;
    }

    const inFlight = this.acquiring.get(key);
    if (inFlight) {
      const workspace = await inFlight;
      const current = this.entries.get(key);
      if (current) current.refCount += 1;
      return workspace;
    }

    const pending = factory()
      .then(async (result) => {
        this.entries.set(key, {
          workspace: result.workspace,
          refCount: 1,
          onDestroy: result.onDestroy,
        });
        result.onCreateSideEffect?.(result.workspace);
        await result.onCreate?.(result.workspace);
        return result.workspace;
      })
      .finally(() => {
        this.acquiring.delete(key);
      });

    this.acquiring.set(key, pending);
    return pending;
  }

  async release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      const inFlight = this.acquiring.get(key);
      if (inFlight) {
        await inFlight;
        await this.release(key);
      }
      return;
    }

    if (entry.refCount > 1) {
      entry.refCount -= 1;
      return;
    }

    this.entries.delete(key);
    await entry.onDestroy?.(entry.workspace);
    entry.workspace.git.dispose();
    await entry.workspace.lifecycleService.dispose();
  }

  get(key: string): Workspace | undefined {
    return this.entries.get(key)?.workspace;
  }

  refCount(key: string): number {
    return this.entries.get(key)?.refCount ?? 0;
  }

  async releaseAll(): Promise<void> {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(
      entries.map(async (entry) => {
        await entry.onDestroy?.(entry.workspace);
        entry.workspace.git.dispose();
        await entry.workspace.lifecycleService.dispose();
      })
    );
  }
}
