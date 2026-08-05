import {
  hostRefKey,
  isLocalHostRef,
  type HostRef,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  isAnnotatedWorkspace,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import type { AppDb } from '@core/services/app-db/node/db';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { projects, tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';

export interface WorkspaceRegistryBackfillServiceOptions {
  db: AppDb;
  runtimes: RuntimeBroker;
  onError?: (context: string, error: unknown) => void;
}

type BackfillFlags = Record<SerializedHostRef, number>;

/**
 * Upgrade backfill: workspaces registered before the host registry existed live only as
 * desktop mirror rows, so each annotated row replays as an idempotent `createWorkspace`
 * carrying its existing UUID — preserving what `tasks.workspaceId` and
 * `projects.repositoryWorkspaceId` point at. One sweep per host behind a completed flag.
 *
 * Repositories go before worktrees: registering a worktree whose repository is unknown
 * makes the host auto-register that repository under a fresh id, which would orphan the
 * project link the sweep exists to preserve.
 *
 * Adopted-never-annotated rows are skipped — host auto-adoption rediscovers them under
 * fresh ids and the sync sweep replaces their pure-mirror rows. Vanished paths error
 * per-row and stay mirror-side as missing; the sweep itself never fails on them.
 *
 * Ordering: run before the sync service attaches the host, so the first missing-sweep
 * already sees the backfilled records instead of transiently marking legacy rows missing.
 */
export class WorkspaceRegistryBackfillService {
  private readonly flags: AppDbKeyValueStore<BackfillFlags>;

  constructor(private readonly options: WorkspaceRegistryBackfillServiceOptions) {
    this.flags = new AppDbKeyValueStore<BackfillFlags>(options.db, 'workspace-registry-backfill');
  }

  /** Never throws: failures leave the flag unset so the next boot/connect resumes. */
  async backfillHost(host: HostRef): Promise<void> {
    try {
      await this.run(host);
    } catch (error) {
      this.options.onError?.(`workspace registry backfill (${hostRefKey(host)})`, error);
    }
  }

  private async run(host: HostRef): Promise<void> {
    const flagKey = hostRefKey(host);
    if ((await this.flags.get(flagKey)) !== null) return;

    const client = await this.options.runtimes.client(host);
    if (!client.success) return;
    const registry = client.data.workspaceRegistry;

    for (const row of this.loadBackfillRows(host)) {
      if (row.path === null) continue; // No path, nothing to register; stays a stale row.
      const created = await registry.createWorkspace({ id: row.id, path: row.path });
      if (!created.success) {
        // Vanished path or a host record already owning the path/id: the row stays
        // mirror-side (missing or replaced by the sync sweep); never fought.
        this.options.onError?.(
          `workspace registry backfill create (${row.id})`,
          new Error(JSON.stringify(created.error))
        );
      }
    }

    // Only a fully-walked sweep sets the flag; a transport throw above resumes later.
    await this.flags.setOrThrow(flagKey, Date.now());
  }

  /** Live, host-scoped, annotated-only, repositories before worktrees. */
  private loadBackfillRows(host: HostRef): WorkspaceRow[] {
    const local = isLocalHostRef(host);
    const rows = this.options.db
      .select()
      .from(workspaces)
      .where(
        and(
          liveWorkspaces(),
          eq(workspaces.location, local ? 'local' : 'remote'),
          local ? isNull(workspaces.sshConnectionId) : eq(workspaces.sshConnectionId, host.id)
        )
      )
      .all();
    const annotations = this.loadAnnotations(rows.map((row) => row.id));
    const annotated = rows.filter((row) =>
      isAnnotatedWorkspace({
        config: row.config,
        hasTaskLink: annotations.taskWorkspaceIds.has(row.id),
        isProjectRepository: annotations.projectRepositoryWorkspaceIds.has(row.id),
      })
    );
    return [
      ...annotated.filter((row) => row.kind !== 'worktree'),
      ...annotated.filter((row) => row.kind === 'worktree'),
    ];
  }

  private loadAnnotations(workspaceIds: string[]) {
    if (workspaceIds.length === 0) {
      return {
        taskWorkspaceIds: new Set<string>(),
        projectRepositoryWorkspaceIds: new Set<string>(),
      };
    }
    const taskRows = this.options.db
      .select({ workspaceId: tasks.workspaceId })
      .from(tasks)
      .where(inArray(tasks.workspaceId, workspaceIds))
      .all();
    const projectRows = this.options.db
      .select({ workspaceId: projects.repositoryWorkspaceId })
      .from(projects)
      .where(inArray(projects.repositoryWorkspaceId, workspaceIds))
      .all();
    return {
      taskWorkspaceIds: new Set(
        taskRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))
      ),
      projectRepositoryWorkspaceIds: new Set(
        projectRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))
      ),
    };
  }
}
