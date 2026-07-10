import { ok } from '@emdash/shared';
import { createController } from '@emdash/wire';
import { workspaceLifecycleContract } from './api/contract';
import { toBootstrapError } from './api/errors';
import { WorkspaceLifecycleManager } from './manager';
import { validateBootstrapPlan } from './plan/validate';
import { bootstrapStepRegistry } from './steps/registry';

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
