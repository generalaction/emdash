import type { WorkspaceRecord } from '@emdash/core/runtimes/workspace-registry/api';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  conversationRegistryTable as conversations,
  createConversationRegistry,
} from '@core/features/conversations/api/node/registry';
import {
  createWorkspaceRegistry,
  workspaceRegistryTable as workspaces,
  type WorkspaceHostIdentity,
} from '@core/features/workspaces/api/node/registry';
import { workspacePathIdentityKey } from '@core/features/workspaces/api/workspace-path-identity';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api/workspace-config';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import {
  automations,
  kv,
  notifications,
  projectRemotes,
  projects,
  projectSettings,
  tasks,
  terminals,
  type WorkspaceRow,
} from '@core/services/app-db/node/schema';

export type ResolvedLegacyWorkspace = { source: WorkspaceRow; record: WorkspaceRecord };

/**
 * Migration-only consolidation of identities proven equivalent by the owning Host.
 * Resolve the entire plan before entering this transaction: Claim must never run
 * while an obsolete alias still owns the canonical path. A failed write rolls back
 * bindings, recovery data, and retirements together; Host registration is replayable.
 */
export function consolidateWorkspaceBackfill(
  db: AppDb,
  host: WorkspaceHostIdentity,
  resolved: readonly ResolvedLegacyWorkspace[],
  retire: readonly WorkspaceRow[]
): void {
  const registry = createWorkspaceRegistry(db);
  const now = new Date().toISOString();
  db.transaction((tx) => {
    const groups = new Map<string, { record: WorkspaceRecord; sources: WorkspaceRow[] }>();
    const translations = new Map<string, string>();
    for (const { source, record } of resolved) {
      const current = registry.getLive(source.id, tx);
      if (
        !current ||
        current.path !== source.path ||
        current.location !== host.location ||
        current.sshConnectionId !== host.sshConnectionId ||
        current.deletionTombstone !== null
      ) {
        throw new Error(`Legacy Workspace '${source.id}' changed during backfill`);
      }
      const group = groups.get(record.id) ?? { record, sources: [] };
      if (workspacePathIdentityKey(group.record.path) !== workspacePathIdentityKey(record.path)) {
        throw new Error(`Host returned Workspace '${record.id}' at different paths`);
      }
      group.sources.push(current);
      groups.set(record.id, group);
      if (source.id !== record.id) translations.set(source.id, record.id);
    }

    // A canonical id cannot simultaneously be another group's obsolete id.
    for (const id of groups.keys()) {
      if (translations.has(id))
        throw new Error(`Host returned inconsistent Workspace identity '${id}'`);
    }

    for (const { record, sources } of groups.values()) {
      const canonical = tx.select().from(workspaces).where(eq(workspaces.id, record.id)).get();
      if (
        canonical &&
        (canonical.location !== host.location ||
          canonical.sshConnectionId !== host.sshConnectionId ||
          canonical.deletionTombstone !== null ||
          (canonical.untrackedAt === null &&
            !sources.some((source) => source.id === canonical.id) &&
            (canonical.path === null ||
              workspacePathIdentityKey(canonical.path) !== workspacePathIdentityKey(record.path))))
      ) {
        throw new Error(`Canonical Workspace '${record.id}' was not resolved on this Host`);
      }
      sources.sort(
        (left, right) =>
          Number(right.id === record.id) - Number(left.id === record.id) ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id)
      );
      if (sources.some((source) => source.id !== record.id)) {
        const ids = [...new Set([...sources.map((source) => source.id), record.id])];
        const linked = tx
          .select()
          .from(projects)
          .where(inArray(projects.repositoryWorkspaceId, ids))
          .all();
        const projectIds = linked.map((project) => project.id);
        // Keep raw JSON too: schema readers can discard unknown/legacy fields.
        const originalWorkspaces = tx.all(
          sql`SELECT * FROM ${workspaces} WHERE ${inArray(workspaces.id, ids)}`
        );
        const settings =
          projectIds.length === 0
            ? []
            : tx
                .select()
                .from(projectSettings)
                .where(inArray(projectSettings.projectId, projectIds))
                .all();
        tx.insert(kv)
          .values({
            key: `workspace-registry-backfill-recovery:${host.location}:${host.sshConnectionId ?? 'local'}:${record.id}`,
            value: JSON.stringify({
              version: 1,
              canonicalId: record.id,
              workspaces: originalWorkspaces,
              projects: linked,
              settings,
            }),
            updatedAt: Date.now(),
          })
          .onConflictDoNothing()
          .run();
      }
    }

    registry.untrack([...translations.keys(), ...retire.map((row) => row.id)], now, undefined, tx);
    for (const { record, sources } of groups.values()) {
      const canonical = tx.select().from(workspaces).where(eq(workspaces.id, record.id)).get();
      const config = canonical?.config ?? sources.find((source) => source.config !== null)?.config;
      const claimed = registry.claim(
        {
          host,
          record,
          ...(config ? { config: translateConfig(config, translations) } : {}),
        },
        tx
      );
      if (!claimed.success)
        throw new Error(`Workspace backfill claim failed: ${JSON.stringify(claimed.error)}`);
      consolidateProjects(
        db,
        tx,
        [...sources.map((source) => source.id), record.id],
        record.id,
        now
      );
    }

    for (const [sourceId, canonicalId] of translations) {
      tx.update(projects)
        .set({ repositoryWorkspaceId: canonicalId, updatedAt: now })
        .where(eq(projects.repositoryWorkspaceId, sourceId))
        .run();
      tx.update(tasks)
        .set({ workspaceId: canonicalId, updatedAt: now })
        .where(eq(tasks.workspaceId, sourceId))
        .run();
      tx.update(workspaces)
        .set({ parentId: canonicalId, updatedAt: now })
        .where(eq(workspaces.parentId, sourceId))
        .run();
    }
    if (translations.size > 0) {
      for (const row of tx.select().from(workspaces).all()) {
        if (!row.config) continue;
        const config = translateConfig(row.config, translations);
        if (config !== row.config) registry.updateConfig(row.id, config, tx);
      }
      for (const row of tx.select().from(automations).all()) {
        if (!row.taskConfig) continue;
        const workspaceConfig = translateConfig(row.taskConfig.workspaceConfig, translations);
        if (workspaceConfig !== row.taskConfig.workspaceConfig) {
          tx.update(automations)
            .set({
              taskConfig: { ...row.taskConfig, workspaceConfig },
              revision: row.revision + 1,
              updatedAt: Date.now(),
            })
            .where(eq(automations.id, row.id))
            .run();
        }
      }
    }
  });
}

