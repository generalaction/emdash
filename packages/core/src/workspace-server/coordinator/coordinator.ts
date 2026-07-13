import { err, ok, type Result } from '@emdash/shared';
import type { LiveJobContext, ProcedureCallOptions } from '@emdash/wire';
import {
  type BootstrapContext,
  type BootstrapError,
  type LenientBootstrapPlan,
  type LifecycleState,
  type RunPhaseInput,
  type WorkspaceRef,
} from '@services/workspace-lifecycle/api';
import { assertWorkspaceIdle, type ActivityLookup } from './guard';
import { runLifecyclePhase, type WorkspaceLifecycleRunPhaseClient } from './run-lifecycle-phase';
import type {
  ActivateInput,
  CoordinatorError,
  CoordinatorProgress,
  CoordinatorResult,
  CoordinatorStageView,
  DeactivateInput,
  DeactivateStrategy,
  SessionStartSpec,
  TeardownInput,
} from './schema';

export type WorkspaceLifecycleClient = {
  refresh(
    input: WorkspaceRef,
    options?: ProcedureCallOptions
  ): Promise<Result<LifecycleState, BootstrapError>>;
  runPhase: WorkspaceLifecycleRunPhaseClient;
};

export type SessionRuntimePort = {
  start(
    spec: SessionStartSpec,
    meta: { workspacePath: string; signal: AbortSignal }
  ): Promise<Result<void, CoordinatorError>>;
  stopForWorkspace(
    path: string,
    strategy: DeactivateStrategy,
    meta: { signal: AbortSignal }
  ): Promise<Result<void, CoordinatorError>>;
};

export type WorkspaceCoordinatorDeps = {
  lifecycle: WorkspaceLifecycleClient;
  sessions: SessionRuntimePort;
  activity: ActivityLookup;
};

type CoordinatorStage = {
  id: string;
  label: string;
  skip?: () => boolean;
  run(
    report: (progress: CoordinatorStageView['progress']) => void
  ): Promise<Result<void, CoordinatorError>> | Result<void, CoordinatorError>;
};

export class WorkspaceCoordinator {
  constructor(private readonly deps: WorkspaceCoordinatorDeps) {}

  async activate(
    input: ActivateInput,
    ctx: LiveJobContext<CoordinatorProgress>
  ): Promise<Result<CoordinatorResult, CoordinatorError>> {
    return await this.runStages(
      input.ref.path,
      [
        {
          id: 'setup',
          label: 'Set up workspace',
          skip: () => isEmptyPlan(input.setupPlan),
          run: (report) =>
            this.runSetupPhase(input.ref, input.context, input.setupPlan, ctx, report),
        },
        {
          id: 'activation-scripts',
          label: 'Run activation scripts',
          skip: () => isEmptyPlan(input.activationPlan),
          run: (report) =>
            this.runLifecycleStage(
              input.ref,
              'setup',
              input.activationPlan,
              input.context,
              ctx,
              report
            ),
        },
        {
          id: 'hydrate',
          label: 'Start sessions',
          skip: () => input.sessions.length === 0,
          run: () => this.startSessions(input.ref.path, input.sessions, ctx.signal),
        },
      ],
      ctx
    );
  }

  async deactivate(
    input: DeactivateInput,
    ctx: LiveJobContext<CoordinatorProgress>
  ): Promise<Result<CoordinatorResult, CoordinatorError>> {
    return await this.runStages(
      input.ref.path,
      [
        {
          id: 'dehydrate',
          label: 'Stop sessions',
          run: () => this.dehydrate(input.ref.path, input.strategy, ctx.signal),
        },
        {
          id: 'deactivation-scripts',
          label: 'Run deactivation scripts',
          skip: () => isEmptyPlan(input.deactivationPlan),
          run: (report) =>
            this.runLifecycleStage(
              input.ref,
              'setup',
              input.deactivationPlan,
              input.context,
              ctx,
              report
            ),
        },
      ],
      ctx
    );
  }

  async teardown(
    input: TeardownInput,
    ctx: LiveJobContext<CoordinatorProgress>
  ): Promise<Result<CoordinatorResult, CoordinatorError>> {
    return await this.runStages(
      input.ref.path,
      [
        {
          id: 'guard',
          label: 'Check workspace activity',
          run: () => assertWorkspaceIdle(this.deps.activity, input.ref.path, input.force),
        },
        {
          id: 'dehydrate',
          label: 'Stop sessions',
          run: () => this.dehydrate(input.ref.path, 'stop', ctx.signal),
        },
        {
          id: 'deactivation-scripts',
          label: 'Run deactivation scripts',
          skip: () => isEmptyPlan(input.deactivationPlan),
          run: (report) =>
            this.runLifecycleStage(
              input.ref,
              'setup',
              input.deactivationPlan,
              input.context,
              ctx,
              report
            ),
        },
        {
          id: 'teardown',
          label: 'Remove workspace',
          skip: () => isEmptyPlan(input.teardownPlan),
          run: (report) =>
            this.runLifecycleStage(
              input.ref,
              'teardown',
              input.teardownPlan,
              input.context,
              ctx,
              report
            ),
        },
      ],
      ctx
    );
  }

