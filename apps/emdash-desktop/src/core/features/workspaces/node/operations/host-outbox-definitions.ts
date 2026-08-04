import {
  formatHostRef,
  LOCAL_HOST_REF,
  parseHostRef,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';
import {
  createOperationHandler,
  type HandlerContext,
  type InputOf,
} from '@emdash/core/primitives/kernel/api';
import { parseAbsolute } from '@emdash/core/primitives/path/api';
import type {
  WorkspaceHostOperationInput,
  WorkspaceHostOperationView,
} from '@emdash/core/runtimes/workspace-host/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Clock } from '@emdash/shared/scheduling';
import {
  hostCreateWorktreeOperation,
  hostReprovisionWorktreeOperation,
  hostRemoveRepositoryOperation,
  hostRemoveWorktreeOperation,
  type HostCreateWorktreeInput,
  type HostReprovisionWorktreeInput,
  type HostRemoveRepositoryInput,
  type HostRemoveWorktreeInput,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import { classifyWorkspaceOperationError } from '@core/features/workspaces/api/node/operation-error-classifier';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationDefinition, OperationError } from '@core/services/operations/node';
import {
  needsConfirmation,
  rejectOperationOutcome,
  retryable,
  runOperationStage,
  stageOk,
  terminal,
} from '@core/services/operations/node';
import { followHostOperation, HostStageFailedError } from './follow-host-operation';

const SUBMIT_TIMEOUT_MS = 30_000;
const DEACTIVATE_TIMEOUT_MS = 5 * 60_000;

export type HostOutboxDependencies = {
  runtimes: Pick<RuntimeBroker, 'client'>;
  /**
   * Releases workspace-runtime consumers (running teardown scripts) before the
   * host removes a worktree. Runs only while the host is reachable.
   */
  deactivateWorkspace?(
    input: {
      hostRef: SerializedHostRef;
      workspacePath: string;
      consumers: 'all' | readonly string[];
      operationId: string;
    },
    options: { signal?: AbortSignal; onWaitingChange?: (waiting: boolean) => void }
  ): Promise<void>;
  pollIntervalMs?: number;
};

type OperationRuntime = { db: AppDb; clock: Clock; initiatedBy?: string };

type HostOutboxOperation =
  | typeof hostRemoveWorktreeOperation
  | typeof hostCreateWorktreeOperation
  | typeof hostReprovisionWorktreeOperation
  | typeof hostRemoveRepositoryOperation;

export const hostOutboxOperationContribution = {
  create: (
    dependencies: HostOutboxDependencies,
    runtime: OperationRuntime
  ): readonly OperationDefinition[] => [
    createHostRemoveWorktreeDefinition(dependencies, runtime),
    createHostCreateWorktreeDefinition(dependencies, runtime),
    createHostReprovisionWorktreeDefinition(),
    createHostRemoveRepositoryDefinition(dependencies, runtime),
  ],
};

export function createHostRemoveWorktreeDefinition(
  dependencies: HostOutboxDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof hostRemoveWorktreeOperation> {
  const handler = createOperationHandler(hostRemoveWorktreeOperation, async (ctx) => {
    const input = ctx.input;
    gateReconcilerProposal(ctx, input);
    if (dependencies.deactivateWorkspace && input.deactivateConsumers !== undefined) {
      const consumers = input.deactivateConsumers;
      await runOperationStage(ctx, {
        id: 'deactivate-workspace',
        timeoutMs: DEACTIVATE_TIMEOUT_MS,
        clock: runtime.clock,
        classifyError: classifyWorkspaceOperationError,
        run: async (signal, stage) => {
          await dependencies.deactivateWorkspace!(
            {
              hostRef: input.hostRef,
              workspacePath: input.workspacePath,
              consumers,
              operationId: ctx.operationId,
            },
            { signal, onWaitingChange: (waiting) => stage.progress(waiting ? 0.5 : 0) }
          );
          return stageOk();
        },
      });
    }
    await runHostVerb(ctx, dependencies, runtime, input, {
      verb: 'host.removeWorktree',
      input: {
        version: '1',
        operationId: input.hostOperationId,
        hostId: input.hostRef,
        repoPath: parseHostPath(ctx, input.repoPath),
        worktreePath: parseHostPath(ctx, input.workspacePath),
        branchName: input.branchName,
        deleteBranch: input.deleteBranch,
      },
    });
    return { ok: true as const };
  });
  return hostOutboxDescriptor(hostRemoveWorktreeOperation, handler, {
    displayName: 'Removing worktree',
    example: {
      version: '1',
      source: 'user',
      hostOperationId: 'host-op-example',
      hostRef: formatHostRef(LOCAL_HOST_REF),
      repoPath: '/repo',
      workspacePath: '/repo/.worktrees/example',
      branchName: 'example',
      deleteBranch: false,
      createdAt: 1,
    },
  });
}

export function createHostCreateWorktreeDefinition(
  dependencies: HostOutboxDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof hostCreateWorktreeOperation> {
  const handler = createOperationHandler(hostCreateWorktreeOperation, async (ctx) => {
    const input = ctx.input;
    gateReconcilerProposal(ctx, input);
    await runHostVerb(ctx, dependencies, runtime, input, {
      verb: 'host.createWorktree',
      input: {
        version: '1',
        operationId: input.hostOperationId,
        hostId: input.hostRef,
        repoPath: parseHostPath(ctx, input.repoPath),
        worktreePath: parseHostPath(ctx, input.workspacePath),
        branchName: input.branchName,
        startPoint: input.startPoint,
        fetch: input.fetch,
        pushRemote: input.pushRemote,
        preservePatterns: input.preservePatterns,
      },
    });
    return { ok: true as const };
  });
  return hostOutboxDescriptor(hostCreateWorktreeOperation, handler, {
    displayName: 'Creating worktree',
    example: {
      version: '1',
      source: 'user',
      hostOperationId: 'host-op-example',
      hostRef: formatHostRef(LOCAL_HOST_REF),
      repoPath: '/repo',
      workspacePath: '/repo/.worktrees/example',
      branchName: 'example',
      preservePatterns: [],
      createdAt: 1,
    },
  });
}

export function createHostReprovisionWorktreeDefinition(): OperationDefinition<
  typeof hostReprovisionWorktreeOperation
> {
  const handler = createOperationHandler(hostReprovisionWorktreeOperation, async (ctx) => {
    if (ctx.input.removeFirst !== false) {
      const removed = await ctx.run(hostRemoveWorktreeOperation, ctx.input.remove);
      if (!removed.success) throw new Error(`Worktree removal failed: ${removed.error.kind}`);
    }
    const created = await ctx.run(hostCreateWorktreeOperation, ctx.input.create);
    if (!created.success) throw new Error(`Worktree creation failed: ${created.error.kind}`);
    return { ok: true as const };
  });
  const example: HostReprovisionWorktreeInput = {
    version: '1',
    source: 'user',
    hostOperationId: 'desktop-reprovision-example',
    hostRef: formatHostRef(LOCAL_HOST_REF),
    repoPath: '/repo',
    projectId: 'project-example',
    workspaceId: 'workspace-example',
    entityName: 'Example',
    workspacePath: '/repo/.worktrees/example',
    removeFirst: true,
    prediction: { compiledAt: 1, observedAsOf: null, stages: [] },
    createdAt: 1,
    remove: {
      version: '1',
      source: 'user',
      hostOperationId: 'host-remove-example',
      hostRef: formatHostRef(LOCAL_HOST_REF),
      repoPath: '/repo',
      projectId: 'project-example',
      workspaceId: 'workspace-example',
      workspacePath: '/repo/.worktrees/example',
      branchName: 'example',
      deleteBranch: false,
      createdAt: 1,
    },
    create: {
      version: '1',
      source: 'user',
      hostOperationId: 'host-create-example',
      hostRef: formatHostRef(LOCAL_HOST_REF),
      repoPath: '/repo',
      projectId: 'project-example',
      workspaceId: 'workspace-example',
      workspacePath: '/repo/.worktrees/example',
      branchName: 'example',
      preservePatterns: [],
      createdAt: 1,
    },
  };
  return hostOutboxDescriptor(hostReprovisionWorktreeOperation, handler, {
    displayName: 'Re-provisioning worktree',
    example,
  });
}

export function createHostRemoveRepositoryDefinition(
  dependencies: HostOutboxDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof hostRemoveRepositoryOperation> {
  const handler = createOperationHandler(hostRemoveRepositoryOperation, async (ctx) => {
    const input = ctx.input;
    gateReconcilerProposal(ctx, input);
    await runHostVerb(ctx, dependencies, runtime, input, {
      verb: 'host.removeRepository',
      input: {
        version: '1',
        operationId: input.hostOperationId,
        hostId: input.hostRef,
        repoPath: parseHostPath(ctx, input.repoPath),
        deleteBranches: input.deleteBranches,
      },
    });
    return { ok: true as const };
  });
  return hostOutboxDescriptor(hostRemoveRepositoryOperation, handler, {
    displayName: 'Removing repository',
    example: {
      version: '1',
      source: 'user',
      hostOperationId: 'host-op-example',
      hostRef: formatHostRef(LOCAL_HOST_REF),
      repoPath: '/repo',
      workspacePath: '/repo',
      createdAt: 1,
    },
  });
}

type HostOutboxInput =
  | HostRemoveWorktreeInput
  | HostCreateWorktreeInput
  | HostRemoveRepositoryInput;

type HandlerCtx = HandlerContext<HostOutboxInput, OperationError>;

function gateReconcilerProposal(ctx: HandlerCtx, input: HostOutboxInput): void {
  if (input.source === 'reconciler' && !input.confirmedAt) {
    rejectOperationOutcome(ctx, needsConfirmation('reconciler-proposed'));
  }
}

/**
 * Submit-then-watch: submits the verb to the host (idempotent by the
 * desktop-minted operation id, so retries and reconnects re-ask by id) and
 * folds the host's stage stream into this record until terminal.
 */
async function runHostVerb(
  ctx: HandlerCtx,
  dependencies: HostOutboxDependencies,
  runtime: OperationRuntime,
  input: HostOutboxInput,
  request: WorkspaceHostOperationInput
): Promise<WorkspaceHostOperationView> {
  const client = await dependencies.runtimes.client(parseHostRef(input.hostRef));
  if (!client.success) {
    rejectOperationOutcome(
      ctx,
      retryable(`Host ${input.hostRef} is unavailable`, 'host-unreachable')
    );
  }
  const workspaceHost = client.data.workspaceHost;

  await runOperationStage(ctx, {
    id: 'submit-host-operation',
    label: 'Submit to host',
    timeoutMs: SUBMIT_TIMEOUT_MS,
    clock: runtime.clock,
    run: async () => {
      const submitted = await workspaceHost.submitOperation(request);
      if (!submitted.success) {
        return retryable(submitted.error.message, submitted.error.type);
      }
      return stageOk();
    },
  });

  let view: WorkspaceHostOperationView;
  try {
    view = await followHostOperation(ctx, workspaceHost, {
      operationId: input.hostOperationId,
      clock: runtime.clock,
      pollIntervalMs: dependencies.pollIntervalMs,
    });
  } catch (error) {
    if (error instanceof HostStageFailedError) {
      rejectOperationOutcome(ctx, terminal(error, error.code));
    }
    throw error;
  }

  if (view.status !== 'succeeded') {
    rejectOperationOutcome(
      ctx,
      terminal(
        view.error?.message ?? `Host operation ${view.status}`,
        view.error?.type ?? 'host-operation-failed'
      )
    );
  }

  return view;
}

function parseHostPath(ctx: HandlerCtx, path: string) {
  const parsed = parseAbsolute(path);
  if (!parsed.success) {
    rejectOperationOutcome(ctx, terminal(`Invalid host path: ${path}`, 'invalid-host-path'));
  }
  return parsed.data;
}

function hostOutboxDescriptor<D extends HostOutboxOperation>(
  definition: D,
  handler: ReturnType<typeof createOperationHandler<D>>,
  options: { displayName: string; example: InputOf<D> }
): OperationDefinition<D> {
  return {
    definition,
    handler,
    entityKind: 'workspace',
    displayName: options.displayName,
    examples: [{ definition, input: options.example }],
    prediction: (input) => input.prediction,
  };
}
