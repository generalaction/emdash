import type { Workspace } from './workspace';

export type TeardownMode = 'detach' | 'terminate';

type WorkspaceHooks = {
  onCreate?: (workspace: Workspace) => Promise<void>;
  onCreateSideEffect?: (workspace: Workspace) => void;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
};

export type WorkspaceFactoryResult = { workspace: Workspace } & WorkspaceHooks;

type WorkspaceEntry = {
  workspace: Workspace;
  refCount: number;
  projectId: string;
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
};

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();
  private acquiring = new Map<string, Promise<Workspace>>();

  async acquire(
    key: string,
    projectId: string,
    factory: () => Promise<WorkspaceFactoryResult>
  ): Promise<Workspace> {
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
          projectId,
          onDestroy: result.onDestroy,
          onDetach: result.onDetach,
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

  async release(key: string, mode: TeardownMode = 'terminate'): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      const inFlight = this.acquiring.get(key);
      if (inFlight) {
        await inFlight;
        await this.release(key, mode);
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
    entry.workspace.git.dispose();
    await entry.workspace.lifecycleService.dispose();
    if (mode === 'detach') {
      await entry.onDetach?.(entry.workspace);
    }
  }

  get(key: string): Workspace | undefined {
    return this.entries.get(key)?.workspace;
  }

  refCount(key: string): number {
    return this.entries.get(key)?.refCount ?? 0;
  }

  async releaseAllForProject(projectId: string, mode: TeardownMode = 'terminate'): Promise<void> {
    const keys = Array.from(this.entries.entries())
      .filter(([, e]) => e.projectId === projectId)
      .map(([k]) => k);
    await Promise.all(keys.map((k) => this.release(k, mode)));
  }

  async releaseAll(mode: TeardownMode = 'terminate'): Promise<void> {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(
      entries.map(async (entry) => {
        if (mode === 'terminate') {
          await entry.onDestroy?.(entry.workspace);
        }
        entry.workspace.git.dispose();
        await entry.workspace.lifecycleService.dispose();
        if (mode === 'detach') {
          await entry.onDetach?.(entry.workspace);
        }
      })
    );
  }
}

export const workspaceRegistry = new WorkspaceRegistry();