function translateConfig(
  config: WorkspaceConfig,
  translations: ReadonlyMap<string, string>
): WorkspaceConfig {
  if (config.workspace.kind !== 'repository-instance') return config;
  const workspaceId = translations.get(config.workspace.workspaceId);
  return workspaceId ? { ...config, workspace: { ...config.workspace, workspaceId } } : config;
}

function consolidateProjects(
  db: AppDb,
  tx: DrizzleTx,
  workspaceIds: string[],
  canonicalId: string,
  now: string
): void {
  const linked = tx
    .select()
    .from(projects)
    .where(and(inArray(projects.repositoryWorkspaceId, workspaceIds), isNull(projects.deletedAt)))
    .all()
    .sort(
      (left, right) =>
        Number(right.repositoryWorkspaceId === canonicalId) -
          Number(left.repositoryWorkspaceId === canonicalId) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
  const [survivor, ...duplicates] = linked;
  if (!survivor || duplicates.length === 0) return;
  const duplicateIds = duplicates.map((project) => project.id);
  const settings = linked.flatMap((project) => {
    const row = tx
      .select()
      .from(projectSettings)
      .where(eq(projectSettings.projectId, project.id))
      .get();
    return row ? [row] : [];
  });
  if (settings.length > 0) {
    const first = settings[0];
    const merged = {
      baseProjectSettingsJson: mergeSettings(settings.map((row) => row.baseProjectSettingsJson)),
      shareableProjectSettingsJson: mergeSettings(
        settings.map((row) => row.shareableProjectSettingsJson)
      ),
      legacyConfigMigratedAt: first.legacyConfigMigratedAt,
      updatedAt: now,
    };
    tx.insert(projectSettings)
      .values({ ...merged, projectId: survivor.id, createdAt: first.createdAt })
      .onConflictDoUpdate({ target: projectSettings.projectId, set: merged })
      .run();
  }
  for (const project of duplicates) {
    for (const remote of tx
      .select()
      .from(projectRemotes)
      .where(eq(projectRemotes.projectId, project.id))
      .all()) {
      tx.insert(projectRemotes)
        .values({ ...remote, projectId: survivor.id })
        .onConflictDoNothing()
        .run();
    }
  }
  tx.update(tasks)
    .set({ projectId: survivor.id, updatedAt: now })
    .where(inArray(tasks.projectId, duplicateIds))
    .run();
  tx.update(terminals)
    .set({ projectId: survivor.id, updatedAt: now })
    .where(inArray(terminals.projectId, duplicateIds))
    .run();
  tx.update(automations)
    .set({
      projectId: survivor.id,
      revision: sql`${automations.revision} + 1`,
      updatedAt: Date.now(),
    })
    .where(inArray(automations.projectId, duplicateIds))
    .run();
  const conversationRegistry = createConversationRegistry(db);
  for (const row of tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.projectId, duplicateIds))
    .all()) {
    conversationRegistry.annotate(row.id, { projectId: survivor.id }, tx);
  }
  for (const row of tx.select().from(notifications).all()) {
    if (!row.payload) continue;
    const { target, source } = row.payload;
    const nextTarget =
      target.kind === 'task' && duplicateIds.includes(target.projectId)
        ? { ...target, projectId: survivor.id }
        : target;
    const nextSource =
      source.kind === 'conversation' && duplicateIds.includes(source.projectId)
        ? { ...source, projectId: survivor.id }
        : source;
    if (nextTarget !== target || nextSource !== source) {
      tx.update(notifications)
        .set({ payload: { ...row.payload, target: nextTarget, source: nextSource } })
        .where(eq(notifications.id, row.id))
        .run();
    }
  }
  // Retire before rebinding to satisfy the live-project unique index. Never call
  // project deletion: that would tear down the tasks and filesystem we are preserving.
  tx.update(projects)
    .set({ deletedAt: now, updatedAt: now })
    .where(inArray(projects.id, duplicateIds))
    .run();
  tx.update(projects)
    .set({
      baseRef:
        survivor.baseRef ?? duplicates.find((project) => project.baseRef !== null)?.baseRef ?? null,
    })
    .where(eq(projects.id, survivor.id))
    .run();
}

/** Earlier explicit values win. Only scripts are merged by verb; arrays and
 * structured choices (for example Git identity) remain whole values. */
function mergeSettings(values: string[]): string {
  const result: Record<string, unknown> = {};
  for (const value of values) {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid legacy project settings during Workspace backfill');
    }
    for (const [key, field] of Object.entries(parsed)) {
      if (!Object.hasOwn(result, key)) result[key] = field;
      else if (key === 'scripts' && isObject(result[key]) && isObject(field)) {
        result[key] = { ...field, ...result[key] };
      }
    }
  }
  return JSON.stringify(result);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
