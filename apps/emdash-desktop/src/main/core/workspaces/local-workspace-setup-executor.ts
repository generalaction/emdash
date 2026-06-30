import { err, ok, Result, type Result as ResultType } from '@emdash/shared/result';
import { log } from '@main/lib/logger';
import type { WorkspaceSetupSpec } from '@shared/core/workspaces/workspace-setup-spec';
import type { SetupStepWarning } from '@shared/core/workspaces/workspace-setup-steps';
import * as AddWorktreeStep from './setup-steps/add-worktree';
import * as CopyPreservedFilesStep from './setup-steps/copy-preserved-files';
import * as CreateLocalBranchStep from './setup-steps/create-local-branch';
import * as EnsureRemoteStep from './setup-steps/ensure-remote';
import * as GitFetchStep from './setup-steps/git-fetch';
import * as PushBranchStep from './setup-steps/push-branch';
import * as SetBranchBaseStep from './setup-steps/set-branch-base';
import * as SetBranchTrackingStep from './setup-steps/set-branch-tracking';
import type { StepContext } from './setup-steps/step-context';
import type { SetupResult, WorkspaceSetupExecutor } from './workspace-setup-executor';

/** Wraps a step promise, tagging the error with its step kind on failure. */
const runStep = <T, E extends object, K extends string>(kind: K, p: Promise<ResultType<T, E>>) =>
  Result.fromAsync(p).mapErr((e) => ({ ...e, kind }));

export class LocalWorkspaceSetupExecutor implements WorkspaceSetupExecutor {
  constructor(private readonly ctx: StepContext) {}

  async execute(spec: WorkspaceSetupSpec): Promise<SetupResult> {
    const warnings: SetupStepWarning[] = [];
    // Mutable context extended with the resolved worktree path once add-worktree succeeds.
    const ctx: StepContext = { ...this.ctx };

    for (const step of spec) {
      log.debug('workspace-setup-executor: executing step', { kind: step.kind });

      switch (step.kind) {
        case 'git-fetch': {
          const r = await runStep('git-fetch', GitFetchStep.execute(step.args, ctx));
          if (!r.success) return r;
          break;
        }

        case 'ensure-remote': {
          const r = await runStep('ensure-remote', EnsureRemoteStep.execute(step.args, ctx));
          if (!r.success) return r;
          break;
        }

        case 'create-local-branch': {
          const r = await runStep(
            'create-local-branch',
            CreateLocalBranchStep.execute(step.args, ctx)
          );
          if (!r.success) return r;
          break;
        }

        case 'set-branch-tracking': {
          // Always succeeds (non-fatal warnings are logged inside the step).
          await SetBranchTrackingStep.execute(step.args, ctx);
          break;
        }

        case 'set-branch-base': {
          // Always succeeds (non-fatal warnings are logged inside the step).
          await SetBranchBaseStep.execute(step.args, ctx);
          break;
        }

        case 'push-branch': {
          // Always succeeds (non-fatal warnings are logged inside the step).
          await PushBranchStep.execute(step.args, ctx);
          break;
        }

        case 'add-worktree': {
          const r = await runStep('add-worktree', AddWorktreeStep.execute(step.args, ctx));
          if (!r.success) return r;
          // Propagate the resolved path for subsequent steps.
          ctx.resolvedWorktreePath = r.data.path;
          break;
        }

        case 'copy-preserved-files': {
          // Always succeeds (non-fatal warnings are logged inside the step).
          await CopyPreservedFilesStep.execute(step.args, ctx);
          break;
        }

        default: {
          const _exhaustive: never = step;
          log.warn('workspace-setup-executor: unknown step kind', { step: _exhaustive });
        }
      }
    }

    const resolvedPath = ctx.resolvedWorktreePath;
    if (!resolvedPath && spec.some((s) => s.kind === 'add-worktree')) {
      // add-worktree was in the spec but never produced a path — should not happen
      // if the step is implemented correctly, but guard defensively.
      return err({
        kind: 'add-worktree',
        type: 'worktree-failed',
        branchName: '',
        message: 'No worktree path was resolved after executing all setup steps',
      });
    }

    return ok({ path: resolvedPath ?? '', warnings });
  }
}
