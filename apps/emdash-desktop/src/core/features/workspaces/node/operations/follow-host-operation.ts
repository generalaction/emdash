import type { HandlerContext } from '@emdash/core/primitives/kernel/api';
import type {
  WorkspaceHostOperationStage,
  WorkspaceHostOperationView,
} from '@emdash/core/runtimes/workspace-host/api';
import type { Result } from '@emdash/shared';
import type { Clock } from '@emdash/shared/scheduling';

const DEFAULT_POLL_INTERVAL_MS = 500;

/** Host stage ids are mirrored into the desktop journal under this prefix. */
const HOST_STAGE_PREFIX = 'host:';

export type HostOperationFollowSource = {
  getOperation(input: {
    operationId: string;
  }): Promise<Result<WorkspaceHostOperationView | null, { type: string; message: string }>>;
};

export type HostOperationFollowOptions = {
  operationId: string;
  clock: Clock;
  pollIntervalMs?: number;
};

/**
 * A host stage terminated as `failed`. The desktop stage journal already
 * recorded the failure; callers classify this as deterministic (the host
 * kernel exhausted its own retries before failing the stage).
 */
export class HostStageFailedError extends Error {
  readonly code = 'host-stage-failed';

  constructor(
    readonly stage: WorkspaceHostOperationStage,
    readonly view: WorkspaceHostOperationView
  ) {
    super(stage.error?.message ?? `${stage.label} failed on the host`);
    this.name = 'HostStageFailedError';
  }
}

/**
 * Watches a submitted host operation until it reaches a terminal status,
 * folding the host's stage stream into the desktop operation record via
 * `ctx.stage`. Host stages execute sequentially, so each is mirrored as one
 * desktop stage that resolves when the host stage terminates.
 *
 * Throws `HostStageFailedError` for a fatal failed host stage (deterministic).
 * Explicitly non-fatal host failures are mirrored with `StageContext.fail()`
 * while following continues to the host operation's successful terminal view.
 * Polling/transport failures throw a plain retryable error.
 */
export async function followHostOperation(
  ctx: Pick<HandlerContext<unknown, unknown>, 'stage' | 'signal'>,
  source: HostOperationFollowSource,
  options: HostOperationFollowOptions
): Promise<WorkspaceHostOperationView> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const mirrored = new Set<string>();
  let view = await fetchView(source, options.operationId);

  for (;;) {
    throwIfAborted(ctx.signal);

    for (const stage of view.stages) {
      if (mirrored.has(stage.id)) continue;
      // Preserve host ordering: don't open a mirror for a stage the host has
      // not started yet.
      if (stage.status === 'pending') break;
      mirrored.add(stage.id);
      view = await mirrorStage(ctx, source, options, pollIntervalMs, view, stage);
    }

    if (isHostTerminal(view.status)) return view;
    await options.clock.sleep(pollIntervalMs);
    throwIfAborted(ctx.signal);
    view = await fetchView(source, options.operationId);
  }
}

async function mirrorStage(
  ctx: Pick<HandlerContext<unknown, unknown>, 'stage' | 'signal'>,
  source: HostOperationFollowSource,
  options: HostOperationFollowOptions,
  pollIntervalMs: number,
  initialView: WorkspaceHostOperationView,
  stage: WorkspaceHostOperationStage
): Promise<WorkspaceHostOperationView> {
  let view = initialView;
  await ctx.stage(`${HOST_STAGE_PREFIX}${stage.id}`, stage.label, async (stageCtx) => {
    let current = stage;
    for (;;) {
      if (current.status === 'succeeded' || current.status === 'skipped') return;
      if (current.status === 'failed') {
        if (current.nonFatal) {
          stageCtx.fail(current.error?.message ?? `${current.label} failed on the host`);
          return;
        }
        throw new HostStageFailedError(current, view);
      }
      if (typeof current.progress === 'number') stageCtx.progress(current.progress);
      // The host operation ended while this stage never terminated (e.g. the
      // host handler aborted between stages); let the terminal view decide.
      if (isHostTerminal(view.status)) return;
      throwIfAborted(ctx.signal);
      await options.clock.sleep(pollIntervalMs);
      view = await fetchView(source, options.operationId);
      current = view.stages.find((candidate) => candidate.id === stage.id) ?? current;
    }
  });
  return view;
}

async function fetchView(
  source: HostOperationFollowSource,
  operationId: string
): Promise<WorkspaceHostOperationView> {
  const result = await source.getOperation({ operationId });
  if (!result.success) {
    throw Object.assign(new Error(result.error.message), { code: result.error.type });
  }
  if (!result.data) {
    throw Object.assign(new Error(`Host operation ${operationId} was not found on the host`), {
      code: 'host-operation-missing',
    });
  }
  return result.data;
}

function isHostTerminal(status: WorkspaceHostOperationView['status']): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'rejected' ||
    status === 'cancelled' ||
    status === 'superseded'
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw Object.assign(new Error('Host operation follow aborted'), { code: 'aborted' });
  }
}
