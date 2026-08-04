import path from 'node:path';
import { resourceKeyFromFileRef } from '@emdash/core/primitives/path/api';
import {
  compileBootstrapPlan,
  submitAndFollowWorkspaceOperation,
  type BootstrapRepositoryInitialize,
  type ProvisionWorkspaceInput,
  type WorkspaceError,
  type WorkspaceOperationProgress,
  type WorkspaceOperationResult,
} from '@emdash/core/runtimes/workspace/api';
import { err, ok, type Result } from '@emdash/shared';
import type {
  WorkspaceBootstrapProgress,
  WorkspaceBootstrapStep,
  WorkspaceCloneProvisionResult,
} from '@core/features/workspaces/api';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { WorkspaceRuntimeClient } from '@core/services/runtime-broker/api/clients';

export type CloneRepositoryProvisionInput = {
  url: string;
  destination: string;
  remoteName?: string;
  depth?: number;
  initialize?: BootstrapRepositoryInitialize;
  signal?: AbortSignal;
  onProgress?: (progress: WorkspaceBootstrapProgress) => void;
};

export async function runCloneRepositoryProvision(
  getWorkspaceRuntimeClient: () => Promise<WorkspaceRuntimeClient>,
  input: CloneRepositoryProvisionInput
): Promise<Result<WorkspaceCloneProvisionResult, WorkspaceError>> {
  const compiled = compileBootstrapPlan(
    {
      kind: 'clone-repository',
      url: input.url,
      destination: input.destination,
      remoteName: input.remoteName,
      depth: input.depth,
      initialize: input.initialize,
    },
    {
      worktreePoolPath: path.dirname(input.destination),
      baseRemote: input.remoteName ?? 'origin',
    }
  );
  const workspaceRuntimeClient = await getWorkspaceRuntimeClient();
  const provisionInput: ProvisionWorkspaceInput = {
    workspace: hostFileRefFromNativePath(compiled.workspacePath),
    lifecycle: {
      ref: { kind: 'directory', path: compiled.workspacePath },
      context: {
        repoPath: compiled.workspacePath,
        preservePatterns: [],
      },
      setupPlan: compiled.plan,
    },
  };
  const result = await submitAndFollowWorkspaceOperation(
    workspaceRuntimeClient,
    {
      requestId: provisionRequestId(provisionInput.workspace),
      kind: 'provision',
      workspace: provisionInput.workspace,
      params: { kind: 'provision', input: provisionInput },
    },
    {
      signal: input.signal,
      onProgress: (progress) =>
        input.onProgress?.(workspaceRuntimeProgressToBootstrapProgress(progress)),
    }
  );
  return result.success
    ? ok({ path: (result.data as WorkspaceOperationResult).path ?? compiled.workspacePath })
    : err(result.error);
}

function provisionRequestId(workspace: ProvisionWorkspaceInput['workspace']): string {
  return `provision:${resourceKeyFromFileRef(workspace)}`;
}

export function workspaceRuntimeProgressToBootstrapProgress(
  progress: WorkspaceOperationProgress
): WorkspaceBootstrapProgress {
  const running = progress.stages.find((stage) => stage.status === 'running');
  const failed = progress.stages.find((stage) => stage.status === 'failed');
  const pending = progress.stages.find((stage) => stage.status === 'pending');
  const stage = running ?? failed ?? pending ?? progress.stages.at(-1);
  return {
    step: runtimeOperationToProvisionStep(progress.kind),
    message: stage?.progress?.message ?? stage?.label ?? 'Preparing workspace…',
    operation: progress,
  };
}

function runtimeOperationToProvisionStep(
  kind: WorkspaceOperationProgress['kind']
): WorkspaceBootstrapStep {
  switch (kind) {
    case 'provision':
    case 'convert':
    case 'deactivate':
    case 'teardown':
    case 'clean-artifacts':
      return 'setting-up-workspace';
    case 'activate':
      return 'initialising-workspace';
  }
}
