import { err, ok, type Result } from '@emdash/shared';
import { createLiveModelReplica } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import { formatAbsolute, hostFileRef, parseAbsolute, type HostFileRef } from '@primitives/path/api';
import {
  workspaceProvisioningContract,
  type WorkspaceProvisioningContract,
  type WorkspaceProvisioningError,
  type WorkspaceProvisioningInput,
  type WorkspaceProvisioningOperationRecord,
  type WorkspaceProvisioningOperationRecordMap,
  type WorkspaceProvisioningResult,
} from '@services/workspace-provisioning/api';
import type { AutomationPortError } from './port-error';

const CANCELLED_ERROR = {
  code: 'cancelled',
  message: 'Workspace provisioning was cancelled',
} satisfies AutomationPortError;

const PROVISIONING_CANCELLED_ERROR = {
  type: 'cancelled',
  message: 'Workspace provisioning was cancelled',
} satisfies WorkspaceProvisioningError;

export interface AutomationWorkspacePort {
  provision(
    input: WorkspaceProvisioningInput & { signal: AbortSignal }
  ): Promise<Result<WorkspaceProvisioningResult, AutomationPortError>>;
}

export function createWorkspacePortFromDependency(
  client: ContractClient<WorkspaceProvisioningContract>
): AutomationWorkspacePort {
  return {
    async provision(input) {
      if (input.signal.aborted) return err(CANCELLED_ERROR);

      try {
        const compiled = compileProvisioningInput(input);
        const result = await submitAndFollowProvisioningOperation(
          client,
          {
            requestId: `provision:${nativePathFromWorkspace(compiled.provisionInput.workspace)}`,
            kind: 'provision',
            workspace: compiled.provisionInput.workspace,
            params: { kind: 'provision', input: compiled.provisionInput },
          },
          { signal: input.signal }
        );
        if (!result.success) return err(workspaceErrorToAutomationPortError(result.error));
        return ok({
          workspace: compiled.provisionInput.workspace,
          branchName: compiled.branchName,
        });
      } catch (error) {
        return err({
          code: 'workspace_provisioning_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

function workspaceErrorToAutomationPortError(
  error: WorkspaceProvisioningError
): AutomationPortError {
  if (error.type === 'cancelled') return CANCELLED_ERROR;
  return { code: error.type, message: error.message };
}

type CompiledProvisioningInput = {
  provisionInput: {
    workspace: HostFileRef;
    lifecycle?: unknown;
  };
  branchName: string | null;
};

function compileProvisioningInput(input: WorkspaceProvisioningInput): CompiledProvisioningInput {
  if (input.workspace.kind === 'directory') {
    return { provisionInput: { workspace: input.workspace.path }, branchName: null };
  }

  const repositoryPath = nativePathFromWorkspace(input.workspace.repository);
  const worktreePoolPath = formatAbsolute(input.workspace.worktreePoolPath, {
    separator: input.workspace.worktreePoolPath.root.kind === 'posix' ? '/' : '\\',
  });
  const branchName =
    input.workspace.git.kind === 'create-branch'
      ? input.generatedName
      : input.workspace.git.branchName;
  const workspacePath = joinNativePath(
    worktreePoolPath,
    sanitizeBranchName(branchName),
    input.workspace.worktreePoolPath.root.kind === 'posix' ? 'posix' : 'win32'
  );
  const workspace = workspaceFromNativePath(workspacePath, input.workspace.repository.host);

  return {
    branchName,
    provisionInput: {
      workspace,
      lifecycle: {
        ref: {
          kind: 'worktree',
          repoPath: repositoryPath,
          path: workspacePath,
          branchName,
        },
        context: {
          repoPath: repositoryPath,
          preservePatterns: input.workspace.preservePatterns,
          worktreePoolPath,
        },
        setupPlan: {
          steps:
            input.workspace.git.kind === 'create-branch'
              ? createBranchPlanSteps(input.workspace.git, branchName, workspacePath)
              : [
                  plannedStep('add-worktree', 'Add worktree', {
                    branchName,
                    path: workspacePath,
                  }),
                  plannedStep('copy-preserved-files', 'Copy preserved files', {}),
                ],
        },
      },
    },
  };
}

function createBranchPlanSteps(
  git: Extract<WorkspaceProvisioningInput['workspace'], { kind: 'worktree' }>['git'] & {
    kind: 'create-branch';
  },
  branchName: string,
  workspacePath: string
) {
  const steps = [];
  if (git.fromBranch.type === 'remote') {
    const remoteName = git.fromBranch.remote.name;
    const fromRef = `${remoteName}/${git.fromBranch.branch}`;
    steps.push(
      plannedStep('git-fetch', 'Fetch branch', {
        remote: remoteName,
        refspec: `+refs/heads/${git.fromBranch.branch}:refs/remotes/${remoteName}/${git.fromBranch.branch}`,
        noTags: true,
        filter: 'blob:none',
      }),
      plannedStep('create-local-branch', 'Create branch', { branchName, fromRef, noTrack: true }),
      plannedStep('set-branch-base', 'Set branch base', { branchName, baseRef: fromRef })
    );
  } else {
    steps.push(
      plannedStep('create-local-branch', 'Create branch', {
        branchName,
        fromRef: git.fromBranch.branch,
        noTrack: true,
      }),
      plannedStep('set-branch-base', 'Set branch base', {
        branchName,
        baseRef: git.fromBranch.branch,
      })
    );
  }
  steps.push(
    plannedStep('add-worktree', 'Add worktree', { branchName, path: workspacePath }),
    plannedStep('copy-preserved-files', 'Copy preserved files', {})
  );
  if (git.pushRemote) {
    steps.push(
      plannedStep('push-branch', 'Push branch', {
        branchName,
        remote: git.pushRemote,
        setUpstream: true,
      })
    );
  }
  return steps;
}

function plannedStep(kind: string, label: string, args: unknown) {
  return {
    id: `${kind}:1`,
    label,
    step: { kind, args },
  };
}

async function submitAndFollowProvisioningOperation(
  client: ContractClient<WorkspaceProvisioningContract>,
  request: Parameters<ContractClient<WorkspaceProvisioningContract>['submitOperation']>[0],
  options: { signal?: AbortSignal } = {}
): Promise<Result<unknown, WorkspaceProvisioningError>> {
  if (options.signal?.aborted) return err(PROVISIONING_CANCELLED_ERROR);
  let settled = false;
  let terminalResolve!: (record: WorkspaceProvisioningOperationRecord) => void;
  const terminal = new Promise<WorkspaceProvisioningOperationRecord>((resolve) => {
    terminalResolve = resolve;
  });
  const replica = createLiveModelReplica(
    workspaceProvisioningContract.operationLog,
    client.operationLog,
    {
      onChange: {
        list: (records: WorkspaceProvisioningOperationRecordMap) => {
          const record = records[request.requestId];
          if (!record || settled) return;
          if (isTerminalStatus(record.status)) {
            settled = true;
            terminalResolve(record);
          }
        },
      },
    }
  );
  const lease = replica.acquire({});
  const cancel = () => void client.cancelOperation({ requestId: request.requestId });
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const model = await lease.ready();
    const snapshot = await model.states.list.snapshot();
    const records = snapshot.data as WorkspaceProvisioningOperationRecordMap;
    const existing = records[request.requestId];
    if (existing && isTerminalStatus(existing.status)) {
      settled = true;
      terminalResolve(existing);
    }
    if (options.signal?.aborted) return err(PROVISIONING_CANCELLED_ERROR);
    const submitted = await client.submitOperation(request);
    if (!submitted.success) return err(submitted.error);
    const record = await terminal;
    if (record.status === 'succeeded') return ok(record.result?.data);
    return err(
      record.error ?? {
        type: record.status,
        message: `Workspace operation ${record.status}`,
      }
    );
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    await lease.release();
    await replica.dispose();
  }
}

function isTerminalStatus(status: string): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'rejected' ||
    status === 'cancelled' ||
    status === 'suspended'
  );
}

function nativePathFromWorkspace(ref: HostFileRef): string {
  return formatAbsolute(ref.path, { separator: ref.path.root.kind === 'posix' ? '/' : '\\' });
}

function workspaceFromNativePath(nativePath: string, host: HostFileRef['host']): HostFileRef {
  const parsed = parseAbsolute(nativePath, {
    profile: {
      style: /^[A-Za-z]:[\\/]/u.test(nativePath) ? 'win32' : 'posix',
      unicodeNormalization: 'preserve',
    },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(host, parsed.data);
}

function joinNativePath(base: string, segment: string, rootKind: 'posix' | 'win32'): string {
  const separator = rootKind === 'posix' ? '/' : '\\';
  return `${base.replace(/[\\/]+$/u, '')}${separator}${segment}`;
}

function sanitizeBranchName(branchName: string): string {
  return branchName.replace(/[^a-zA-Z0-9._-]/g, '-');
}
