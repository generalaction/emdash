import type { ObservedWorkspaceState } from '../api/schemas';
import type { BootstrapPlan, BootstrapStep } from '../api/schemas';
import { createPlannedSteps } from './steps';

export type TeardownScript = {
  id: string;
  command: string;
  timeoutMs?: number;
  optional?: boolean;
};

export type CompileTeardownFromProbeOptions = {
  teardownScripts?: TeardownScript[];
};

export function compileTeardownFromProbe(
  observed: ObservedWorkspaceState,
  branchName: string,
  options: CompileTeardownFromProbeOptions = {}
): BootstrapPlan {
  const steps: BootstrapStep[] = [];
  for (const script of options.teardownScripts ?? []) {
    steps.push({
      kind: 'run-script',
      args: {
        id: script.id,
        command: script.command,
        cwd: 'worktree',
        timeoutMs: script.timeoutMs,
        optional: script.optional ?? true,
      },
    });
  }

  if (observed.worktree?.path) {
    steps.push({
      kind: 'remove-worktree',
      args: {
        path: observed.worktree.path,
      },
    });
  }

  if (observed.branchCreatedByEmdash) {
    steps.push({
      kind: 'delete-branch',
      args: { branchName },
    });
  }

  return { steps: createPlannedSteps(steps) };
}
