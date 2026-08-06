import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { automations, projects } from '@core/services/app-db/node/schema';
import { purgeAutomationRows } from '../repo';

const LIST_RUNS_LIMIT = 200;

const ACTIVE_RUN_STATUSES = [
  'scheduled',
  'queued',
  'provisioning_workspace',
  'starting_session',
] as const;

/**
 * Automation deletion as plain desktop code (operation-log retirement spec §3): host
 * cleanup first — cancel active runs, remove the deployment — then the desktop rows
 * purge in one transaction. A failure against a reachable host surfaces and leaves the
 * rows intact; an unreachable host is an accepted loss (there is no automations sweep
 * kind): the desktop rows still delete and the orphaned deployment is reaped when the
 * host-side automation next fails to resolve its definition. Nothing submits to the
 * operations kernel.
 */

export type AutomationDeletionError = { type: string; message: string };
export type AutomationDeletionResult = Result<void, AutomationDeletionError>;

export type AutomationDeletionDependencies = {
  db: AppDb;
  logger: Logger;
  resolveClient(projectId: string | null): Promise<HostRuntimesClient['automations']>;
};

export async function deleteAutomation(
  dependencies: AutomationDeletionDependencies,
  automationId: string
): Promise<AutomationDeletionResult> {
  const { db } = dependencies;
  const [automation] = await db
    .select({ id: automations.id, projectId: automations.projectId })
    .from(automations)
    .where(and(eq(automations.id, automationId), isNull(automations.deletedAt)))
    .limit(1);
  if (!automation) {
    return err({
      type: 'automation-not-found',
      message: `Automation ${automationId} was not found`,
    });
  }
  if (automation.projectId && !projectIsActive(db, automation.projectId)) {
    return err({ type: 'project-deleting', message: 'Project is being deleted.' });
  }

  let client: HostRuntimesClient['automations'] | undefined;
  try {
    client = await dependencies.resolveClient(automation.projectId);
  } catch (error) {
    // Accepted loss (spec §7.4): no sweep kind exists for automations, so an offline
    // host must not strand the desktop rows behind an unreachable deployment.
    dependencies.logger.warn('deleteAutomation: host unreachable, skipping host cleanup', {
      automationId,
      error: String(error),
    });
  }
  if (client) {
    try {
      await cancelActiveRuns(client, automationId);
      await removeDeployment(client, automationId);
    } catch (error) {
      return err({
        type: 'runtime-unavailable',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await purgeAutomationRows(db, automationId);
  return ok(undefined);
}

function projectIsActive(db: AppDb, projectId: string): boolean {
  return (
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1)
      .get() !== undefined
  );
}

async function cancelActiveRuns(
  client: HostRuntimesClient['automations'],
  automationId: string
): Promise<void> {
  for (const status of ACTIVE_RUN_STATUSES) {
    let before: number | undefined;
    while (true) {
      const result = await client.listRuns({
        automationId,
        status,
        before,
        limit: LIST_RUNS_LIMIT,
      });
      if (!result.success) throw new Error(result.error.message);
      for (const run of result.data.runs) {
        const cancelled = await client.cancelRun({ automationId, runId: run.id });
        if (!cancelled.success && cancelled.error.type !== 'run-not-found') {
          throw new Error(cancelled.error.message);
        }
      }
      if (result.data.runs.length < LIST_RUNS_LIMIT) break;
      before = Math.min(...result.data.runs.map((run) => run.seq));
    }
  }
}

async function removeDeployment(
  client: HostRuntimesClient['automations'],
  automationId: string
): Promise<void> {
  const result = await client.remove({ automationId });
  if (!result.success && result.error.type !== 'automation-not-found') {
    throw new Error(result.error.message);
  }
}
