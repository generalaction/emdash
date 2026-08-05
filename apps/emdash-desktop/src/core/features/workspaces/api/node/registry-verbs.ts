import crypto from 'node:crypto';
import type { HostRef } from '@emdash/core/primitives/host/api';
import type { CreateWorkspaceError } from '@emdash/core/runtimes/workspace-registry/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';

export type WorkspaceCreationFailure = { stage: string; message: string };
export type WorkspaceCreationOutcome = Result<void, WorkspaceCreationFailure>;

/**
 * In-memory index of in-flight createWorktree verb calls, keyed by workspace id.
 * Provisioning awaits the pending promise instead of polling the mirror; the durable
 * trace (the host's lastCreateOutcome) covers restarts, where this map starts empty.
 */
export class WorkspaceCreations {
  private readonly inFlight = new Map<string, Promise<WorkspaceCreationOutcome>>();

  /** Coalesces per workspace id: a second run while one is in flight joins it. */
  run(
    workspaceId: string,
    work: () => Promise<WorkspaceCreationOutcome>
  ): Promise<WorkspaceCreationOutcome> {
    const existing = this.inFlight.get(workspaceId);
    if (existing) return existing;
    const promise = work()
      .catch(
        (error): WorkspaceCreationOutcome =>
          err({
            stage: 'transport',
            message: error instanceof Error ? error.message : String(error),
          })
      )
      .finally(() => {
        this.inFlight.delete(workspaceId);
      });
    this.inFlight.set(workspaceId, promise);
    return promise;
  }

  pending(workspaceId: string): Promise<WorkspaceCreationOutcome> | undefined {
    return this.inFlight.get(workspaceId);
  }
}

/** Everything the createWorktree verb needs, compiled desktop-side at task creation. */
export type RegistryWorktreeSpec = {
  host: HostRef;
  /** The desktop mirror id for the repository; preserved on the host by backfill. */
  repositoryWorkspaceId: string | null;
  repositoryPath: string;
  workspaceId: string;
  branch: string;
  baseRef: string;
  path: string;
  preservePatterns: string[];
  pushBranch: boolean;
};

/**
 * Executes one worktree creation through the host registry verbs (ADR 0005): ensures
 * the repository record exists (idempotent, preserved id), then calls `createWorktree`.
 * Failures come back stage-tagged — the same shape the host records durably as
 * lastCreateOutcome — and replays with the identical spec re-execute safely.
 */
export async function createWorktreeThroughRegistry(
  runtimes: Pick<RuntimeBroker, 'client'>,
  spec: RegistryWorktreeSpec
): Promise<WorkspaceCreationOutcome> {
  const client = await runtimes.client(spec.host);
  if (!client.success) {
    return err({ stage: 'resolve-host', message: client.error.message });
  }
  const registry = client.data.workspaceRegistry;

  let repositoryId = spec.repositoryWorkspaceId ?? crypto.randomUUID();
  const repository = await registry.createWorkspace({
    id: repositoryId,
    path: spec.repositoryPath,
  });
  if (!repository.success) {
    // Another id already owns the path (host auto-adoption, second desktop): adopt it.
    if (repository.error.type === 'already-registered') {
      repositoryId = repository.error.record.id;
    } else {
      return err({
        stage: 'register-repository',
        message: describeCreateWorkspaceError(repository.error),
      });
    }
  }

  const created = await registry.createWorktree({
    id: spec.workspaceId,
    repositoryId,
    branch: spec.branch,
    baseRef: spec.baseRef,
    path: spec.path,
    preservePatterns: spec.preservePatterns,
    pushBranch: spec.pushBranch,
  });
  if (!created.success) {
    const error = created.error;
    switch (error.type) {
      case 'stage-failed':
        return err({ stage: error.stage, message: error.message });
      case 'path-conflict':
        return err({ stage: 'inspect', message: `Path is already registered: ${error.path}` });
      case 'repository-not-found':
        return err({
          stage: 'register-repository',
          message: `Repository record not found: ${error.repositoryId}`,
        });
      case 'immutable-field-mismatch':
        return err({ stage: 'replay', message: error.message });
    }
  }
  return ok(undefined);
}

/**
 * Compiles the git half of a workspace config into the verb's branch/baseRef/push
 * fields. Mirrors the legacy outbox compile: the host resolves an existing local
 * branch itself, so baseRef only matters when the branch is being created.
 */
export function compileRegistryGitSpec(
  git: WorkspaceConfig['git']
): Result<{ branch: string; baseRef: string; pushBranch: boolean }, { message: string }> {
  switch (git.kind) {
    case 'create-branch':
      return ok({
        branch: git.branchName,
        baseRef:
          git.fromBranch.type === 'remote'
            ? `${git.fromBranch.remote.name}/${git.fromBranch.branch}`
            : git.fromBranch.branch,
        pushBranch: git.pushBranch === true,
      });
    case 'use-branch':
      return ok({ branch: git.branchName, baseRef: git.branchName, pushBranch: false });
    case 'pr-branch':
      return ok({
        branch: git.taskBranch ?? git.headBranch,
        baseRef: git.headBranch,
        pushBranch: git.pushBranch === true && git.taskBranch !== undefined,
      });
    case 'none':
      return err({ message: 'A Git branch is required when creating a worktree.' });
  }
}

function describeCreateWorkspaceError(error: CreateWorkspaceError): string {
  switch (error.type) {
    case 'path-not-found':
      return `Repository path not found: ${error.path}`;
    case 'inspect-failed':
      return error.message;
    case 'immutable-field-mismatch':
      return error.message;
    case 'already-registered':
      return `Path is already registered under a different workspace`;
  }
}
