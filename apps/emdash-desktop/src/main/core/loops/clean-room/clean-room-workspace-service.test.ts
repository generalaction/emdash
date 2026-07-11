import { err, ok, type Result } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { CopyPreservedFilesError } from '@main/core/projects/worktrees/worktree-service';
import type { MachineRef, RuntimeManager } from '@main/core/runtime/types';
import type { Workspace } from '@main/core/workspaces/workspace';
import type { WorkspaceType } from '@main/core/workspaces/workspace-factory';
import type {
  LifecycleStartupError,
  LifecycleStartupReady,
} from '@main/core/workspaces/workspace-lifecycle-service';
import type { WorkspaceRegistry } from '@main/core/workspaces/workspace-registry';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';
import {
  CleanRoomWorkspaceService,
  type CleanRoomProject,
  type CleanRoomWorkspaceServiceDependencies,
} from './clean-room-workspace-service';
import type { FeatureSnapshot, FeatureSnapshotError } from './feature-snapshot-service';

vi.mock('@main/core/workspaces/workspace-factory', () => ({
  createWorkspaceFactory: vi.fn(),
}));
vi.mock('@main/core/runtime/runtime-manager', () => ({ runtimeManager: {} }));

const BASE = '1'.repeat(40);
const FEATURE = '2'.repeat(40);
const REPLAYED = '3'.repeat(40);

function machineEqual(left: MachineRef, right: MachineRef): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'local' || (right.kind === 'ssh' && left.connectionId === right.connectionId))
  );
}

