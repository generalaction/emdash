import { err, ok, type Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/api';
import { formatHostRef } from '@primitives/host/api';
import {
  formatAbsolute,
  hostFileRef,
  parseAbsolute,
  type HostAbsolutePath,
  type HostFileRef,
} from '@primitives/path/api';
import {
  compileWorktreePayload,
  type CreateWorktreeAction,
  type WorkspaceHostActionsContract,
  type WorkspaceHostActionView,
} from '@services/workspace-host-actions/api';
import type { AutomationWorkspaceConfig } from '../../api/deployment';
import type { AutomationPortError } from './port-error';

const DEFAULT_POLL_INTERVAL_MS = 500;

const CANCELLED_ERROR = {
  code: 'cancelled',
  message: 'Workspace provisioning was cancelled',
} satisfies AutomationPortError;

export type AutomationWorkspaceResult = {
  workspace: HostFileRef;
  branchName: string | null;
};

export interface AutomationWorkspacePort {
  provision(input: {
    workspace: AutomationWorkspaceConfig;
    generatedName: string;
    runId: string;
    signal: AbortSignal;
  }): Promise<Result<AutomationWorkspaceResult, AutomationPortError>>;
}

export type WorkspacePortOptions = {
  pollIntervalMs?: number;
};

/**
 * Provisions run workspaces through the host's own operation runtime: the run
 * compiles its worktree payload with the shared pure compiler, submits
 * `host.createWorktree` (idempotent by the run-derived operation id), and
 * watches the operation record to a terminal status. The host runtime has no
 * cancel primitive; an aborted run stops waiting and the idempotent host
 * operation is left to finish on its own.
 */
export function createWorkspacePortFromDependency(
  client: ContractClient<WorkspaceHostActionsContract>,
  options: WorkspacePortOptions = {}
): AutomationWorkspacePort {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  return {
    async provision(input) {
      if (input.signal.aborted) return err(CANCELLED_ERROR);
      if (input.workspace.kind === 'directory') {
        return ok({ workspace: input.workspace.path, branchName: null });
      }

      try {
        const compiled = compileCreateWorktree(input.workspace, input.generatedName, input.runId);
        const submitted = await client.submitOperation(compiled.request);
        if (!submitted.success) {
          return err({ code: submitted.error.type, message: submitted.error.message });
        }

        const view = await awaitTerminalView(
          client,
          submitted.data.operationId,
          input.signal,
          pollIntervalMs
        );
        if (view === 'aborted') return err(CANCELLED_ERROR);
        if (view.status !== 'succeeded') return err(viewToPortError(view));
        return ok({ workspace: compiled.workspace, branchName: compiled.branchName });
      } catch (error) {
        if (input.signal.aborted) return err(CANCELLED_ERROR);
        return err({
          code: 'workspace_provisioning_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

type CompiledCreateWorktree = {
  request: CreateWorktreeAction;
  workspace: HostFileRef;
  branchName: string;
};

function compileCreateWorktree(
  config: Extract<AutomationWorkspaceConfig, { kind: 'worktree' }>,
  generatedName: string,
  runId: string
): CompiledCreateWorktree {
  const branchName = config.git.kind === 'create-branch' ? generatedName : config.git.branchName;
  const compiled = compileWorktreePayload({
    repoPath: nativePath(config.repository.path),
    worktreeRoot: nativePath(parentPath(config.worktreePoolPath)),
    branchName,
    preservePatterns: config.preservePatterns,
  });
  const worktreePath = parseNativePath(compiled.worktreePath);

  return {
    branchName,
    workspace: hostFileRef(config.repository.host, worktreePath),
    request: {
      verb: 'host.createWorktree',
      input: {
        version: '1',
        operationId: `automation-run:${runId}`,
        hostId: formatHostRef(config.repository.host),
        repoPath: config.repository.path,
        worktreePath,
        branchName,
        ...compileGitOperation(config.git),
        preservePatterns: compiled.preservePatterns,
      },
    },
  };
}

function compileGitOperation(
  git: Extract<AutomationWorkspaceConfig, { kind: 'worktree' }>['git']
): { startPoint?: string; fetch?: boolean; pushRemote?: string } {
  if (git.kind !== 'create-branch') return {};
  return {
    startPoint:
      git.fromBranch.type === 'remote'
        ? `${git.fromBranch.remote.name}/${git.fromBranch.branch}`
        : git.fromBranch.branch,
    fetch: git.fromBranch.type === 'remote',
    ...(git.pushRemote !== null && { pushRemote: git.pushRemote }),
  };
}

async function awaitTerminalView(
  client: ContractClient<WorkspaceHostActionsContract>,
  operationId: string,
  signal: AbortSignal,
  pollIntervalMs: number
): Promise<WorkspaceHostActionView | 'aborted'> {
  for (;;) {
    if (signal.aborted) return 'aborted';
    const result = await client.getOperation({ operationId });
    if (!result.success) {
      throw new Error(result.error.message);
    }
    if (!result.data) {
      throw new Error(`Host operation ${operationId} was not found on the host`);
    }
    if (isTerminalStatus(result.data.status)) return result.data;
    await sleep(pollIntervalMs, signal);
  }
}

function isTerminalStatus(status: WorkspaceHostActionView['status']): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'rejected' ||
    status === 'cancelled' ||
    status === 'superseded'
  );
}

function viewToPortError(view: WorkspaceHostActionView): AutomationPortError {
  if (view.status === 'cancelled') return CANCELLED_ERROR;
  if (view.error) return { code: view.error.type, message: view.error.message };
  return { code: view.status, message: `Workspace operation ${view.status}` };
}

function nativePath(path: HostAbsolutePath): string {
  return formatAbsolute(path, { separator: path.root.kind === 'posix' ? '/' : '\\' });
}

function parentPath(path: HostAbsolutePath): HostAbsolutePath {
  if (path.segments.length === 0) return path;
  return { ...path, segments: path.segments.slice(0, -1) };
}

function parseNativePath(native: string): HostAbsolutePath {
  const parsed = parseAbsolute(native, {
    profile: {
      style: /^[A-Za-z]:[\\/]/u.test(native) ? 'win32' : 'posix',
      unicodeNormalization: 'preserve',
    },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