  private async runStages(
    path: string,
    stages: CoordinatorStage[],
    ctx: LiveJobContext<CoordinatorProgress>
  ): Promise<Result<CoordinatorResult, CoordinatorError>> {
    const views: CoordinatorStageView[] = stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      status: 'pending',
    }));
    emitProgress(views, ctx);

    for (let index = 0; index < stages.length; index++) {
      const stage = stages[index];
      const view = views[index];

      if (ctx.signal.aborted) {
        markSkippedFrom(views, index);
        emitProgress(views, ctx);
        return err(cancelledError(stage.id));
      }

      if (stage.skip?.()) {
        view.status = 'skipped';
        emitProgress(views, ctx);
        continue;
      }

      view.status = 'running';
      emitProgress(views, ctx);

      let result: Result<void, CoordinatorError>;
      try {
        result = await stage.run((progress) => {
          view.progress = progress;
          emitProgress(views, ctx);
        });
      } catch (error) {
        result = err(toCoordinatorError(error));
      }

      if (result.success) {
        view.status = 'done';
        view.progress = undefined;
        emitProgress(views, ctx);
        continue;
      }

      const stageError = withStage(result.error, stage.id);
      view.status = 'failed';
      view.progress = undefined;
      view.error = stageError;
      markSkippedFrom(views, index + 1);
      emitProgress(views, ctx);
      return err(stageError);
    }

    return ok({ path });
  }

  private async runSetupPhase(
    ref: WorkspaceRef,
    context: BootstrapContext,
    plan: LenientBootstrapPlan,
    ctx: LiveJobContext<CoordinatorProgress>,
    report: (progress: CoordinatorStageView['progress']) => void
  ): Promise<Result<void, CoordinatorError>> {
    const current = await this.deps.lifecycle.refresh(ref, { signal: ctx.signal });
    if (!current.success) return err(toCoordinatorError(current.error));
    const phase = current.data.phase === 'unprovisioned' ? 'provision' : 'setup';
    return await this.runLifecycleStage(ref, phase, plan, context, ctx, report);
  }

  private async runLifecycleStage(
    ref: WorkspaceRef,
    phase: RunPhaseInput['phase'],
    plan: LenientBootstrapPlan,
    context: BootstrapContext,
    ctx: LiveJobContext<CoordinatorProgress>,
    report: (progress: CoordinatorStageView['progress']) => void
  ): Promise<Result<void, CoordinatorError>> {
    const result = await runLifecyclePhase(
      this.deps.lifecycle.runPhase,
      { ref, phase, plan, context },
      { signal: ctx.signal, onProgress: report }
    );
    return result.success ? ok(undefined) : err(toCoordinatorError(result.error));
  }

  private async startSessions(
    workspacePath: string,
    sessions: SessionStartSpec[],
    signal: AbortSignal
  ): Promise<Result<void, CoordinatorError>> {
    for (const session of sessions) {
      if (signal.aborted) return err(cancelledError('hydrate'));
      const result = await this.deps.sessions.start(session, { workspacePath, signal });
      if (!result.success) return result;
    }
    return ok(undefined);
  }

  private async dehydrate(
    path: string,
    strategy: DeactivateStrategy,
    signal: AbortSignal
  ): Promise<Result<void, CoordinatorError>> {
    if (signal.aborted) return err(cancelledError('dehydrate'));
    return await this.deps.sessions.stopForWorkspace(path, strategy, { signal });
  }
}

function emitProgress(
  views: CoordinatorStageView[],
  ctx: LiveJobContext<CoordinatorProgress>
): void {
  ctx.progress({
    stages: views.map((view) => ({
      ...view,
      progress: view.progress ? { ...view.progress } : undefined,
      error: view.error ? { ...view.error } : undefined,
    })),
  });
}

function markSkippedFrom(views: CoordinatorStageView[], startIndex: number): void {
  for (let index = startIndex; index < views.length; index++) {
    if (views[index].status === 'pending' || views[index].status === 'running') {
      views[index].status = 'skipped';
      views[index].progress = undefined;
    }
  }
}

function isEmptyPlan(plan: LenientBootstrapPlan): boolean {
  return plan.steps.length === 0;
}

function withStage(error: CoordinatorError, stageId: string): CoordinatorError {
  return {
    ...error,
    stageId: error.stageId ?? stageId,
  };
}

function cancelledError(stageId: string): CoordinatorError {
  return {
    type: 'cancelled',
    message: 'Workspace coordinator job was cancelled',
    stageId,
  };
}

function toCoordinatorError(error: unknown): CoordinatorError {
  if (isCoordinatorError(error)) return error;
  if (isBootstrapError(error)) {
    return {
      type: error.type,
      message: error.message,
      resolutions: error.resolutions,
    };
  }
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function isCoordinatorError(error: unknown): error is CoordinatorError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

function isBootstrapError(
  error: unknown
): error is { type: string; message: string; resolutions?: string[] } {
  return isCoordinatorError(error);
}
