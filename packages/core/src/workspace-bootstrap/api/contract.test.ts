import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  client as createWireClient,
  connect,
  createLiveJobReplica,
  memoryTransportPair,
  serve,
} from '@emdash/wire';
import { describe, expect, it } from 'vitest';
import { createWorkspaceBootstrapController } from '../controller';
import { compileBootstrapPlan } from '../plan/planner';
import { createTestRepository } from '../test-utils';
import { workspaceBootstrapContract } from './contract';
import type { BootstrapInput, BootstrapProgress } from './schemas';

describe('workspaceBootstrapContract', () => {
  it('validates and runs a bootstrap job over wire', async () => {
    const repo = await createTestRepository();
    const pair = memoryTransportPair();
    const controller = createWorkspaceBootstrapController();
    const stopServing = serve(pair.right, controller);
    const wireClient = createWireClient(workspaceBootstrapContract, connect(pair.left));
    const jobs = createLiveJobReplica(workspaceBootstrapContract.bootstrap, wireClient.bootstrap);

    try {
      await writeFile(path.join(repo.repoPath, '.env.local'), 'TOKEN=wire\n');
      const plan = compileBootstrapPlan(
        {
          kind: 'create-branch',
          branchName: 'task/wire',
          fromBranch: { type: 'local', branch: 'main' },
        },
        {
          repoPath: repo.repoPath,
          worktreePoolPath: repo.worktreePoolPath,
          baseRemote: 'origin',
          pushRemote: 'origin',
          preservePatterns: ['.env.local'],
        }
      );
      const input: BootstrapInput = {
        plan,
        context: {
          repoPath: repo.repoPath,
          worktreePoolPath: repo.worktreePoolPath,
          baseRemote: 'origin',
          pushRemote: 'origin',
          preservePatterns: ['.env.local'],
        },
      };

      await expect(wireClient.capabilities(undefined)).resolves.toMatchObject({
        stepKinds: expect.arrayContaining(['git-fetch', 'create-local-branch', 'remove-worktree']),
      });

      const validated = await wireClient.validatePlan({ plan });
      expect(validated).toEqual({ success: true, data: { stepCount: 4 } });
      expect(plan.steps.map((entry) => entry.step.kind)).toEqual([
        'create-local-branch',
        'set-branch-base',
        'add-worktree',
        'copy-preserved-files',
      ]);

      const lease = await jobs.start(input);
      const handle = await lease.ready();
      const progress: BootstrapProgress[] = [];
      handle.onProgress((entry) => progress.push(entry));

      const result = await handle.result;
      expect(result.path).toBe(path.join(repo.worktreePoolPath, 'task-wire'));
      expect(result.warnings).toEqual([]);
      expect(result.report.map((entry) => entry.kind)).toEqual([
        'create-local-branch',
        'set-branch-base',
        'add-worktree',
        'copy-preserved-files',
      ]);
      expect(handle.getState()?.status).toBe('succeeded');
      expect(handle.getState()?.progress.length).toBeGreaterThan(0);
      await expect(
        readFile(path.join(repo.worktreePoolPath, 'task-wire', '.env.local'), 'utf8')
      ).resolves.toBe('TOKEN=wire\n');
      await lease.release();
    } finally {
      await jobs.dispose();
      controller.dispose?.();
      stopServing();
      await repo.cleanup();
    }
  });

  it('returns a typed unsupported-step rejection', async () => {
    const pair = memoryTransportPair();
    const controller = createWorkspaceBootstrapController();
    const stopServing = serve(pair.right, controller);
    const wireClient = createWireClient(workspaceBootstrapContract, connect(pair.left));

    try {
      const result = await wireClient.validatePlan({
        plan: {
          steps: [
            {
              id: 'future-step:1',
              label: 'Future step',
              step: { kind: 'future-step', args: {} },
            },
          ],
        },
      });

      expect(result).toEqual({
        success: false,
        error: {
          type: 'unsupported-step',
          kind: 'future-step',
          message: 'Unsupported bootstrap step "future-step"',
        },
      });
    } finally {
      controller.dispose?.();
      stopServing();
    }
  });
});
