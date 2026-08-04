import { createHash } from 'node:crypto';
import { ok } from '@emdash/shared';
import { createTestWire } from '@emdash/wire/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import {
  workspaceHostActionsContract,
  type CreateWorktreeAction,
  type WorkspaceHostActionView,
} from '@services/workspace-host-actions/api';
import { describe, expect, it } from 'vitest';
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

describe('createWorkspacePortFromDependency', () => {
  it('returns a directory workspace without submitting a host operation', async () => {
    const submitted: CreateWorktreeAction[] = [];
    const wire = hostWire({ submitted });
    const port = createWorkspacePortFromDependency(wire.client);

    try {
      await expect(
        port.provision({
          workspace: { kind: 'directory', path: directory },
          generatedName: 'emdash-abc',
          runId: 'run-1',
          signal: new AbortController().signal,
        })
      ).resolves.toEqual(ok({ workspace: directory, branchName: null }));
      expect(submitted).toHaveLength(0);
    } finally {
      await wire.dispose();
    }
  });

  it('submits host.createWorktree with the compiled payload and returns the worktree', async () => {
    const submitted: CreateWorktreeAction[] = [];
    const wire = hostWire({ submitted });
    const port = createWorkspacePortFromDependency(wire.client, { pollIntervalMs: 1 });

    try {
      const result = await port.provision({
        workspace: worktreeConfig,
        generatedName: 'emdash abc',
        runId: 'run-1',
        signal: new AbortController().signal,
      });

      expect(submitted).toHaveLength(1);
      const request = submitted[0]!;
      expect(request.verb).toBe('host.createWorktree');
      expect(request.input.operationId).toBe('automation-run:run-1');
      expect(request.input.hostId).toBe('local:local');
      expect(request.input.branchName).toBe('emdash abc');
      expect(request.input.startPoint).toBe('origin/main');
      expect(request.input.fetch).toBe(true);
      expect(request.input.pushRemote).toBeUndefined();
      expect(request.input.preservePatterns).toEqual(['.env*']);
      const repoHash = createHash('sha256').update('/Users/jona/repo').digest('hex').slice(0, 8);
      expect(request.input.worktreePath.segments).toEqual([
        'Users',
        'jona',
        'worktrees',
        `repo-${repoHash}`,
        'emdash-abc',
      ]);

      expect(result).toEqual(
        ok({
          workspace: hostFileRef(LOCAL_HOST_REF, request.input.worktreePath),
          branchName: 'emdash abc',
        })
      );
    } finally {
      await wire.dispose();
    }
  });

  it('forwards the configured push remote for create-branch workspaces', async () => {
    const submitted: CreateWorktreeAction[] = [];
    const wire = hostWire({ submitted });
    const port = createWorkspacePortFromDependency(wire.client, { pollIntervalMs: 1 });

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

      expect(submitted[0]!.input.pushRemote).toBe('origin');
      expect(result.success).toBe(true);
    } finally {
      await wire.dispose();
    }
  });

  it('uses the configured branch and no start point for use-branch workspaces', async () => {
    const submitted: CreateWorktreeAction[] = [];
    const wire = hostWire({ submitted });
    const port = createWorkspacePortFromDependency(wire.client, { pollIntervalMs: 1 });

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

      const request = submitted[0]!;
      expect(request.input.branchName).toBe('feature/x');
      expect(request.input.startPoint).toBeUndefined();
      expect(request.input.fetch).toBeUndefined();
      expect(result.success).toBe(true);
    } finally {
      await wire.dispose();
    }
  });

  it('maps a failed host operation to an automation port error', async () => {
    const wire = hostWire({
      terminal: (operationId) => ({
        operationId,
        status: 'failed',
        updatedAt: 1,
        error: { type: 'git-command-failed', message: 'fatal: branch exists' },
      }),
    });
    const port = createWorkspacePortFromDependency(wire.client, { pollIntervalMs: 1 });

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
        error: { code: 'git-command-failed', message: 'fatal: branch exists' },
      });
    } finally {
      await wire.dispose();
    }
  });

  it('does not submit an operation for an already-aborted run', async () => {
    const submitted: CreateWorktreeAction[] = [];
    const wire = hostWire({ submitted });
    const port = createWorkspacePortFromDependency(wire.client);
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
      expect(submitted).toHaveLength(0);
    } finally {
      await wire.dispose();
    }
  });

  it('returns cancelled when the run aborts while the host operation is in flight', async () => {
    const controller = new AbortController();
    const wire = hostWire({
      terminal: (operationId) => {
        controller.abort();
        return {
          operationId,
          status: 'running',
          updatedAt: 1,
        };
      },
    });
    const port = createWorkspacePortFromDependency(wire.client, { pollIntervalMs: 1 });

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

function hostWire(
  options: {
    submitted?: CreateWorktreeAction[];
    terminal?: (operationId: string) => WorkspaceHostActionView;
  } = {}
) {
  const views = new Map<string, WorkspaceHostActionView>();
  return createTestWire(workspaceHostActionsContract, {
    submitOperation: async (request) => {
      options.submitted?.push(request);
      const operationId = request.input.operationId;
      views.set(
        operationId,
        options.terminal?.(operationId) ?? {
          operationId,
          status: 'succeeded',
          updatedAt: 1,
        }
      );
      return ok({ operationId, kernelOperationId: 'kernel-1' });
    },
    getOperation: async ({ operationId }) => ok(views.get(operationId) ?? null),
    initializeWorkspace: async () => {
      throw new Error('unused');
    },
  });
}
