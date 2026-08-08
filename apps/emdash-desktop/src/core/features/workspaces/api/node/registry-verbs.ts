import crypto from 'node:crypto';
import type { HostRef } from '@emdash/core/primitives/host/api';
import type { CreateWorkspaceError } from '@emdash/core/runtimes/workspace-registry/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { WorktreeGitPlan } from '@core/primitives/workspaces/api';

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
  /** Optional when `gitSetup.fetchBranch` materializes the branch instead. */
  baseRef?: string;
  path: string;
  preservePatterns: string[];
  pushBranch: boolean;
  /** The compiled PR-preset git setup block, passed through to the verb verbatim. */
  gitSetup?: WorktreeGitPlan['gitSetup'];
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
    workspaceId: repositoryId,
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
    workspaceId: spec.workspaceId,
    repositoryId,
    branch: spec.branch,
    ...(spec.baseRef !== undefined && { baseRef: spec.baseRef }),
    path: spec.path,
    preservePatterns: spec.preservePatterns,
    pushBranch: spec.pushBranch,
    ...(spec.gitSetup !== undefined && { gitSetup: spec.gitSetup }),
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
