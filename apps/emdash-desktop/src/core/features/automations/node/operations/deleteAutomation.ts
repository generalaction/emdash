import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { and, eq, isNull } from 'drizzle-orm';
import { projectIsBeingDeleted } from '@core/features/projects/api/node/project-deletion';
import type { MutationError } from '@core/primitives/wire/api/mutations';
import type { AppDb } from '@core/services/app-db/node/db';
import { automations } from '@core/services/app-db/node/schema';
import {
  deleteAutomationDefinition,
  listTombstonedAutomations,
  purgeAutomationRows,
} from '../repo';

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
 * rows intact. An unreachable host never discards the deletion intent (ADR 0006): the
 * automation row keeps its `deletedAt` tombstone — hidden from every live query, so the
 * caller sees success — and `sweepAutomationDeletionTombstones` finishes the host
 * cleanup and purges the rows once the host is reachable again. Nothing submits to the
 * operations kernel.
 */

export type AutomationDeletionResult = Result<void, MutationError>;

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
  if (automation.projectId && projectIsBeingDeleted(db, automation.projectId)) {
    return err({ type: 'project-deleting', message: 'Project is being deleted.' });
  }

  let client: HostRuntimesClient['automations'];
  try {
    client = await dependencies.resolveClient(automation.projectId);
  } catch (error) {
    // Unreachable host (ADR 0006): the durable tombstone on the automation row is the
    // deletion intent for the host-artifact half — the deployment and its active runs.
    // A duplicate write (row already tombstoned) is still success: double-fire suppression.
    await deleteAutomationDefinition(db, automationId);
    dependencies.logger.warn(
      'deleteAutomation: host unreachable, tombstoned the deletion for the sweep',
      { automationId, error: String(error) }
    );
    return ok(undefined);
  }
  try {
    await cancelActiveRuns(client, automationId);
    await removeDeployment(client, automationId);
  } catch (error) {
    return err({
      type: 'runtime-unavailable',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await purgeAutomationRows(db, automationId);
  return ok(undefined);
}

/**
 * Converges tombstoned automation deletions — the idempotent removal function for the
 * automations kind. The deployment has no mirror row in a host registry, so this does
 * not register with the entity-generic reconcile sweep; AutomationsService runs it when
 * a runtime comes up (boot, reconnect-and-restart). Each pass retries the host cleanup
 * and purges the desktop rows only after it succeeds; an unreachable host keeps its
 * tombstones for the next pass. Never throws — a failed item just stays tombstoned.
 */
export async function sweepAutomationDeletionTombstones(
  dependencies: AutomationDeletionDependencies
): Promise<void> {
  const { db } = dependencies;
  for (const automation of await listTombstonedAutomations(db)) {
    try {
      const client = await dependencies.resolveClient(automation.projectId);
      await cancelActiveRuns(client, automation.id);
      await removeDeployment(client, automation.id);
    } catch (error) {
      dependencies.logger.warn(
        'deleteAutomation sweep: host cleanup failed, tombstone kept for the next pass',
        { automationId: automation.id, error: String(error) }
      );
      continue;
    }
    await purgeAutomationRows(db, automation.id);
  }
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
