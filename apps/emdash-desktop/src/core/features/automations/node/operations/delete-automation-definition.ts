import {
  formatHostRef,
  LOCAL_HOST_REF,
  parseHostRef,
  serializedHostRefSchema,
} from '@emdash/core/primitives/host/api';
import { createOperationHandler, defineOperation } from '@emdash/core/primitives/kernel/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import {
  runtimeResolveErrorAsError,
  type HostRuntimesClient,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import type { Clock } from '@emdash/shared/scheduling';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import z from 'zod';
import { operationHostRef } from '@core/features/workspaces/api/node/operation-host-ref';
import { automationKernelResource } from '@core/primitives/operations/api/resources';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { automationRuns, automations, projects } from '@core/services/app-db/node/schema';
import { enqueueTombstoned, type OperationSubmitter } from '@core/services/operations/api/node';
import type {
  OperationDefinition,
  OperationReconcileContext,
} from '@core/services/operations/node';
import {
  confirmInput,
  needsConfirmation,
  operationErrorSchema,
  operationResultSchema,
  operationRetryPolicy,
  runOperationStage,
} from '@core/services/operations/node';
import { listTombstonedAutomationIds, purgeAutomationRows } from '../repo';

const RUNTIME_TIMEOUT_MS = 30_000;
const PURGE_TIMEOUT_MS = 30_000;
const LIST_RUNS_LIMIT = 200;

const deleteAutomationInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      source: z.enum(['user', 'reconciler']),
      automationId: z.string(),
      projectId: z.string().nullable().optional(),
      hostRef: serializedHostRefSchema,
      entityName: z.string().optional(),
      hostLabel: z.string().optional(),
      confirmedAt: z.number().int().nonnegative().optional(),
      createdAt: z.number().int().nonnegative(),
    })
  )
  .build();

export type DeleteAutomationOperationInput = typeof deleteAutomationInputSchema.Type;

export const deleteAutomationOperation = defineOperation({
  name: 'delete-automation',
  input: deleteAutomationInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `automation:${input.automationId}`,
  claims: (input) =>
    automationKernelResource.mutates({
      projectId: input.projectId ?? 'global',
      automationId: input.automationId,
    }),
  describe: (input) => input.entityName ?? input.automationId,
  retry: operationRetryPolicy,
});

export const deleteAutomationOperationContribution = {
  create: (dependencies: DeleteAutomationOperationDependencies, runtime: OperationRuntime) => [
    createDeleteAutomationOperationDefinition(dependencies, runtime),
  ],
};

const ACTIVE_RUN_STATUSES = [
  'scheduled',
  'queued',
  'provisioning_workspace',
  'starting_session',
] as const;

export type DeleteAutomationOperationDependencies = {
  runtimes: Pick<RuntimeBroker, 'client'>;
};

type OperationRuntime = { db: AppDb; clock: Clock; initiatedBy?: string };

