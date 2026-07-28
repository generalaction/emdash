import { hostRef, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import {
  runtimeResolveErrorAsError,
  type HostRuntimesClient,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  nonTerminalOperationStatuses,
  type OperationPayload,
} from '@core/primitives/operations/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  automationRuns,
  automations,
  lifecycleOperations,
  projects,
} from '@core/services/app-db/node/schema';
import {
  runOperationActions,
  type OperationDefinition,
  type OperationSubmit,
  type OperationsEngine,
} from '@core/services/operations/node';
import { listTombstonedAutomationIds, purgeAutomationRows } from '../repo';

const RUNTIME_TIMEOUT_MS = 30_000;
const PURGE_TIMEOUT_MS = 30_000;
const LIST_RUNS_LIMIT = 200;
const ACTIVE_RUN_STATUSES = [
  'scheduled',
  'queued',
  'provisioning_workspace',
  'starting_session',
] as const;
const reconcilerDedupeStatuses = [...nonTerminalOperationStatuses, 'abandoned'] as const;

export type DeleteAutomationOperationDependencies = {
  runtimes: Pick<RuntimeBroker, 'client'>;
};

export function createDeleteAutomationOperationDefinition(
  dependencies: DeleteAutomationOperationDependencies
): OperationDefinition {
  return {
    kind: 'delete-automation',
    entityKind: 'automation',
    async describe({ operation, db }) {
      if (!operation.entityKey) return { entityName: operation.payload.entityName };
      const [automation] = await db
        .select({ name: automations.name })
        .from(automations)
        .where(eq(automations.id, operation.entityKey))
        .limit(1);
      return { entityName: automation?.name ?? operation.payload.entityName };
    },
    async run(runContext) {
      const { operation, db } = runContext;
      const automationId = operation.entityKey;
      if (!automationId) return ok(undefined);
      const client = await resolveRuntimeClient(dependencies.runtimes, operation.hostRef);
      return runOperationActions(runContext, [
        {
          id: 'cancel-active-runs',
          timeoutMs: RUNTIME_TIMEOUT_MS,
          run: async () => cancelActiveRuns(client, automationId),
        },
        {
          id: 'remove-deployment',
          timeoutMs: RUNTIME_TIMEOUT_MS,
          run: async () => removeDeployment(client, automationId),
        },
        {
          id: 'purge-automation-rows',
          timeoutMs: PURGE_TIMEOUT_MS,
          run: async () => purgeAutomationRows(db, automationId),
        },
      ]);
    },
    async forget({ operation, db, markAbandoned }) {
      db.transaction((tx) => {
        markAbandoned(tx);
        if (operation.entityKey) {
          tx.delete(automationRuns)
            .where(eq(automationRuns.automationId, operation.entityKey))
            .run();
          tx.delete(automations).where(eq(automations.id, operation.entityKey)).run();
        }
      });
    },
  };
}

export async function enqueueDeleteAutomation(operations: OperationsEngine, automationId: string) {
  return operations.submit(async ({ db, clock }) => {
    const [automation] = await db
      .select({
        id: automations.id,
        name: automations.name,
        projectId: automations.projectId,
      })
      .from(automations)
      .where(and(eq(automations.id, automationId), isNull(automations.deletedAt)))
      .limit(1);
    if (!automation) {
      const [existing] = await db
        .select({ id: lifecycleOperations.id })
        .from(lifecycleOperations)
        .where(
          and(
            eq(lifecycleOperations.entityKey, automationId),
            eq(lifecycleOperations.kind, 'delete-automation'),
            inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
          )
        )
        .orderBy(desc(lifecycleOperations.createdAt))
        .limit(1);
      return existing
        ? ok({ outcome: 'existing' as const, operationId: existing.id })
        : err({
            type: 'automation-not-found',
            automationId,
            message: `Automation ${automationId} was not found`,
          });
    }

    const [project] = automation.projectId
      ? await db
          .select({ name: projects.name, sshConnectionId: projects.sshConnectionId })
          .from(projects)
          .where(eq(projects.id, automation.projectId))
          .limit(1)
      : [];
    const createdAt = clock.now();
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-automation' as const,
        projectId: automation.projectId,
        entityKey: automation.id,
        hostRef: project?.sshConnectionId ?? 'local',
        payload: {
          version: '1' as const,
          source: 'user' as const,
          entityName: automation.name,
          hostLabel: project?.sshConnectionId ? project.name : undefined,
        },
        createdAt,
      },
      options: {
        dedupeStatuses: nonTerminalOperationStatuses,
        tombstone: (tx) =>
          tx
            .update(automations)
            .set({ deletedAt: createdAt, updatedAt: createdAt })
            .where(and(eq(automations.id, automation.id), isNull(automations.deletedAt)))
            .run().changes,
      },
    });
  });
}

export async function submitReconcilerAutomationCleanup(
  submit: OperationSubmit,
  automationId: string
): Promise<void> {
  await submit(async ({ db, clock }) => {
    const [existing] = await db
      .select({ id: lifecycleOperations.id })
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.entityKey, automationId),
          eq(lifecycleOperations.kind, 'delete-automation'),
          inArray(lifecycleOperations.status, [...reconcilerDedupeStatuses])
        )
      )
      .limit(1);
    if (existing) return ok({ outcome: 'existing' as const, operationId: existing.id });

    const [automation] = await db
      .select({
        id: automations.id,
        name: automations.name,
        projectId: automations.projectId,
        deletedAt: automations.deletedAt,
      })
      .from(automations)
      .where(eq(automations.id, automationId))
      .limit(1);
    if (!automation) return ok({ outcome: 'existing' as const });

    const [project] = automation.projectId
      ? await db
          .select({ name: projects.name, sshConnectionId: projects.sshConnectionId })
          .from(projects)
          .where(eq(projects.id, automation.projectId))
          .limit(1)
      : [];
    const createdAt = clock.now();
    const payload: OperationPayload = {
      version: '1',
      source: 'reconciler',
      entityName: automation.name,
      hostLabel: project?.name,
      confirmationReason: 'reconciler-proposed',
    };
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-automation' as const,
        status: 'awaiting-confirmation' as const,
        projectId: automation.projectId,
        entityKey: automation.id,
        hostRef: project?.sshConnectionId ?? 'local',
        payload,
        createdAt,
      },
      options: {
        dedupeStatuses: reconcilerDedupeStatuses,
        tombstone: (tx) => {
          tx.update(automations)
            .set({ deletedAt: automation.deletedAt ?? createdAt, updatedAt: createdAt })
            .where(eq(automations.id, automation.id))
            .run();
          return 1;
        },
      },
    });
  });
}

export async function submitReconcilerAutomationCleanups(
  submit: OperationSubmit,
  db: AppDb
): Promise<void> {
  for (const automationId of await listTombstonedAutomationIds(db)) {
    await submitReconcilerAutomationCleanup(submit, automationId);
  }
}

async function resolveRuntimeClient(
  runtimes: Pick<RuntimeBroker, 'client'>,
  hostRefKey: string
): Promise<HostRuntimesClient['automations']> {
  const result = await runtimes.client(hostFromOperationHostRef(hostRefKey));
  if (!result.success) throw runtimeResolveErrorAsError(result.error);
  return result.data.automations;
}

function hostFromOperationHostRef(value: string): HostRef {
  return value === 'local' ? LOCAL_HOST_REF : hostRef('remote', value);
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
