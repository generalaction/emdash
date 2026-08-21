import { createHash } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it } from 'vitest';
import { LOCAL_HOST_REF } from '#primitives/host/api';
import { hostFileRef, parseAbsolute } from '#primitives/path/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- exercises the port against the registry verb contract it provisions through (operation-log retirement §5)
import {
  workspaceRegistryContract,
  type CreateWorkspaceError,
  type CreateWorkspaceInput,
  type CreateWorktreeError,
  type CreateWorktreeInput,
  type ProjectConfigState,
  type WorkspaceRecord,
  type WorkspaceRecords,
} from '#runtimes/workspace-registry/api';
import type {
  WorkspaceCreationAdmissionContract,
  WorkspaceCreationRefusal,
} from '../../api/creation-admission';
import { createWorkspacePortFromDependency } from './workspace-provisioning';

const directory = absolute('/tmp/workspace');

const worktreeConfig = {
  kind: 'worktree' as const,
  repository: absolute('/Users/jona/repo'),
  worktreePoolPath: parsed('/Users/jona/worktrees/repo-12345678'),
  baseRemote: 'origin',
  preservePatterns: ['.env*'],
  git: {
    kind: 'create-branch' as const,
    fromBranch: { type: 'remote' as const, branch: 'main', remote: { name: 'origin', url: 'x' } },
    pushRemote: null,
  },
};

const repoHash = createHash('sha256').update('/Users/jona/repo').digest('hex').slice(0, 8);
const expectedWorktreePath = `/Users/jona/worktrees/repo-${repoHash}/emdash-abc`;

const emptyProjectConfig: ProjectConfigState = {
  workspaceId: 'test-workspace',
  repositoryId: 'test-workspace',
  resolved: {
    preservePatterns: { value: [], from: 'built-in' },
    autoRunSetup: { value: true, from: 'built-in' },
    autoRunRun: { value: false, from: 'built-in' },
  },
  personalConfig: {},
  sources: {
    preservePatterns: [],
    prepare: [],
    setup: [],
    run: [],
    teardown: [],
    shellSetup: [],
  },
  legacyDesktopSettingsMigrated: true,
};

/** Admission stub recording checks; refuses when a refusal is supplied. */
function admissionStub(refusal?: WorkspaceCreationRefusal) {
  const calls: Array<{ path: string; branch: string }> = [];
  const client: ContractClient<WorkspaceCreationAdmissionContract> = {
    checkWorktreeCreation: async (input) => {
      calls.push(input);
      return refusal ? err(refusal) : ok(undefined);
    },
  };
  return { client, calls };
}

