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
  type CleanRoomSourceCapability,
  type CleanRoomWorkspaceServiceDependencies,
} from './clean-room-workspace-service';
import {
  createInMemoryCleanRoomCleanupJournal,
  type CleanRoomCleanupJournal,
} from './cleanup-journal';
import type { FeatureSnapshot, FeatureSnapshotError } from './feature-snapshot-service';

vi.mock('@main/core/workspaces/workspace-factory', () => ({
  createWorkspaceFactory: vi.fn(),
}));
vi.mock('@main/core/runtime/runtime-manager', () => ({ runtimeManager: {} }));

const BASE = '1'.repeat(40);
const FEATURE = '2'.repeat(40);
const REPLAYED = FEATURE;

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
    sourceCapability?: CleanRoomSourceCapability;
    startupResult?: Result<LifecycleStartupReady, LifecycleStartupError>;
    preserveResult?: Result<{ copied: string[] }, CopyPreservedFilesError>;
    replayResult?: Result<{ replayedThroughCommit: string }, FeatureSnapshotError>;
    fixAttestationResult?: Result<FeatureSnapshot, FeatureSnapshotError>;
    acquireReject?: boolean;
    factoryThrow?: boolean;
    startupReject?: boolean;
    createReject?: boolean;
    createAmbiguousActor?: boolean;
    preserveReject?: boolean;
    afterCapture?: () => void;
    cleanupJournal?: CleanRoomCleanupJournal;
  } = {}
) {
  const order: string[] = [];
  let branchHead: string | null = null;
  let worktreeExists = false;
  let actorBytes: string | undefined;
  const machine = options.machine ?? ({ kind: 'local' } satisfies MachineRef);
  const featureMachine = options.featureMachine ?? machine;
  const sourceCapability =
    options.sourceCapability ??
    ({
      kind: 'immutable-same-machine-git-worktree',
      projectId: 'project-1',
      machine: featureMachine,
    } satisfies CleanRoomSourceCapability);
  const executionContext: IExecutionContext = {
    root: '/project',
    supportsLocalSpawn: machine.kind === 'local',
    exec: vi.fn(async (_command, args = []) => {
      if (args[0] === 'for-each-ref') {
        if (args[1] === '--format=%(objectname)') {
          return {
            stdout: branchHead ? `${branchHead}\n` : '',
            stderr: '',
          };
        }
        return {
          stdout: branchHead ? `${String(args[2])}\n` : '',
          stderr: '',
        };
      }
      if (args[0] === 'update-ref' && args[1] === '-d') {
        if (branchHead && branchHead !== args[3]) throw new Error('branch CAS lost');
        order.push('delete-branch');
        branchHead = null;
      }
      if (args[0] === 'branch') {
        order.push('delete-branch');
        branchHead = null;
      }
      return { stdout: '', stderr: '' };
    }),
    execStreaming: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const worktreeService = {
    resolveGeneratedWorktreePath: vi.fn(async (branch: string) => ok(`/pool/${branch}`)),
    attestGeneratedWorktree: vi.fn(async () => ok()),
    createWorktreeAtCommit: vi.fn(async (_commit: string, branch: string) => {
      order.push('create-worktree');
      if (options.createReject) throw new Error('create rejected');
      if (options.createAmbiguousActor) {
        branchHead = BASE;
        worktreeExists = true;
        actorBytes = 'actor bytes';
        return err({
          type: 'worktree-rollback-incomplete' as const,
          message: 'Generated worktree ownership was ambiguous after creation failed.',
        });
      }
      branchHead = BASE;
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
        const removed = worktreeExists;
        worktreeExists = false;
        return ok({ removed });
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
        options.afterCapture?.();
        return ok(snapshot);
      }
    ),
    replay: vi.fn(async () => {
      order.push('replay');
      const result = options.replayResult ?? ok({ replayedThroughCommit: REPLAYED });
      if (result.success) branchHead = result.data.replayedThroughCommit;
      return result;
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
  const cleanupJournal = options.cleanupJournal ?? createInMemoryCleanRoomCleanupJournal();
  const dependencies = {
    createWorkspaceFactory,
    workspaceRegistry: registry as unknown as Pick<WorkspaceRegistry, 'acquire' | 'teardown'>,
    runtimeManager,
    cleanupJournal,
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
    sourceCapability,
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
    cleanupJournal,
    dependencies,
    setBranchHead: (head: string | null) => {
      branchHead = head;
    },
    readActorBytes: () => actorBytes,
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
    expect(result.data.projectId).toBe('project-1');
    expect(result.data.baseCommit).toBe(BASE);
    expect(result.data.expectedFeatureHead).toBe(FEATURE);
    expect(result.data.replayedThroughCommit).toBe(REPLAYED);
    expect(harness.factoryContext[0]).toMatchObject({
      workspaceRuntime: { manager: harness.runtimeManager },
    });
    expect(harness.worktreeService.copyPreservedFilesToWorktree).toHaveBeenCalledWith(
      '/pool/emdash/loop-verify-fixed',
      { strict: true, generatedBranchName: 'emdash/loop-verify-fixed' }
    );
  });

  it('stops immediately after snapshot cancellation without creating a worktree', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ afterCapture: () => controller.abort() });

    const result = await harness.service.create({ ...harness.input, signal: controller.signal });

    expect(result).toEqual({
      success: false,
      error: { type: 'cancelled', message: 'Clean-room creation was cancelled.' },
    });
    expect(harness.worktreeService.createWorktreeAtCommit).not.toHaveBeenCalled();
  });

  it('persists an absent cleanup record before worktree creation mutation', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const save = vi.spyOn(journal, 'save');
    const harness = makeHarness({ cleanupJournal: journal });

    const result = await harness.service.create(harness.input);

    expect(result.success).toBe(true);
    expect(save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cleanupId: 'cleanup-loop-verify-fixed',
        revision: 0,
      }),
      null
    );
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      harness.worktreeService.createWorktreeAtCommit.mock.invocationCallOrder[0]
    );
  });

  it('returns a typed journal failure without creating a worktree when initial save rejects', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    journal.save = vi.fn(async () => {
      throw new Error('journal unavailable');
    });
    const harness = makeHarness({ cleanupJournal: journal });

    await expect(harness.service.create(harness.input)).resolves.toEqual({
      success: false,
      error: {
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be persisted.',
      },
    });
    expect(harness.worktreeService.createWorktreeAtCommit).not.toHaveBeenCalled();
    expect(harness.executionContext.exec).not.toHaveBeenCalled();
  });

  it('enumerates an orphan cleanup record across service recreation', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const harness = makeHarness({ cleanupJournal: journal });
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');

    const recreatedService = new CleanRoomWorkspaceService({
      ...harness.dependencies,
      cleanupJournal: journal,
    });

    await expect(journal.list()).resolves.toEqual([
      expect.objectContaining({
        cleanupId: created.data.cleanupId,
        workspaceId: created.data.target.workspaceId,
        revision: 3,
      }),
    ]);
    expect(recreatedService).toBeInstanceOf(CleanRoomWorkspaceService);
  });

  it('adopts an exact pending cleanup idempotently without restoring integration capability', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const harness = makeHarness({ cleanupJournal: journal });
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    const [record] = await journal.list();
    const save = vi.spyOn(journal, 'save');
    const recovered = new CleanRoomWorkspaceService({
      ...harness.dependencies,
      cleanupJournal: journal,
    });

    await expect(recovered.adoptPendingCleanup(record, harness.project)).resolves.toEqual({
      success: true,
      data: { cleanupId: record.cleanupId },
    });
    expect(save).not.toHaveBeenCalled();
    await expect(
      recovered.integrateFix({
        cleanRoom: created.data,
        featureTarget: harness.featureTarget,
        expectedFeatureHead: FEATURE,
        fixCommit: '5'.repeat(40),
        project: harness.project,
      })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-clean-room-identity' },
    });
    expect(harness.snapshotService.integrateFix).not.toHaveBeenCalled();
  });

  it('rejects forged, oversized, and stale pending-cleanup adoption without journal mutation', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const harness = makeHarness({ cleanupJournal: journal });
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    const [record] = await journal.list();
    const save = vi.spyOn(journal, 'save');
    save.mockClear();
    const recovered = new CleanRoomWorkspaceService({
      ...harness.dependencies,
      cleanupJournal: journal,
    });

    const candidates: unknown[] = [
      { ...record, unexpected: true },
      { ...record, attempt: 0 },
      { ...record, target: { ...record.target, path: `/${'x'.repeat(4_097)}` } },
      { ...record, revision: record.revision - 1 },
    ];
    for (const candidate of candidates) {
      await expect(
        recovered.adoptPendingCleanup(candidate, harness.project)
      ).resolves.toMatchObject({
        success: false,
        error: { type: 'invalid-clean-room-identity' },
      });
    }
    expect(save).not.toHaveBeenCalled();
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

  it.each([
    { label: 'local', machine: { kind: 'local' } satisfies MachineRef },
    {
      label: 'SSH',
      machine: { kind: 'ssh', connectionId: 'ssh-capable-source' } satisfies MachineRef,
    },
  ])('supports an ordinary $label immutable worktree source capability', async ({ machine }) => {
    const harness = makeHarness({ machine });

    await expect(harness.service.preflight(harness.input)).resolves.toEqual(ok());
  });

  it('blocks a same-machine BYOI source before snapshot or Git work', async () => {
    const harness = makeHarness({
      machine: { kind: 'local' },
      featureMachine: { kind: 'local' },
      sourceCapability: { kind: 'unsupported', provider: 'byoi' },
    });

    await expect(harness.service.create(harness.input)).resolves.toEqual({
      success: false,
      error: {
        type: 'unsupported-clean-room',
        message:
          'This workspace provider does not expose the immutable same-machine Git-worktree capability required for clean-room verification.',
      },
    });
    expect(harness.snapshotService.capture).not.toHaveBeenCalled();
    expect(harness.executionContext.exec).not.toHaveBeenCalled();
    expect(harness.worktreeService.createWorktreeAtCommit).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'another project',
      capability: {
        kind: 'immutable-same-machine-git-worktree',
        projectId: 'project-foreign',
        machine: { kind: 'local' },
      } satisfies CleanRoomSourceCapability,
    },
    {
      label: 'another machine',
      capability: {
        kind: 'immutable-same-machine-git-worktree',
        projectId: 'project-1',
        machine: { kind: 'ssh', connectionId: 'ssh-foreign' },
      } satisfies CleanRoomSourceCapability,
    },
  ])('blocks a claimed immutable source from $label', async ({ capability }) => {
    const harness = makeHarness({ sourceCapability: capability });

    await expect(harness.service.create(harness.input)).resolves.toMatchObject({
      success: false,
      error: { type: 'unsupported-clean-room' },
    });
    expect(harness.snapshotService.capture).not.toHaveBeenCalled();
    expect(harness.executionContext.exec).not.toHaveBeenCalled();
  });

  it('accepts an explicitly capable same-machine provider without changing factory input', async () => {
    const sourceCapability = {
      kind: 'immutable-same-machine-git-worktree',
      projectId: 'project-1',
      machine: { kind: 'local' },
    } satisfies CleanRoomSourceCapability;
    const harness = makeHarness({ sourceCapability });

    const result = await harness.service.create(harness.input);

    expect(result.success).toBe(true);
    expect(harness.dependencies.createWorkspaceFactory).toHaveBeenCalledWith(
      'loop-verify-fixed',
      { kind: 'local' },
      expect.objectContaining({
        projectId: 'project-1',
        workDir: '/pool/emdash/loop-verify-fixed',
        workspaceRuntime: { machine: { kind: 'local' }, manager: harness.runtimeManager },
      })
    );
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
          'This workspace provider does not expose the immutable same-machine Git-worktree capability required for clean-room verification.',
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

  it('returns a typed worktree error and checks journaled cleanup when creation rejects', async () => {
    const harness = makeHarness({ createReject: true });

    await expect(harness.service.create(harness.input)).resolves.toEqual({
      success: false,
      error: {
        type: 'worktree-create-failed',
        message: 'Failed to create clean-room worktree.',
      },
    });
    expect(harness.worktreeService.removeGeneratedWorktreeIfPresent).toHaveBeenCalledWith(
      '/pool/emdash/loop-verify-fixed',
      {
        expectedBranchName: 'emdash/loop-verify-fixed',
        expectedHead: null,
      }
    );
  });

  it('retains pending cleanup without deleting an ambiguous competing-actor worktree', async () => {
    const harness = makeHarness({ createAmbiguousActor: true });

    const result = await harness.service.create(harness.input);

    expect(result).toMatchObject({
      success: false,
      error: {
        type: 'cleanup-failed',
        pendingCleanup: {
          cleanupId: 'cleanup-loop-verify-fixed',
        },
      },
    });
    expect(harness.worktreeService.removeGeneratedWorktreeIfPresent).not.toHaveBeenCalled();
    expect(harness.order).toEqual(['capture', 'create-worktree']);
    expect(harness.readActorBytes()).toBe('actor bytes');
    await expect(harness.cleanupJournal.list()).resolves.toHaveLength(1);
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
    expect(harness.snapshotService.capture).toHaveBeenLastCalledWith(
      expect.objectContaining({
        featurePath: '/pool/emdash/loop-verify-fixed',
        baseCommit: FEATURE,
        expectedFeatureHead: '5'.repeat(40),
        deadlineAt: expect.any(Number),
      })
    );
    expect(harness.snapshotService.integrateFix).toHaveBeenCalledWith(
      expect.objectContaining({
        featurePath: '/feature',
        expectedFeatureHead: FEATURE,
        fixCommit: '5'.repeat(40),
        deadlineAt: expect.any(Number),
      })
    );
  });

  it('rejects a forged clean-room handle before integration reads or mutates Git', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.snapshotService.capture.mockClear();
    harness.snapshotService.integrateFix.mockClear();

    const result = await harness.service.integrateFix({
      cleanRoom: {
        ...created.data,
        target: { ...created.data.target, path: '/pool/emdash/forged' },
      },
      featureTarget: harness.featureTarget,
      expectedFeatureHead: FEATURE,
      fixCommit: '5'.repeat(40),
      project: harness.project,
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'invalid-clean-room-identity',
        message: 'Clean-room workspace identity could not be validated.',
      },
    });
    expect(harness.snapshotService.capture).not.toHaveBeenCalled();
    expect(harness.snapshotService.integrateFix).not.toHaveBeenCalled();
  });

  it('rejects a clean-room handle issued for another project before cleanup mutation', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;

    const result = await harness.service.destroy(
      { ...created.data, projectId: 'project-forged' },
      harness.project
    );

    expect(result).toEqual({
      success: false,
      error: {
        type: 'invalid-clean-room-identity',
        message: 'Clean-room workspace identity could not be validated.',
      },
    });
    expect(harness.order).toEqual([]);
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

  it('retries an orphan journal record from a new service without an issued workspace map', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const harness = makeHarness({ cleanupJournal: journal });
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    const recovered = new CleanRoomWorkspaceService({
      ...harness.dependencies,
      cleanupJournal: journal,
    });

    await expect(
      recovered.retryPendingCleanup(created.data.cleanupId, harness.project)
    ).resolves.toEqual(ok());

    expect(harness.order).toEqual(['teardown', 'remove-worktree', 'delete-branch']);
    await expect(journal.list()).resolves.toEqual([]);
  });

  it('rejects retry with the wrong project before any cleanup mutation', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    const wrongProject = { ...harness.project, projectId: 'project-wrong' };

    await expect(
      harness.service.retryPendingCleanup(created.data.cleanupId, wrongProject)
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-clean-room-identity' },
    });
    expect(harness.order).toEqual([]);
  });

  it('preserves a concurrently moved branch and its pending cleanup record', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    harness.worktreeService.removeGeneratedWorktreeIfPresent.mockImplementationOnce(async () => {
      harness.order.push('remove-worktree');
      return err({ type: 'worktree-remove-failed', message: 'busy' });
    });

    await expect(
      harness.service.retryPendingCleanup(created.data.cleanupId, harness.project)
    ).resolves.toMatchObject({ success: false, error: { type: 'cleanup-failed' } });
    harness.setBranchHead('9'.repeat(40));
    await expect(
      harness.service.retryPendingCleanup(created.data.cleanupId, harness.project)
    ).resolves.toMatchObject({ success: false, error: { type: 'cleanup-failed' } });

    expect(harness.order).not.toContain('delete-branch');
    await expect(harness.cleanupJournal.list()).resolves.toEqual([
      expect.objectContaining({
        cleanupId: created.data.cleanupId,
        branchHead: FEATURE,
        completed: { teardown: true, worktree: true, branch: false },
      }),
    ]);
  });

  it('retries idempotently when cleanup succeeds before its progress save rejects', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const harness = makeHarness({ cleanupJournal: journal });
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    const delegateSave = journal.save.bind(journal);
    let rejectSave = true;
    journal.save = vi.fn(async (record, expectedRevision) => {
      if (rejectSave) {
        rejectSave = false;
        throw new Error('save unavailable');
      }
      return delegateSave(record, expectedRevision);
    });

    await expect(harness.service.destroy(created.data, harness.project)).resolves.toMatchObject({
      success: false,
      error: { type: 'cleanup-failed' },
    });
    await expect(harness.service.destroy(created.data, harness.project)).resolves.toEqual(ok());

    expect(harness.registry.teardown).toHaveBeenCalledTimes(2);
    expect(harness.worktreeService.removeGeneratedWorktreeIfPresent).toHaveBeenCalledTimes(1);
  });

  it('retries only journal removal when the first remove rejects', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const harness = makeHarness({ cleanupJournal: journal });
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    const delegateRemove = journal.remove.bind(journal);
    let rejectRemove = true;
    journal.remove = vi.fn(async (cleanupId, expectedRevision) => {
      if (rejectRemove) {
        rejectRemove = false;
        throw new Error('remove unavailable');
      }
      return delegateRemove(cleanupId, expectedRevision);
    });

    await expect(harness.service.destroy(created.data, harness.project)).resolves.toMatchObject({
      success: false,
      error: { type: 'cleanup-failed' },
    });
    await expect(harness.service.destroy(created.data, harness.project)).resolves.toEqual(ok());

    expect(harness.registry.teardown).toHaveBeenCalledTimes(1);
    expect(harness.worktreeService.removeGeneratedWorktreeIfPresent).toHaveBeenCalledTimes(1);
    expect(harness.executionContext.exec).toHaveBeenCalledWith(
      'git',
      ['update-ref', '-d', 'refs/heads/emdash/loop-verify-fixed', FEATURE],
      { timeout: 60_000 }
    );
  });

  it('turns a rejected journal load into a typed retry and clears single-flight state', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const harness = makeHarness({ cleanupJournal: journal });
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    const delegateLoad = journal.load.bind(journal);
    let rejectLoad = true;
    journal.load = vi.fn(async (cleanupId) => {
      if (rejectLoad) {
        rejectLoad = false;
        throw new Error('load unavailable');
      }
      return delegateLoad(cleanupId);
    });

    await expect(
      harness.service.retryPendingCleanup(created.data.cleanupId, harness.project)
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'cleanup-journal-failed' },
    });
    await expect(
      harness.service.retryPendingCleanup(created.data.cleanupId, harness.project)
    ).resolves.toEqual(ok());
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

  it('turns a rejected worktree removal into a retryable Result and clears single-flight state', async () => {
    const harness = makeHarness();
    const created = await harness.service.create(harness.input);
    if (!created.success) throw new Error('expected clean room');
    harness.order.length = 0;
    harness.worktreeService.removeGeneratedWorktreeIfPresent.mockImplementationOnce(async () => {
      harness.order.push('remove-worktree');
      throw new Error('transport rejected');
    });

    await expect(harness.service.destroy(created.data, harness.project)).resolves.toMatchObject({
      success: false,
      error: { type: 'cleanup-failed' },
    });
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
