import {
  createController,
  withValidation,
  type Controller,
  type ValidatePolicy,
} from '@emdash/wire';
import { workspaceContract, type WorkspaceContract } from '@runtimes/workspace/api';
import type { WorkspaceRuntime } from '@runtimes/workspace/node/workspace-runtime';
import { workspaceJobError } from '@runtimes/workspace/node/workspace-runtime';

export type WorkspaceControllerOptions = {
  contract?: WorkspaceContract;
  validate?: ValidatePolicy;
};

export function createWorkspaceController(
  runtime: WorkspaceRuntime,
  options: WorkspaceControllerOptions = {}
): Controller {
  const contract = options.contract ?? workspaceContract;
  return withValidation(
    contract,
    createController(contract, {
      workspace: runtime.host,
      reconcile: (input, meta) => runtime.reconcile(input, meta.signal),
      provision: {
        run: (input, ctx) => runtime.provision(input, ctx),
        toError: workspaceJobError,
      },
      convert: {
        run: (input, ctx) => runtime.convert(input, ctx),
        toError: workspaceJobError,
      },
      activate: {
        run: (input, ctx) => runtime.activate(input, ctx),
        toError: workspaceJobError,
      },
      deactivate: {
        run: (input, ctx) => runtime.deactivate(input, ctx),
        toError: workspaceJobError,
      },
      teardown: {
        run: (input, ctx) => runtime.teardown(input, ctx),
        toError: workspaceJobError,
      },
      runScript: {
        run: (input, ctx) => runtime.runScript(input, ctx),
        toError: workspaceJobError,
      },
      scriptOutput: (key) => runtime.scriptOutput(key),
    }),
    options.validate ?? 'inputs'
  );
}