describe('createWorkspacePortFromDependency', () => {
  it('returns a directory workspace without calling the registry', async () => {
    const wire = registryWire();
    const admission = admissionStub();
    const port = createWorkspacePortFromDependency(wire.client, admission.client);

    try {
      await expect(
        port.provision({
          workspace: { kind: 'directory', path: directory },
          generatedName: 'emdash-abc',
          runId: 'run-1',
          signal: new AbortController().signal,
        })
      ).resolves.toEqual(ok({ workspace: directory, branchName: null }));
      expect(wire.calls.createWorkspace).toHaveLength(0);
      expect(wire.calls.createWorktree).toHaveLength(0);
      // Nothing is created at a path or branch, so nothing is admitted either.
      expect(admission.calls).toHaveLength(0);
    } finally {
      await wire.dispose();
    }
  });

  describe('creation admission (ADR 0006)', () => {
    it('checks the compiled worktree path and branch before touching the registry', async () => {
      const wire = registryWire();
      const admission = admissionStub();
      const port = createWorkspacePortFromDependency(wire.client, admission.client);

      try {
        const result = await port.provision({
          workspace: worktreeConfig,
          generatedName: 'emdash-abc',
          runId: 'run-admit',
          signal: new AbortController().signal,
        });

        expect(result.success).toBe(true);
        expect(admission.calls).toEqual([{ path: expectedWorktreePath, branch: 'emdash-abc' }]);
      } finally {
        await wire.dispose();
      }
    });

    it('refuses a tombstone-pending path or branch as the run failure, registry untouched', async () => {
      const wire = registryWire();
      const admission = admissionStub({
        type: 'workspace-tombstone-pending',
        workspaceId: 'ws-held',
        message: 'A deletion is still pending at the requested path.',
      });
      const port = createWorkspacePortFromDependency(wire.client, admission.client);

      try {
        await expect(
          port.provision({
            workspace: worktreeConfig,
            generatedName: 'emdash-abc',
            runId: 'run-refused',
            signal: new AbortController().signal,
          })
        ).resolves.toEqual({
          success: false,
          error: {
            code: 'workspace-tombstone-pending',
            message: 'A deletion is still pending at the requested path.',
          },
        });
        // The refusal happens before any registry mutation — no repository
        // registration and no createWorktree.
        expect(wire.calls.createWorkspace).toHaveLength(0);
        expect(wire.calls.createWorktree).toHaveLength(0);
      } finally {
        await wire.dispose();
      }
    });
  });

  it('registers the repository and awaits createWorktree with the compiled payload', async () => {
    const wire = registryWire();
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);

    try {
      const result = await port.provision({
        workspace: worktreeConfig,
        generatedName: 'emdash abc',
        runId: 'run-1',
        signal: new AbortController().signal,
      });

      expect(wire.calls.createWorkspace).toHaveLength(1);
      expect(wire.calls.createWorkspace[0]!.path).toBe('/Users/jona/repo');

      expect(wire.calls.createWorktree).toHaveLength(1);
      const request = wire.calls.createWorktree[0]!;
      expect(request.workspaceId).toBe('run-1');
      expect(request.repositoryId).toBe(wire.calls.createWorkspace[0]!.workspaceId);
      expect(request.branch).toBe('emdash abc');
      expect(request.baseRef).toBe('origin/main');
      expect(request.publish).toBeUndefined();
      expect(request.preservePatterns).toEqual(['.env*']);
      expect(request.path).toBe(`/Users/jona/worktrees/repo-${repoHash}/emdash-abc`);

      expect(result).toEqual(
        ok({
          workspace: hostFileRef(LOCAL_HOST_REF, parsed(request.path)),
          branchName: 'emdash abc',
        })
      );
    } finally {
      await wire.dispose();
    }
  });

  it('adopts a repository record that is already registered under another id', async () => {
    const wire = registryWire({
      createWorkspace: (input) => ok(stubRecord('repo-existing', input.path, 'repository')),
    });
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);

    try {
      const result = await port.provision({
        workspace: worktreeConfig,
        generatedName: 'emdash-abc',
        runId: 'run-adopt',
        signal: new AbortController().signal,
      });

      expect(wire.calls.createWorktree[0]!.repositoryId).toBe('repo-existing');
      expect(result.success).toBe(true);
    } finally {
      await wire.dispose();
    }
  });

  it('requests a branch push when the workspace configures a push remote', async () => {
    const wire = registryWire();
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);

    try {
      const result = await port.provision({
        workspace: {
          ...worktreeConfig,
          git: { ...worktreeConfig.git, pushRemote: 'origin' },
        },
        generatedName: 'emdash-abc',
        runId: 'run-push',
        signal: new AbortController().signal,
      });

      expect(wire.calls.createWorktree[0]!.publish).toEqual({ remote: 'origin' });
      expect(result.success).toBe(true);
    } finally {
      await wire.dispose();
    }
  });

  it('uses the configured branch as its own base ref for use-branch workspaces', async () => {
    const wire = registryWire();
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);

    try {
      const result = await port.provision({
        workspace: {
          ...worktreeConfig,
          git: { kind: 'use-branch', branchName: 'feature/x' },
        },
        generatedName: 'emdash-abc',
        runId: 'run-2',
        signal: new AbortController().signal,
      });

      const request = wire.calls.createWorktree[0]!;
      expect(request.branch).toBe('feature/x');
      expect(request.baseRef).toBe('feature/x');
      expect(request.publish).toBeUndefined();
      expect(result.success).toBe(true);
    } finally {
      await wire.dispose();
    }
  });

  it('lands the failed stage and message on the port error', async () => {
    const wire = registryWire({
      createWorktree: () =>
        err({
          type: 'stage-failed' as const,
          stage: 'add-worktree',
          message: 'fatal: branch exists',
        }),
    });
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);

    try {
      await expect(
        port.provision({
          workspace: worktreeConfig,
          generatedName: 'emdash-abc',
          runId: 'run-3',
          signal: new AbortController().signal,
        })
      ).resolves.toEqual({
        success: false,
        error: { code: 'add-worktree', message: 'fatal: branch exists' },
      });
    } finally {
      await wire.dispose();
    }
  });

  it('maps a repository registration failure to a port error', async () => {
    const wire = registryWire({
      createWorkspace: (input) => err({ type: 'path-not-found' as const, path: input.path }),
    });
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);

    try {
      await expect(
        port.provision({
          workspace: worktreeConfig,
          generatedName: 'emdash-abc',
          runId: 'run-repo-missing',
          signal: new AbortController().signal,
        })
      ).resolves.toEqual({
        success: false,
        error: { code: 'path-not-found', message: 'Repository path not found: /Users/jona/repo' },
      });
      expect(wire.calls.createWorktree).toHaveLength(0);
    } finally {
      await wire.dispose();
    }
  });

  it('does not call the registry for an already-aborted run', async () => {
    const wire = registryWire();
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(
        port.provision({
          workspace: worktreeConfig,
          generatedName: 'emdash-abc',
          runId: 'run-4',
          signal: controller.signal,
        })
      ).resolves.toEqual({
        success: false,
        error: { code: 'cancelled', message: 'Workspace provisioning was cancelled' },
      });
      expect(wire.calls.createWorkspace).toHaveLength(0);
      expect(wire.calls.createWorktree).toHaveLength(0);
    } finally {
      await wire.dispose();
    }
  });

  it('cancels an in-flight createWorktree when the run aborts', async () => {
    const controller = new AbortController();
    let resolveHandlerAborted: () => void;
    const handlerAborted = new Promise<void>((resolve) => {
      resolveHandlerAborted = resolve;
    });
    const wire = registryWire({
      createWorktree: (_input, meta) =>
        new Promise((resolve) => {
          meta.signal?.addEventListener(
            'abort',
            () => {
              resolveHandlerAborted();
              resolve(err({ type: 'stage-failed' as const, stage: 'inspect', message: 'aborted' }));
            },
            { once: true }
          );
          controller.abort();
        }),
    });
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);

    try {
      await expect(
        port.provision({
          workspace: worktreeConfig,
          generatedName: 'emdash-abc',
          runId: 'run-5',
          signal: controller.signal,
        })
      ).resolves.toEqual({
        success: false,
        error: { code: 'cancelled', message: 'Workspace provisioning was cancelled' },
      });
      // The cancellation must reach the RPC handler over the wire, not just stop waiting.
      await handlerAborted;
    } finally {
      await wire.dispose();
    }
  });

  it('replays a failed run with the identical create id and spec', async () => {
    let attempt = 0;
    const wire = registryWire({
      createWorktree: (input) => {
        attempt += 1;
        if (attempt === 1) {
          return err({ type: 'stage-failed' as const, stage: 'fetch', message: 'network down' });
        }
        return ok(stubRecord(input.workspaceId, input.path, 'worktree'));
      },
    });
    const port = createWorkspacePortFromDependency(wire.client, admissionStub().client);
    const provision = () =>
      port.provision({
        workspace: worktreeConfig,
        generatedName: 'emdash-abc',
        runId: 'run-replay',
        signal: new AbortController().signal,
      });

    try {
      const first = await provision();
      expect(first).toEqual({
        success: false,
        error: { code: 'fetch', message: 'network down' },
      });

      const second = await provision();
      expect(second.success).toBe(true);

      // Replay safety: the same run id resubmits the same record id with an identical
      // spec, so the verb's replay semantics (no-op or re-execute) apply instead of a
      // duplicate creation.
      expect(wire.calls.createWorktree).toHaveLength(2);
      expect(wire.calls.createWorktree[1]).toEqual(wire.calls.createWorktree[0]);
      expect(wire.calls.createWorktree[0]!.workspaceId).toBe('run-replay');
      expect(wire.calls.createWorktree[0]!.path).toBe(expectedWorktreePath);
    } finally {
      await wire.dispose();
    }
  });
});

