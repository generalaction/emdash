import {
  createController,
  withValidation,
  type Controller,
  type LiveModelProvider,
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
  const workspaceProvider: LiveModelProvider<typeof contract.workspace> = {
    kind: 'liveModelProvider',
    contract: contract.workspace,
    resolveState: (workspace) => runtime.resolveState(workspace),
    runMutation: (name, envelope) => runtime.host.runMutation(name, envelope),
  };
  return withValidation(
    contract,
    createController(contract, {
      workspace: workspaceProvider,
      provisionFromIntent: {
        run: (input, ctx) => runtime.provisionFromIntent(input, ctx),
        toError: workspaceJobError,
      },
      reconcile: (input, meta) => runtime.reconcile(input, meta.signal),
      measureUsage: (input, meta) => runtime.measureUsage(input, meta.signal),
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
      cleanArtifacts: {
        run: (input, ctx) => runtime.cleanArtifacts(input, ctx),
        toError: workspaceJobError,
      },
    }),
    options.validate ?? 'inputs'
  );
}
