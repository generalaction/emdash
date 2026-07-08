import { client, connect, createLiveJobReplica, memoryTransportPair, serve } from '@emdash/wire';
import { describe, expect, it } from 'vitest';
import { createWorkspaceLifecycleController } from '../controller';
import { WorkspaceLifecycleManager } from '../manager';
import { step } from '../steps/catalog';
import { createTestRepository } from '../test-utils';
import { workspaceLifecycleContract } from './contract';

describe('workspaceLifecycleContract', () => {
  it('runs a phase job and exposes script output plus lifecycle state', async () => {
    const repo = await createTestRepository();
    const manager = new WorkspaceLifecycleManager({ scriptLogRetainMs: 10_000 });
    const controller = createWorkspaceLifecycleController(manager);
    const pair = memoryTransportPair();
    const stopServing = serve(pair.right, controller);
    const contractClient = client(workspaceLifecycleContract, connect(pair.left));
    try {
      const jobs = createLiveJobReplica(
        workspaceLifecycleContract.runPhase,
        contractClient.runPhase
      );
      const branchName = 'feature/contract';
      await expect(contractClient.capabilities(undefined)).resolves.toMatchObject({
        stepKinds: expect.arrayContaining(['git-fetch', 'create-local-branch', 'remove-worktree']),
      });
      const validated = await contractClient.validatePlan({
        plan: {
          steps: [
            {
              id: 'create-local-branch:1',
              label: 'Create branch',
              step: step('create-local-branch', { branchName, fromRef: 'main' }),
            },
          ],
        },
      });
      expect(validated).toEqual({ success: true, data: { stepCount: 1 } });

      const lease = await jobs.start({
        ref: {
          workspaceId: 'workspace-1',
          repoPath: repo.repoPath,
          branchName,
        },
        phase: 'provision',
        plan: {
          steps: [
            {
              id: 'create-local-branch:1',
              label: 'Create branch',
              step: step('create-local-branch', { branchName, fromRef: 'main' }),
            },
            {
              id: 'run-script:1',
              label: 'Echo',
              step: step('run-script', { id: 'echo', command: 'echo lifecycle', cwd: 'repo' }),
            },
            {
              id: 'add-worktree:1',
              label: 'Create worktree',
              step: step('add-worktree', { branchName }),
            },
          ],
        },
        context: {
          repoPath: repo.repoPath,
          worktreePoolPath: repo.worktreePoolPath,
          baseRemote: 'origin',
          pushRemote: 'origin',
          preservePatterns: [],
        },
      });
      const handle = await lease.ready();

      const result = await handle.result;
      expect(result).toMatchObject({ path: expect.stringContaining('feature-contract') });
      expect(result.report.map((entry) => entry.stepId)).toContain('run-script:1');
      const log = await contractClient.scriptOutput
        .handle({
          jobId: handle.jobId,
          stepId: 'run-script:1',
        })
        .snapshot();
      expect(log.data.text).toContain('lifecycle');

      const state = await contractClient.workspace
        .state({ workspaceId: 'workspace-1' }, 'lifecycle')
        .snapshot();
      expect(state.data).toMatchObject({
        phase: 'provisioned',
        branchCreatedByEmdash: true,
      });
      await lease.release();
      await jobs.dispose();
    } finally {
      stopServing();
      controller.dispose?.();
      manager.dispose();
      await repo.cleanup();
    }
  });

  it('returns a typed unsupported-step rejection', async () => {
    const manager = new WorkspaceLifecycleManager();
    const controller = createWorkspaceLifecycleController(manager);
    const pair = memoryTransportPair();
    const stopServing = serve(pair.right, controller);
    const contractClient = client(workspaceLifecycleContract, connect(pair.left));

    try {
      const result = await contractClient.validatePlan({
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
      stopServing();
      controller.dispose?.();
      manager.dispose();
    }
  });
});