function absolute(input: string) {
  return hostFileRef(LOCAL_HOST_REF, parsed(input));
}

function parsed(input: string) {
  const result = parseAbsolute(input);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

function stubRecord(id: string, path: string, kind: 'repository' | 'worktree'): WorkspaceRecord {
  return {
    id,
    kind,
    path,
    parentId: null,
    origin: 'registered',
    gitAdminName: null,
    observedStatus: 'present',
    creation: null,
    lastCreateOutcome: null,
    lifecycle: null,
    lastRemovalAttempt: null,
    git: null,
    lastActivatedAt: null,
    createdAt: 0,
    updatedAt: 0,
    lastObservedAt: 0,
    config: null,
    runtime: null,
  };
}

function registryWire(
  options: {
    createWorkspace?: (
      input: CreateWorkspaceInput
    ) => Result<WorkspaceRecord, CreateWorkspaceError>;
    createWorktree?: (
      input: CreateWorktreeInput,
      meta: { signal?: AbortSignal }
    ) =>
      | Result<WorkspaceRecord, CreateWorktreeError>
      | Promise<Result<WorkspaceRecord, CreateWorktreeError>>;
  } = {}
) {
  const calls: {
    createWorkspace: CreateWorkspaceInput[];
    createWorktree: CreateWorktreeInput[];
  } = { createWorkspace: [], createWorktree: [] };
  // Mirrors canonical registration: the first id owns the path and every later
  // registration receives that same record as ordinary success.
  const byPath = new Map<string, WorkspaceRecord>();

  const wire = createTestWire(workspaceRegistryContract, {
    records: expose(workspaceRegistryContract.records, {
      list: () => cell<WorkspaceRecords>({}, { name: 'test-records' }),
    }),
    projectConfig: expose(workspaceRegistryContract.projectConfig, {
      current: () => cell(emptyProjectConfig, { name: 'test-project-config' }),
    }),
    createWorkspace: async (input) => {
      calls.createWorkspace.push(input);
      if (options.createWorkspace) return options.createWorkspace(input);
      const existing = byPath.get(input.path);
      const record = existing ?? stubRecord(input.workspaceId, input.path, 'repository');
      byPath.set(input.path, record);
      return ok(record);
    },
    createWorktree: async (input, meta) => {
      calls.createWorktree.push(input);
      if (options.createWorktree) return await options.createWorktree(input, meta);
      return ok(stubRecord(input.workspaceId, input.path, 'worktree'));
    },
    activateWorkspace: async () => {
      throw new Error('unused');
    },
    deactivateWorkspace: async () => {
      throw new Error('unused');
    },
    deleteWorkspace: async () => {
      throw new Error('unused');
    },
    deleteWorktree: async () => {
      throw new Error('unused');
    },
    refresh: async () => {
      throw new Error('unused');
    },
  });

  return { ...wire, calls };
}
