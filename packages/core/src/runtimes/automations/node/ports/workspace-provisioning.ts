import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/rpc';
import {
  formatAbsolute,
  hostFileRef,
  parseAbsolute,
  type HostAbsolutePath,
  type HostFileRef,
} from '#primitives/path/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- runs await the registry's plain createWorktree verb (operation-log retirement §5); the contract has no services-level home yet
import {
  compileWorktreePayload,
  type CreateWorkspaceError,
  type CreateWorktreeError,
  type WorkspaceRegistryContract,
} from '#runtimes/workspace-registry/api';
import type { WorkspaceCreationAdmissionContract } from '../../api/creation-admission';
import type { AutomationWorkspaceConfig } from '../../api/deployment';
import type { AutomationPortError } from './port-error';

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

/**
 * Provisions run workspaces through the host workspace registry's plain
 * `createWorktree` RPC — no operation record, no poll loop. The port registers the
 * repository record idempotently, then awaits the create on the same local worker
 * wire the session port already uses. The run id doubles as the worktree record id,
 * so a replayed run falls under the verb's replay semantics (succeeded → no-op,
 * failed/interrupted → re-execute) instead of double-creating. Aborting the run
 * cancels the in-flight RPC through the wire's cancellation signal.
 *
 * Creation admission (ADR 0006, spec §4) runs first: a compiled path or branch
 * carrying a pending deletion tombstone refuses before anything touches the
 * registry, and the typed refusal becomes the run's failure.
 */
export function createWorkspacePortFromDependency(
  client: ContractClient<WorkspaceRegistryContract>,
  admission: ContractClient<WorkspaceCreationAdmissionContract>
): AutomationWorkspacePort {
  return {
    async provision(input) {
      if (input.signal.aborted) return err(CANCELLED_ERROR);
      if (input.workspace.kind === 'directory') {
        return ok({ workspace: input.workspace.path, branchName: null });
      }

      try {
        const compiled = compileCreateWorktree(input.workspace, input.generatedName);
        const admitted = await admission.checkWorktreeCreation(
          { path: compiled.worktreePath, branch: compiled.branchName },
          { signal: input.signal }
        );
        if (!admitted.success) {
          return err({ code: admitted.error.type, message: admitted.error.message });
        }
        const repository = await registerRepository(client, compiled.repositoryPath, input.signal);
        if (!repository.success) return repository;

        const created = await client.createWorktree(
          {
            workspaceId: input.runId,
            repositoryId: repository.data,
            branch: compiled.branchName,
            baseRef: compiled.baseRef,
            path: compiled.worktreePath,
            preservePatterns: compiled.preservePatterns,
            ...(compiled.publish !== undefined && { publish: compiled.publish }),
          },
          { signal: input.signal }
        );
        if (!created.success) return err(createErrorToPortError(created.error));
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
  repositoryPath: string;
  worktreePath: string;
  branchName: string;
  baseRef: string;
  publish?: { remote: string };
  preservePatterns: string[];
  workspace: HostFileRef;
};

function compileCreateWorktree(
  config: Extract<AutomationWorkspaceConfig, { kind: 'worktree' }>,
  generatedName: string
): CompiledCreateWorktree {
  const branchName = config.git.kind === 'create-branch' ? generatedName : config.git.branchName;
  const compiled = compileWorktreePayload({
    repoPath: nativePath(config.repository.path),
    worktreeRoot: nativePath(parentPath(config.worktreePoolPath)),
    branchName,
    preservePatterns: config.preservePatterns,
  });

  return {
    repositoryPath: nativePath(config.repository.path),
    worktreePath: compiled.worktreePath,
    branchName,
    baseRef: compileBaseRef(config.git),
    ...(config.git.kind === 'create-branch' && config.git.pushRemote !== null
      ? { publish: { remote: config.git.pushRemote } }
      : {}),
    preservePatterns: compiled.preservePatterns,
    workspace: hostFileRef(config.repository.host, parseNativePath(compiled.worktreePath)),
  };
}

/**
 * The verb resolves an existing local branch itself, so the base ref only matters when
 * the branch is being created — mirrors the desktop's `compileWorktreeGitPlan`.
 */
function compileBaseRef(
  git: Extract<AutomationWorkspaceConfig, { kind: 'worktree' }>['git']
): string {
  if (git.kind === 'use-branch') return git.branchName;
  return git.fromBranch.type === 'remote'
    ? `${git.fromBranch.remote.name}/${git.fromBranch.branch}`
    : git.fromBranch.branch;
}

/**
 * Idempotent repository registration (the desktop's `createWorktreeThroughRegistry`
 * pattern): a fresh id either registers the path or adopts the record that already
 * owns it, so replays converge on one stable repository id.
 */
async function registerRepository(
  client: ContractClient<WorkspaceRegistryContract>,
  repositoryPath: string,
  signal: AbortSignal
): Promise<Result<string, AutomationPortError>> {
  const result = await client.createWorkspace(
    { workspaceId: randomUUID(), path: repositoryPath },
    { signal }
  );
  if (result.success) return ok(result.data.id);
  return err({
    code: result.error.type,
    message: describeCreateWorkspaceError(result.error),
  });
}

function describeCreateWorkspaceError(error: CreateWorkspaceError): string {
  switch (error.type) {
    case 'path-not-found':
      return `Repository path not found: ${error.path}`;
    case 'inspect-failed':
    case 'immutable-field-mismatch':
      return error.message;
  }
}

function createErrorToPortError(error: CreateWorktreeError): AutomationPortError {
  switch (error.type) {
    // The failed stage is the run error's code; stage-level drill-down lives on the
    // workspace record's outcome block via the run's workspace link.
    case 'stage-failed':
      return { code: error.stage, message: error.message };
    case 'path-conflict':
      return {
        code: 'path-conflict',
        message: `Worktree path is already registered: ${error.path}`,
      };
    case 'repository-not-found':
      return {
        code: 'repository-not-found',
        message: `Repository record not found: ${error.repositoryId}`,
      };
    case 'immutable-field-mismatch':
      return { code: 'immutable-field-mismatch', message: error.message };
  }
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