function makeHarness(
  options: {
    machine?: MachineRef;
    featureMachine?: MachineRef;
    startupResult?: Result<LifecycleStartupReady, LifecycleStartupError>;
    preserveResult?: Result<{ copied: string[] }, CopyPreservedFilesError>;
    replayResult?: Result<{ replayedThroughCommit: string }, FeatureSnapshotError>;
    fixAttestationResult?: Result<FeatureSnapshot, FeatureSnapshotError>;
    acquireReject?: boolean;
    factoryThrow?: boolean;
    startupReject?: boolean;
    createReject?: boolean;
    preserveReject?: boolean;
  } = {}
) {
  const order: string[] = [];
  let branchExists = false;
  let worktreeExists = false;
  const machine = options.machine ?? ({ kind: 'local' } satisfies MachineRef);
  const featureMachine = options.featureMachine ?? machine;
  const executionContext: IExecutionContext = {
    root: '/project',
    supportsLocalSpawn: machine.kind === 'local',
    exec: vi.fn(async (_command, args = []) => {
      if (args[0] === 'for-each-ref') {
        return {
          stdout: branchExists ? `${String(args[2])}\n` : '',
          stderr: '',
        };
      }
      if (args[0] === 'branch') {
        order.push('delete-branch');
        branchExists = false;
      }
      return { stdout: '', stderr: '' };
    }),
    execStreaming: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const worktreeService = {
    createWorktreeAtCommit: vi.fn(async (_commit: string, branch: string) => {
      order.push('create-worktree');
      if (options.createReject) throw new Error('create rejected');
      branchExists = true;
      worktreeExists = true;
      return ok(`/pool/${branch}`);
    }),
    copyPreservedFilesToWorktree: vi.fn(async () => {
      order.push('copy-preserves');
      if (options.preserveReject) throw new Error('preserve rejected');
      return options.preserveResult ?? ok({ copied: ['.env.local'] });
    }),
    removeGeneratedWorktreeIfPresent: vi.fn(
      async (): Promise<
        Result<{ removed: boolean }, { type: 'worktree-remove-failed'; message: string }>
      > => {
        order.push('remove-worktree');
        worktreeExists = false;
        return ok({ removed: true });
      }
    ),
    existsAtAbsolutePath: vi.fn(async () => worktreeExists),
  };
  const snapshot = {
    baseCommit: BASE,
    expectedFeatureHead: FEATURE,
    replayCommits: [FEATURE],
  };
  const snapshotService = {
    capture: vi.fn(
      async (input: { featurePath: string; baseCommit: string; expectedFeatureHead: string }) => {
        order.push('capture');
        if (input.featurePath.startsWith('/pool/')) {
          return (
            options.fixAttestationResult ??
            ok({
              baseCommit: input.baseCommit,
              expectedFeatureHead: input.expectedFeatureHead,
              replayCommits: [input.expectedFeatureHead],
            })
          );
        }
        return ok(snapshot);
      }
    ),
    replay: vi.fn(async () => {
      order.push('replay');
      return options.replayResult ?? ok({ replayedThroughCommit: REPLAYED });
    }),
    integrateFix: vi.fn(async () => ok({ featureHead: '4'.repeat(40) })),
  };
  const waitForRequiredStartup = vi.fn(async () => {
    order.push('startup-ready');
    if (options.startupReject) throw new Error('startup rejected');
    return options.startupResult ?? ok({ setup: 'succeeded', run: 'running', preview: 'ready' });
  });
  const factoryContext: unknown[] = [];
  const createWorkspaceFactory = vi.fn((workspaceId, _type, context) => {
    order.push('factory');
    if (options.factoryThrow) throw new Error('factory failed');
    factoryContext.push(context);
    return async () => ({
      workspace: {
        id: workspaceId,
        path: context.workDir,
        lifecycleService: { waitForRequiredStartup },
      } as unknown as Workspace,
    });
  });
  const registry = {
    acquire: vi.fn(async (_key, _projectId, factory) => {
      order.push('acquire');
      if (options.acquireReject) throw new Error('acquire failed');
      return factory();
    }),
    teardown: vi.fn(async () => {
      order.push('teardown');
    }),
  };
  const type =
    machine.kind === 'local'
      ? ({ kind: 'local' } satisfies WorkspaceType)
      : ({
          kind: 'ssh',
          connectionId: machine.connectionId,
          proxy: {} as Extract<WorkspaceType, { kind: 'ssh' }>['proxy'],
        } satisfies WorkspaceType);
  const project = {
    projectId: 'project-1',
    repoPath: '/project',
    ctx: executionContext,
    defaultWorkspaceMachine: machine,
    defaultWorkspaceType: type,
    worktreeService,
    settings: {
      get: vi.fn(async () => ({})),
      getDefaultBranch: vi.fn(async () => 'main'),
    },
    gitRepository: {},
    gitRepositoryFetchService: {},
  } as unknown as CleanRoomProject;
  const runtimeManager = { acquire: vi.fn() } as unknown as Pick<RuntimeManager, 'acquire'>;
  const dependencies = {
    createWorkspaceFactory,
    workspaceRegistry: registry as unknown as Pick<WorkspaceRegistry, 'acquire' | 'teardown'>,
    runtimeManager,
    createFeatureSnapshotService: vi.fn(() => snapshotService),
    createId: () => 'fixed',
  } satisfies CleanRoomWorkspaceServiceDependencies;
  const featureTarget: LoopSessionTarget = {
    workspaceId: 'feature-workspace',
    path: '/feature',
    machine: featureMachine,
  };
  const input = {
    verificationRunId: 'verification-1',
    attempt: 1,
    task: { id: 'task-1', name: 'Task one' },
    project,
    featureTarget,
    baseCommit: BASE,
    expectedFeatureHead: FEATURE,
    requirePreview: true,
  };

  return {
    service: new CleanRoomWorkspaceService(dependencies),
    input,
    project,
    featureTarget,
    order,
    factoryContext,
    registry,
    worktreeService,
    snapshotService,
    waitForRequiredStartup,
    runtimeManager,
    executionContext,
  };
}

describe('CleanRoomWorkspaceService', () => {
  it('creates at the frozen base, replays, preserves, acquires, and awaits readiness in order', async () => {
    const harness = makeHarness();

    const result = await harness.service.create(harness.input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected clean room');
    expect(harness.order).toEqual([
      'capture',
      'create-worktree',
      'replay',
      'copy-preserves',
      'factory',
      'acquire',
      'startup-ready',
    ]);
    expect(result.data.target).toEqual({
      workspaceId: 'loop-verify-fixed',
      path: '/pool/emdash/loop-verify-fixed',
      machine: { kind: 'local' },
    });
    expect(result.data.baseCommit).toBe(BASE);
    expect(result.data.expectedFeatureHead).toBe(FEATURE);
    expect(result.data.replayedThroughCommit).toBe(REPLAYED);
    expect(harness.factoryContext[0]).toMatchObject({
      workspaceRuntime: { manager: harness.runtimeManager },
    });
  });

  it('preserves project-SSH machine identity through workspace acquisition', async () => {
    const machine = { kind: 'ssh', connectionId: 'ssh-project-1' } satisfies MachineRef;
    const harness = makeHarness({ machine });

    const result = await harness.service.create(harness.input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected clean room');
    expect(machineEqual(result.data.target.machine, machine)).toBe(true);
    expect(harness.factoryContext[0]).toMatchObject({
      workspaceRuntime: { machine },
      strictStartup: { requirePreview: true },
    });
  });

  it('blocks BYOI/foreign-machine verification without immutable same-machine capability', async () => {
    const harness = makeHarness({
      machine: { kind: 'local' },
      featureMachine: { kind: 'ssh', connectionId: 'task:byoi-1' },
    });

    await expect(harness.service.preflight(harness.input)).resolves.toEqual({
      success: false,
      error: {
        type: 'unsupported-clean-room',
        message:
          'This workspace provider cannot create an immutable clean room on the task machine.',
      },
    });
    expect(harness.worktreeService.createWorktreeAtCommit).not.toHaveBeenCalled();
  });

  it('destroys the partial worktree when strict preserves fail', async () => {
    const harness = makeHarness({
      preserveResult: err({
        type: 'preserve-copy-failed',
        pattern: '.env.local',
        message: 'Required preserve pattern could not be copied.',
      }),
    });

    const result = await harness.service.create(harness.input);

    expect(result).toMatchObject({
      success: false,
      error: { type: 'preserve-failed' },
    });
    expect(harness.order).toEqual([
      'capture',
      'create-worktree',
      'replay',
      'copy-preserves',
      'remove-worktree',
      'delete-branch',
    ]);
    expect(harness.registry.teardown).not.toHaveBeenCalled();
  });

  it('returns a typed worktree error when provider creation rejects before returning a path', async () => {
    const harness = makeHarness({ createReject: true });

    await expect(harness.service.create(harness.input)).resolves.toEqual({
      success: false,
      error: {
        type: 'worktree-create-failed',
        message: 'Failed to create clean-room worktree.',
      },
    });
    expect(harness.worktreeService.removeGeneratedWorktreeIfPresent).not.toHaveBeenCalled();
  });

  it('cleans the generated worktree when strict preserve evaluation rejects', async () => {
    const harness = makeHarness({ preserveReject: true });

    const result = await harness.service.create(harness.input);

    expect(result).toMatchObject({ success: false, error: { type: 'preserve-failed' } });
    expect(harness.order.slice(-2)).toEqual(['remove-worktree', 'delete-branch']);
  });

  it('tears down the acquired workspace before removing it when startup fails', async () => {
    const harness = makeHarness({
      startupResult: err({
        type: 'preview-timeout',
        stage: 'preview',
        message: 'Preview did not become ready before the timeout.',
      }),
    });

    const result = await harness.service.create(harness.input);

    expect(result).toMatchObject({ success: false, error: { type: 'startup-failed' } });
    expect(harness.order.slice(-4)).toEqual([
      'startup-ready',
      'teardown',
      'remove-worktree',
      'delete-branch',
    ]);
  });

  it.each([
    { label: 'factory failure', options: { factoryThrow: true } },
    { label: 'acquire failure', options: { acquireReject: true } },
    { label: 'startup rejection', options: { startupReject: true } },
  ])('cleans all generated resources after $label', async ({ options }) => {
    const harness = makeHarness(options);

    const result = await harness.service.create(harness.input);

    expect(result.success).toBe(false);
    expect(harness.order).toContain('teardown');
    expect(harness.order.slice(-2)).toEqual(['remove-worktree', 'delete-branch']);
  });

  it('cleans a replay failure before workspace acquisition', async () => {
    const harness = makeHarness({
      replayResult: err({
        type: 'replay-conflict',
        commit: FEATURE,
        message: 'The reviewed checkpoint range could not be replayed cleanly.',
      }),
    });

    const result = await harness.service.create(harness.input);

    expect(result).toMatchObject({ success: false, error: { type: 'replay-failed' } });
    expect(harness.order.slice(-2)).toEqual(['remove-worktree', 'delete-branch']);
    expect(harness.registry.acquire).not.toHaveBeenCalled();
  });

  it('integrates a fix only through the optimistic snapshot guard', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');

    const integrated = await harness.service.integrateFix({
      cleanRoom: created.data,
      featureTarget: harness.featureTarget,
      expectedFeatureHead: FEATURE,
      fixCommit: '5'.repeat(40),
      project: harness.project,
    });

    expect(integrated).toEqual({ success: true, data: { featureHead: '4'.repeat(40) } });
    expect(harness.snapshotService.capture).toHaveBeenLastCalledWith({
      featurePath: '/pool/emdash/loop-verify-fixed',
      baseCommit: FEATURE,
      expectedFeatureHead: '5'.repeat(40),
    });
    expect(harness.snapshotService.integrateFix).toHaveBeenCalledWith({
      featurePath: '/feature',
      expectedFeatureHead: FEATURE,
      fixCommit: '5'.repeat(40),
    });
  });

  it('cannot repurpose a clean-room handle for another expected checkpoint', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.snapshotService.capture.mockClear();

    const result = await harness.service.integrateFix({
      cleanRoom: created.data,
      featureTarget: harness.featureTarget,
      expectedFeatureHead: '6'.repeat(40),
      fixCommit: '5'.repeat(40),
      project: harness.project,
    });

    expect(result).toMatchObject({ success: false, error: { type: 'fix-integration-failed' } });
    expect(harness.snapshotService.capture).not.toHaveBeenCalled();
    expect(harness.snapshotService.integrateFix).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'uncommitted correction files',
      error: {
        type: 'feature-workspace-dirty' as const,
        message: 'Feature workspace must be clean.',
      },
    },
    {
      label: 'a fix commit not checked out in the clean room',
      error: {
        type: 'feature-head-drift' as const,
        expected: '5'.repeat(40),
        actual: FEATURE,
      },
    },
  ])('fails fix integration for $label', async ({ error }) => {
    const harness = makeHarness({ fixAttestationResult: err(error) });
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');

    const result = await harness.service.integrateFix({
      cleanRoom: created.data,
      featureTarget: harness.featureTarget,
      expectedFeatureHead: FEATURE,
      fixCommit: '5'.repeat(40),
      project: harness.project,
    });

    expect(result).toMatchObject({ success: false, error: { type: 'fix-integration-failed' } });
    expect(harness.snapshotService.integrateFix).not.toHaveBeenCalled();
  });

  it('fully destroys before recreating from the frozen base', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;

    const recreated = await harness.service.recreate(created.data, harness.input);

    expect(recreated.success).toBe(true);
    if (!recreated.success) throw new Error('expected recreation');
    expect(recreated.data.target.workspaceId).toBe('loop-verify-fixed-2');
    expect(recreated.data.branchName).toBe('emdash/loop-verify-fixed-2');
    expect(harness.order.slice(0, 3)).toEqual(['teardown', 'remove-worktree', 'delete-branch']);
    expect(harness.order.slice(3)).toEqual([
      'capture',
      'create-worktree',
      'replay',
      'copy-preserves',
      'factory',
      'acquire',
      'startup-ready',
    ]);

    harness.order.length = 0;
    await expect(harness.service.destroy(recreated.data, harness.project)).resolves.toEqual(ok());
    expect(harness.order).toEqual(['teardown', 'remove-worktree', 'delete-branch']);
  });

  it('coalesces concurrent destroy calls and performs each cleanup step exactly once', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;

    await Promise.all([
      harness.service.destroy(created.data, harness.project),
      harness.service.destroy(created.data, harness.project),
    ]);

    expect(harness.order).toEqual(['teardown', 'remove-worktree', 'delete-branch']);
  });

  it('retries only an incomplete cleanup step without re-running completed teardown', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    harness.worktreeService.removeGeneratedWorktreeIfPresent.mockImplementationOnce(async () => {
      harness.order.push('remove-worktree');
      return err({ type: 'worktree-remove-failed', message: 'busy' });
    });

    await expect(harness.service.destroy(created.data, harness.project)).resolves.toMatchObject({
      success: false,
      error: { type: 'cleanup-failed' },
    });
    expect(harness.order).toEqual(['teardown', 'remove-worktree']);
    await expect(harness.service.destroy(created.data, harness.project)).resolves.toEqual(ok());

    expect(harness.registry.teardown).toHaveBeenCalledTimes(1);
    expect(harness.worktreeService.removeGeneratedWorktreeIfPresent).toHaveBeenCalledTimes(2);
  });

  it('does not remove a worktree until a failed workspace teardown succeeds on retry', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    harness.registry.teardown.mockImplementationOnce(async () => {
      harness.order.push('teardown');
      throw new Error('teardown busy');
    });

    await expect(harness.service.destroy(created.data, harness.project)).resolves.toMatchObject({
      success: false,
      error: { type: 'cleanup-failed' },
    });
    expect(harness.order).toEqual(['teardown']);

    await expect(harness.service.destroy(created.data, harness.project)).resolves.toEqual(ok());
    expect(harness.order).toEqual(['teardown', 'teardown', 'remove-worktree', 'delete-branch']);
  });
});