export function createDeleteAutomationOperationDefinition(
  dependencies: DeleteAutomationOperationDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof deleteAutomationOperation> {
  const handler = createOperationHandler(deleteAutomationOperation, async (ctx) => {
    if (ctx.input.source === 'reconciler' && !ctx.input.confirmedAt) {
      needsConfirmation(ctx, 'reconciler-proposed');
    }
    const client = await resolveRuntimeClient(dependencies.runtimes, ctx.input.hostRef);
    await runOperationStage(ctx, {
      id: 'cancel-active-runs',
      timeoutMs: RUNTIME_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () => cancelActiveRuns(client, ctx.input.automationId),
    });
    await runOperationStage(ctx, {
      id: 'remove-deployment',
      timeoutMs: RUNTIME_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () => removeDeployment(client, ctx.input.automationId),
    });
    await runOperationStage(ctx, {
      id: 'purge-automation-rows',
      timeoutMs: PURGE_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () => purgeAutomationRows(runtime.db, ctx.input.automationId),
    });
    return { ok: true as const };
  });

  return {
    definition: deleteAutomationOperation,
    handler,
    entityKind: 'automation',
    examples: [
      {
        definition: deleteAutomationOperation,
        input: {
          version: '1',
          source: 'user',
          automationId: 'automation-example',
          projectId: 'project-example',
          hostRef: formatHostRef(LOCAL_HOST_REF),
          createdAt: 1,
        },
      },
    ],
    describe: (input) => ({ entityName: input.entityName, hostLabel: input.hostLabel }),
    projectId: (input) => input.projectId ?? undefined,
    hostRef: (input) => input.hostRef,
    confirmedInput: (input, confirmedAt) => confirmInput(input, confirmedAt),
    purge: async ({ input, db }) => {
      db.transaction((tx) => {
        tx.delete(automationRuns).where(eq(automationRuns.automationId, input.automationId)).run();
        tx.delete(automations).where(eq(automations.id, input.automationId)).run();
      });
    },
    reconcile: (context) => reconcileAutomationCleanups(context),
  };
}

export async function enqueueDeleteAutomation(
  operations: OperationSubmitter,
  automationId: string
) {
  const createdAt = Date.now();
  return enqueueTombstoned(operations, {
    definition: deleteAutomationOperation,
    load: async () => {
      const [automation] = await operations.db
        .select({ id: automations.id, name: automations.name, projectId: automations.projectId })
        .from(automations)
        .where(and(eq(automations.id, automationId), isNull(automations.deletedAt)))
        .limit(1);
      if (!automation) return undefined;
      const [project] = automation.projectId
        ? await operations.db
            .select({ name: projects.name, sshConnectionId: projects.sshConnectionId })
            .from(projects)
            .where(eq(projects.id, automation.projectId))
            .limit(1)
        : [];
      return { automation, project };
    },
    notFound: () => ({
      type: 'automation-not-found',
      message: `Automation ${automationId} was not found`,
    }),
    buildInput: ({ automation, project }): DeleteAutomationOperationInput => ({
      version: '1',
      source: 'user',
      automationId: automation.id,
      projectId: automation.projectId,
      hostRef: formatHostRef(operationHostRef({ project })),
      entityName: automation.name,
      hostLabel: project?.sshConnectionId ? project.name : undefined,
      createdAt,
    }),
    precondition: (tx, { automation }) =>
      automation.projectId ? projectIsActive(tx, automation.projectId) : undefined,
    tombstone: (tx, { automation }) =>
      tx
        .update(automations)
        .set({ deletedAt: createdAt, updatedAt: createdAt })
        .where(and(eq(automations.id, automation.id), isNull(automations.deletedAt)))
        .run().changes,
    revert: (tx, { automation }) => {
      tx.update(automations)
        .set({ deletedAt: null, updatedAt: Date.now() })
        .where(eq(automations.id, automation.id))
        .run();
    },
  });
}

function projectIsActive(tx: DrizzleTx, projectId: string) {
  const active =
    tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1)
      .get() !== undefined;
  return active ? undefined : { type: 'project-deleting', message: 'Project is being deleted.' };
}

async function reconcileAutomationCleanups(context: OperationReconcileContext): Promise<void> {
  for (const automationId of await listTombstonedAutomationIds(context.db)) {
    if (await context.hasActiveKey(deleteAutomationOperation.key(exampleInput(automationId))))
      continue;
    const [automation] = await context.db
      .select({ id: automations.id, name: automations.name, projectId: automations.projectId })
      .from(automations)
      .where(and(eq(automations.id, automationId), isNotNull(automations.deletedAt)))
      .limit(1);
    if (!automation) continue;
    const [project] = automation.projectId
      ? await context.db
          .select({ name: projects.name, sshConnectionId: projects.sshConnectionId })
          .from(projects)
          .where(eq(projects.id, automation.projectId))
          .limit(1)
      : [];
    await context.submit(deleteAutomationOperation, {
      version: '1',
      source: 'reconciler',
      automationId,
      projectId: automation.projectId,
      hostRef: formatHostRef(operationHostRef({ project })),
      entityName: automation.name,
      hostLabel: project?.name,
      createdAt: context.clock.now(),
    });
  }
}

function exampleInput(automationId: string): DeleteAutomationOperationInput {
  return {
    version: '1',
    source: 'reconciler',
    automationId,
    hostRef: formatHostRef(LOCAL_HOST_REF),
    createdAt: 1,
  };
}

async function resolveRuntimeClient(
  runtimes: Pick<RuntimeBroker, 'client'>,
  hostRefKey: string
): Promise<HostRuntimesClient['automations']> {
  const result = await runtimes.client(parseHostRef(hostRefKey));
  if (!result.success) throw runtimeResolveErrorAsError(result.error);
  return result.data.automations;
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
