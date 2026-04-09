import type { Workspace } from './workspace';

type WorkspaceEntry = {
  workspace: Workspace;
  refCount: number;
};

export class WorkspaceRegistry {
  private entries = new Map<string, WorkspaceEntry>();
  private acquiring = new Map<string, Promise<Workspace>>();

  async acquire(key: string, factory: () => Promise<Workspace>): Promise<Workspace> {
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
      .then((workspace) => {
        this.entries.set(key, { workspace, refCount: 1 });
        return workspace;
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
    await Promise.all(entries.map((entry) => entry.workspace.lifecycleService.dispose()));
  }
}
