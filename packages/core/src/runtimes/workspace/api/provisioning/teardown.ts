import type {
  BootstrapPlan,
  BootstrapStep,
  ObservedWorkspaceState,
  WorkspaceRef,
} from '@runtimes/workspace/api/provisioning/schemas';
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
  ref: WorkspaceRef,
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

  if (ref.kind === 'directory') {
    if (observed.directoryExists) {
      steps.push({
        kind: 'remove-directory',
        args: { path: ref.path },
      });
    }
    return { steps: createPlannedSteps(steps) };
  }

  if (observed.worktree?.registered || observed.directoryExists) {
    steps.push({
      kind: 'remove-worktree',
      args: {
        path: ref.path,
      },
    });
  }

  if (observed.branchCreatedByEmdash) {
    steps.push({
      kind: 'delete-branch',
      args: { branchName: ref.branchName },
    });
  }

  return { steps: createPlannedSteps(steps) };
}
