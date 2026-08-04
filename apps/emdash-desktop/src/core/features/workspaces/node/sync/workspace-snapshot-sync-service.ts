import { parseAbsolute } from '@emdash/core/primitives/path/api';
import type { WorkspaceHostSnapshotTier } from '@emdash/core/runtimes/workspace-host/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Scope } from '@emdash/shared/concurrency';
import { and, eq, isNull } from 'drizzle-orm';
import { hostRefFromWorkspaceRow } from '@core/features/workspaces/api/node/workspace-host-ref';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, workspaces, type WorkspaceRow } from '@core/services/app-db/node/schema';
import { applyRepoSnapshot } from './apply-repo-snapshot';

type SyncTier = WorkspaceHostSnapshotTier;

export interface WorkspaceSnapshotSyncServiceOptions {
  db: AppDb;
  runtimes: RuntimeBroker;
  scope?: Scope;
  debounceMs?: number;
  onError?: (context: string, error: unknown) => void;
}

export class WorkspaceSnapshotSyncService {
  private readonly debounceMs: number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pendingTier = new Map<string, SyncTier>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly options: WorkspaceSnapshotSyncServiceOptions) {
    this.debounceMs = options.debounceMs ?? 2_000;
    options.scope?.add(() => this.dispose());
  }

  requestSync(repositoryWorkspaceId: string, tier: SyncTier): void {
    const previous = this.pendingTier.get(repositoryWorkspaceId);
    this.pendingTier.set(repositoryWorkspaceId, mergeTier(previous, tier));
    const existing = this.timers.get(repositoryWorkspaceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(repositoryWorkspaceId);
      void this.run(repositoryWorkspaceId);
    }, this.debounceMs);
    timer.unref?.();
    this.timers.set(repositoryWorkspaceId, timer);
  }

  async requestProject(projectId: string, tier: SyncTier): Promise<void> {
    const row = await this.options.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });
    if (row?.repositoryWorkspaceId) {
      this.requestSync(row.repositoryWorkspaceId, tier);
    }
  }

  /** Repo addressed by host + path, e.g. after a host operation completes. */
  async requestRepoPath(hostRefValue: string, repoPath: string, tier: SyncTier): Promise<void> {
    const rows = await this.options.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          isNull(workspaces.parentId),
          eq(workspaces.path, repoPath),
          isNull(workspaces.untrackedAt),
          hostRefValue === 'local'
            ? isNull(workspaces.sshConnectionId)
            : eq(workspaces.sshConnectionId, hostRefValue)
        )
      );
    for (const row of rows) {
      this.requestSync(row.id, tier);
    }
  }

  async requestHost(connectionId: string, tier: SyncTier): Promise<void> {
    const rows = await this.options.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.location, 'remote'),
          eq(workspaces.sshConnectionId, connectionId),
          isNull(workspaces.untrackedAt)
        )
      );
    for (const row of rows) {
      this.requestSync(row.id, tier);
    }
  }

  async requestAll(tier: SyncTier): Promise<void> {
    const rows = await this.options.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(isNull(workspaces.parentId), isNull(workspaces.untrackedAt)));
    for (const row of rows) {
      this.requestSync(row.id, tier);
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pendingTier.clear();
  }

  private async run(repositoryWorkspaceId: string): Promise<void> {
    if (this.inFlight.has(repositoryWorkspaceId)) {
      this.requestSync(
        repositoryWorkspaceId,
        this.pendingTier.get(repositoryWorkspaceId) ?? 'presence'
      );
      return;
    }
    const tier = this.pendingTier.get(repositoryWorkspaceId) ?? 'presence';
    this.pendingTier.delete(repositoryWorkspaceId);
    this.inFlight.add(repositoryWorkspaceId);
    try {
      await this.syncNow(repositoryWorkspaceId, tier);
    } catch (error) {
      this.options.onError?.('workspace snapshot sync', error);
    } finally {
      this.inFlight.delete(repositoryWorkspaceId);
      const nextTier = this.pendingTier.get(repositoryWorkspaceId);
      if (nextTier) this.requestSync(repositoryWorkspaceId, nextTier);
    }
  }

  private async syncNow(repositoryWorkspaceId: string, tier: SyncTier): Promise<void> {
    const repository = await this.loadRepository(repositoryWorkspaceId);
    if (!repository?.path) return;
    const parsedPath = parseAbsolute(repository.path);
    if (!parsedPath.success) return;

    const host = hostRefFromWorkspaceRow(repository);
    const client = await this.options.runtimes.client(host);
    if (!client.success) return;
    const result = await client.data.workspaceHost.snapshotRepository({
      repoRoot: parsedPath.data,
      tier,
    });
    if (!result.success) return;

    const project = await this.options.db.query.projects.findFirst({
      where: eq(projects.repositoryWorkspaceId, repositoryWorkspaceId),
    });
    await applyRepoSnapshot({
      db: this.options.db,
      repository,
      snapshot: result.data,
      projectId: project?.id,
    });
  }

  private async loadRepository(repositoryWorkspaceId: string): Promise<WorkspaceRow | undefined> {
    return await this.options.db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, repositoryWorkspaceId), isNull(workspaces.untrackedAt)),
    });
  }
}

function mergeTier(previous: SyncTier | undefined, next: SyncTier): SyncTier {
  return previous === 'full' || next === 'full' ? 'full' : 'presence';
}
