import type { WorkspaceSetupStep } from './workspace-setup-steps';

/**
 * Converts a `WorkspaceSetupSpec` into human-readable strings for display in the UI.
 *
 * This is a pure function — safe to call in the renderer without any IPC.
 * The spec itself is produced by `compileSetupSpec` from `workspace-setup-spec.ts`,
 * which is also renderer-safe.
 */
export function describeSetupSteps(steps: WorkspaceSetupStep[]): string[] {
  return steps.map(describeStep);
}

function describeStep(step: WorkspaceSetupStep): string {
  switch (step.kind) {
    case 'git-fetch':
      return step.args.refspec
        ? `Fetch ${step.args.refspec} from ${step.args.remote}`
        : `Fetch from ${step.args.remote}`;
    case 'ensure-remote':
      return `Add remote "${step.args.name}" → ${step.args.url}`;
    case 'create-local-branch':
      return `Create branch "${step.args.branchName}" from ${step.args.fromRef}`;
    case 'set-branch-tracking':
      return `Track ${step.args.remote}/${step.args.remoteBranch} for "${step.args.branchName}"`;
    case 'set-branch-base':
      return `Set merge base for "${step.args.branchName}" to ${step.args.baseRef}`;
    case 'push-branch':
      return step.args.setUpstream
        ? `Push "${step.args.branchName}" to ${step.args.remote} (set upstream)`
        : `Push "${step.args.branchName}" to ${step.args.remote}`;
    case 'add-worktree':
      return `Create worktree for branch "${step.args.branchName}"`;
    case 'copy-preserved-files':
      return 'Copy preserved project files into the worktree';
  }
}
