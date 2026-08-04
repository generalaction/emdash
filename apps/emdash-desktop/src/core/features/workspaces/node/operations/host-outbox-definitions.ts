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
  hostRemoveRepositoryOperation,
  hostRemoveWorktreeOperation,
  type HostCreateWorktreeInput,
  type HostRemoveRepositoryInput,
  type HostRemoveWorktreeInput,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import { classifyWorkspaceOperationError } from '@core/features/workspaces/api/node/operation-error-classifier';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationDefinition, OperationError } from '@core/services/operations/node';
import {
  confirmInput,
  failOperation,
  needsConfirmation,
  runOperationStage,
} from '@core/services/operations/node';
import { followHostOperation, HostStageFailedError } from './follow-host-operation';

const SUBMIT_TIMEOUT_MS = 30_000;
const DEACTIVATE_TIMEOUT_MS = 5 * 60_000;

export type HostOutboxDependencies = {
  runtimes: Pick<RuntimeBroker, 'client'>;
  /** Requests a full snapshot of the affected repository after a verb lands. */
  requestSnapshot?(input: { hostRef: SerializedHostRef; repoPath: string }): void;
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
  | typeof hostRemoveRepositoryOperation;

export const hostOutboxOperationContribution = {
  create: (
    dependencies: HostOutboxDependencies,
    runtime: OperationRuntime
  ): readonly OperationDefinition[] => [
    createHostRemoveWorktreeDefinition(dependencies, runtime),
    createHostCreateWorktreeDefinition(dependencies, runtime),
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
        run: async (signal, stage) =>
          dependencies.deactivateWorkspace!(
            {
              hostRef: input.hostRef,
              workspacePath: input.workspacePath,
              consumers,
              operationId: ctx.operationId,
            },
            { signal, onWaitingChange: (waiting) => stage.progress(waiting ? 0.5 : 0) }
          ),
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
      },
    });
    return { ok: true as const };
  });
  return hostOutboxDescriptor(hostCreateWorktreeOperation, handler, {
    example: {
      version: '1',
      source: 'user',
      hostOperationId: 'host-op-example',
      hostRef: formatHostRef(LOCAL_HOST_REF),
      repoPath: '/repo',
      workspacePath: '/repo/.worktrees/example',
      branchName: 'example',
      createdAt: 1,
    },
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
    example: {
      version: '1',
      source: 'user',
      hostOperationId: 'host-op-example',
      hostRef: formatHostRef(LOCAL_HOST_REF),
      repoPath: '/repo',
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
    needsConfirmation(ctx, 'reconciler-proposed');
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
    throw Object.assign(new Error(`Host ${input.hostRef} is unavailable`), {
      code: 'host-unreachable',
    });
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
        throw Object.assign(new Error(submitted.error.message), { code: submitted.error.type });
      }
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
      failOperation(ctx, error.message, { code: error.code, retryable: false });
    }
    throw error;
  }

  if (view.status !== 'succeeded') {
    failOperation(ctx, view.error?.message ?? `Host operation ${view.status}`, {
      code: view.error?.type ?? 'host-operation-failed',
      retryable: false,
    });
  }

  dependencies.requestSnapshot?.({ hostRef: input.hostRef, repoPath: input.repoPath });
  return view;
}

function parseHostPath(ctx: HandlerCtx, path: string) {
  const parsed = parseAbsolute(path);
  if (!parsed.success) {
    failOperation(ctx, `Invalid host path: ${path}`, {
      code: 'invalid-host-path',
      retryable: false,
    });
  }
  return parsed.data;
}

function hostOutboxDescriptor<D extends HostOutboxOperation>(
  definition: D,
  handler: ReturnType<typeof createOperationHandler<D>>,
  options: { example: InputOf<D> }
): OperationDefinition<D> {
  return {
    definition,
    handler,
    entityKind: 'workspace',
    examples: [{ definition, input: options.example }],
    describe: (input) => ({
      entityName: input.entityName,
      hostLabel: input.hostLabel,
      workspacePath: 'workspacePath' in input ? input.workspacePath : input.repoPath,
      branchName: 'branchName' in input ? input.branchName : undefined,
    }),
    projectId: (input) => input.projectId,
    hostRef: (input) => input.hostRef,
    prediction: (input) => input.prediction,
    confirmedInput: (input, confirmedAt) => confirmInput(input, confirmedAt),
  };
}
