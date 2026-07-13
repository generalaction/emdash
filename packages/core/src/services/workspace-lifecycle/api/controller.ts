import { ok } from '@emdash/shared';
import { createController } from '@emdash/wire';
import { workspaceLifecycleContract } from '@services/workspace-lifecycle/api/api/contract';
import { toBootstrapError } from '@services/workspace-lifecycle/api/api/errors';
import { validateBootstrapPlan } from '@services/workspace-lifecycle/api/plan/validate';
import { bootstrapStepRegistry } from '@services/workspace-lifecycle/api/steps/registry';
import { WorkspaceLifecycleManager } from './manager';

export function createWorkspaceLifecycleController(manager = new WorkspaceLifecycleManager()) {
  return createController(workspaceLifecycleContract, {
    capabilities: () =>
      ({
        stepKinds: Object.keys(bootstrapStepRegistry),
      }) satisfies { stepKinds: string[] },
    validatePlan: (input) => {
      const validated = validateBootstrapPlan(input.plan);
      if (!validated.success) return validated;
      return ok({ stepCount: validated.data.steps.length });
    },
    workspace: manager.host,
    refresh: (input, meta) => manager.refresh(input, meta.signal),
    listWorkspaces: (input, meta) => manager.listWorkspaces(input.repoPath, meta.signal),
    runPhase: {
      run: (input, ctx) => manager.runPhase(input, ctx),
      toError: toBootstrapError,
    },
    stepOutput: (key) => manager.stepLog(key),
  });
}
