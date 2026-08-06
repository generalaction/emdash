import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewServer } from '@shared/core/preview-servers/types';
import {
  createWorkspaceFactory,
  dispatchWorkspaceLifecycleStartup,
  waitForWorkspacePreview,
} from './workspace-factory';
import { LifecycleScriptService } from './workspace-lifecycle-service';
import { WorkspaceRegistry } from './workspace-registry';

vi.mock('@main/db/client', () => ({ db: {} }));

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function controlledFactoryContext({
  manager,
  settings,
  deadlineAt,
}: {
  manager: { acquire(): Promise<unknown> };
  settings: { get(): Promise<unknown>; getDefaultBranch(): Promise<string> };
  deadlineAt: number;
}) {
  return {
    task: { id: 'task-deadline', name: 'Deadline task' },
    workDir: '/tmp/loop-deadline',
    projectId: 'project-deadline',
    projectPath: '/tmp/project-deadline',
    workspaceRuntime: { machine: { kind: 'local' as const }, manager },
    settings,
    logPrefix: 'WorkspaceFactoryDeadlineTest',
    strictStartup: { requirePreview: false, deadlineAt },
  } as unknown as Parameters<typeof createWorkspaceFactory>[2];
}

function previews(...servers: PreviewServer[]) {
  return { listForWorkspace: () => servers };
}

describe('waitForWorkspacePreview', () => {
  it('returns ready for one exact forwarded SSH preview only after its tunnel is ready', async () => {
    const server: PreviewServer = {
      id: 'ssh:auto:project:workspace:ssh-1:3000',
      kind: 'forwarded',
      projectId: 'project',
      workspaceId: 'workspace',
      source: { kind: 'terminal-output', terminalId: 'run' },
      protocol: 'http:',
      urlPath: '/',
      status: { kind: 'ready' },
      connectionId: 'ssh-1',
      remotePort: 3000,
      localPort: 43000,
    };

    await expect(
      waitForWorkspacePreview({
        projectId: 'project',
        workspaceId: 'workspace',
        signal: new AbortController().signal,
        previewServers: previews(server),
      })
    ).resolves.toEqual({ success: true, data: undefined });
  });

  it('fails on ambiguous previews instead of choosing one implicitly', async () => {
    const direct = (id: string, port: number): PreviewServer => ({
      id,
      kind: 'direct',
      projectId: 'project',
      workspaceId: 'workspace',
      source: { kind: 'terminal-output', terminalId: 'run' },
      protocol: 'http:',
      urlPath: '/',
      status: { kind: 'ready' },
      host: '127.0.0.1',
      port,
    });

    await expect(
      waitForWorkspacePreview({
        projectId: 'project',
        workspaceId: 'workspace',
        signal: new AbortController().signal,
        previewServers: previews(direct('one', 3000), direct('two', 3001)),
      })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'preview-ambiguous', stage: 'preview' },
    });
  });

  it('fails when SSH forwarding reports a failed preview', async () => {
    const failed: PreviewServer = {
      id: 'ssh:auto:project:workspace:ssh-1:3000',
      kind: 'forwarded',
      projectId: 'project',
      workspaceId: 'workspace',
      source: { kind: 'terminal-output', terminalId: 'run' },
      protocol: 'http:',
      urlPath: '/',
      status: { kind: 'failed', message: 'forward failed' },
      connectionId: 'ssh-1',
      remotePort: 3000,
    };

    await expect(
      waitForWorkspacePreview({
        projectId: 'project',
        workspaceId: 'workspace',
        signal: new AbortController().signal,
        previewServers: previews(failed),
      })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'preview-failed', stage: 'preview' },
    });
  });
});

describe('createWorkspaceFactory control', () => {
  it.each(['runtime', 'worktree', 'tree', 'settings', 'task-settings'] as const)(
    'settles at the absolute deadline and releases partial or late %s leases',
    async (heldStage) => {
      const gate = deferred<unknown>();
      const releaseOrder: string[] = [];
      const runtimeRelease = vi.fn(async () => {
        releaseOrder.push('runtime');
      });
      const worktreeRelease = vi.fn(async () => {
        releaseOrder.push('worktree');
      });
      const treeRelease = vi.fn(async () => {
        releaseOrder.push('tree');
      });
      const runtimeLease = {
        value: {
          git: {
            openWorktree: vi.fn(() =>
              heldStage === 'worktree'
                ? gate.promise
                : Promise.resolve({ value: {}, release: worktreeRelease })
            ),
          },
          files: {
            openTree: vi.fn(() =>
              heldStage === 'tree'
                ? gate.promise
                : Promise.resolve(ok({ value: {}, release: treeRelease }))
            ),
            fileSystem: vi.fn(() =>
              ok({
                exists: vi.fn(() =>
                  heldStage === 'task-settings' ? gate.promise : Promise.resolve(ok(false))
                ),
                readText: vi.fn(),
              })
            ),
            path: { join: (...parts: string[]) => parts.join('/') },
          },
        },
        release: runtimeRelease,
      };
      const manager = {
        acquire: vi.fn(() =>
          heldStage === 'runtime' ? gate.promise : Promise.resolve(runtimeLease)
        ),
      };
      const settingsGate = heldStage === 'settings' ? gate.promise : Promise.resolve({});
      const settings = {
        get: vi.fn(() => settingsGate),
        getDefaultBranch: vi.fn(async () => 'main'),
      };
      const factory = createWorkspaceFactory(
        'loop-deadline',
        { kind: 'local' },
        controlledFactoryContext({ manager, settings, deadlineAt: Date.now() + 50 })
      );

      const creation = factory();
      let settled = false;
      void creation.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 70));
      expect(settled).toBe(false);

      if (heldStage === 'runtime') gate.resolve(runtimeLease);
      if (heldStage === 'worktree') gate.resolve({ value: {}, release: worktreeRelease });
      if (heldStage === 'tree') gate.resolve(ok({ value: {}, release: treeRelease }));
      if (heldStage === 'settings') gate.resolve({});
      if (heldStage === 'task-settings') gate.resolve(ok(false));
      await expect(creation).rejects.toMatchObject({ name: 'AbortError' });

      await expect.poll(() => runtimeRelease).toHaveBeenCalledTimes(1);
      if (heldStage !== 'runtime') {
        expect(worktreeRelease).toHaveBeenCalledTimes(1);
      }
      if (heldStage === 'tree' || heldStage === 'settings' || heldStage === 'task-settings') {
        expect(treeRelease).toHaveBeenCalledTimes(1);
      }
      if (heldStage === 'settings' || heldStage === 'task-settings') {
        expect(releaseOrder).toEqual(['tree', 'worktree', 'runtime']);
      }
    }
  );

  it('keeps registry teardown non-quiescent until a late runtime lease is released', async () => {
    const registry = new WorkspaceRegistry();
    const runtimeGate = deferred<unknown>();
    const runtimeRelease = vi.fn(async () => {});
    const manager = { acquire: vi.fn(() => runtimeGate.promise) };
    const deadlineAt = Date.now() + 20;
    const factory = createWorkspaceFactory(
      'loop-registry-deadline',
      { kind: 'local' },
      controlledFactoryContext({
        manager,
        settings: { get: vi.fn(async () => ({})), getDefaultBranch: vi.fn(async () => 'main') },
        deadlineAt,
      })
    );

    const acquisition = registry.acquire('loop-registry-deadline', 'project-deadline', factory, {
      deadlineAt,
    });
    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    const removeWorktree = vi.fn();
    const teardown = registry.teardown('loop-registry-deadline').then(removeWorktree);
    await Promise.resolve();
    expect(removeWorktree).not.toHaveBeenCalled();

    runtimeGate.resolve({
      value: { git: {}, files: {} },
      release: runtimeRelease,
    });

    await teardown;
    expect(runtimeRelease).toHaveBeenCalledTimes(1);
    expect(removeWorktree).toHaveBeenCalledTimes(1);
    expect(registry.get('loop-registry-deadline')).toBeUndefined();
    expect(registry.refCount('loop-registry-deadline')).toBe(0);
  });

  it('preserves the strict absolute deadline under registry-owned cancellation', async () => {
    const registry = new WorkspaceRegistry();
    const runtimeGate = deferred<unknown>();
    const runtimeRelease = vi.fn(async () => {});
    const strictDeadlineAt = Date.now() + 50;
    const factory = createWorkspaceFactory(
      'loop-strict-deadline',
      { kind: 'local' },
      controlledFactoryContext({
        manager: { acquire: vi.fn(() => runtimeGate.promise) },
        settings: { get: vi.fn(async () => ({})), getDefaultBranch: vi.fn(async () => 'main') },
        deadlineAt: strictDeadlineAt,
      })
    );
    const acquisition = registry.acquire('loop-strict-deadline', 'project-deadline', factory, {
      deadlineAt: Date.now() + 60_000,
    });
    let settled = false;
    void acquisition.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(settled).toBe(false);
    runtimeGate.resolve({ value: { git: {}, files: {} }, release: runtimeRelease });

    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    expect(runtimeRelease).toHaveBeenCalledTimes(1);
  });

  it('attempts reverse-order lower releases and exposes retryable quiescence on failure', async () => {
    const settingsGate = deferred<unknown>();
    const releaseOrder: string[] = [];
    const treeRelease = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => {
        releaseOrder.push('tree-failed');
        throw new Error('tree release failed');
      })
      .mockImplementationOnce(async () => {
        releaseOrder.push('tree-retried');
      });
    const worktreeRelease = vi.fn(async () => {
      releaseOrder.push('worktree');
    });
    const runtimeRelease = vi.fn(async () => {
      releaseOrder.push('runtime');
    });
    const runtimeLease = {
      value: {
        git: {
          openWorktree: vi.fn(async () => ({ value: {}, release: worktreeRelease })),
        },
        files: {
          openTree: vi.fn(async () => ok({ value: {}, release: treeRelease })),
          fileSystem: vi.fn(() => ok({})),
          path: { join: (...parts: string[]) => parts.join('/') },
        },
      },
      release: runtimeRelease,
    };
    const factory = createWorkspaceFactory(
      'loop-release-retry',
      { kind: 'local' },
      controlledFactoryContext({
        manager: { acquire: vi.fn(async () => runtimeLease) },
        settings: {
          get: vi.fn(() => settingsGate.promise),
          getDefaultBranch: vi.fn(async () => 'main'),
        },
        deadlineAt: Date.now() + 50,
      })
    );

    const creation = factory();
    const observedFailure = creation.catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 70));
    settingsGate.resolve({});
    const failure = await observedFailure;

    expect(failure).toMatchObject({ name: 'WorkspaceFactoryQuiescenceFailure' });
    expect(releaseOrder).toEqual(['tree-failed', 'worktree', 'runtime']);
    if (
      typeof failure !== 'object' ||
      failure === null ||
      !('quiesce' in failure) ||
      typeof failure.quiesce !== 'function'
    ) {
      throw new Error('expected retryable quiescence failure');
    }
    await failure.quiesce();

    expect(releaseOrder).toEqual(['tree-failed', 'worktree', 'runtime', 'tree-retried']);
    expect(worktreeRelease).toHaveBeenCalledTimes(1);
    expect(runtimeRelease).toHaveBeenCalledTimes(1);
  });

  it('does not let an expired creation deadline disable later workspace destruction', async () => {
    const deadlineAt = Date.now() + 60_000;
    const onDestroy = vi.fn(async () => {});
    const runtimeRelease = vi.fn(async () => {});
    const worktreeRelease = vi.fn(async () => {});
    const treeRelease = vi.fn(async () => {});
    const fileTree = {
      subscribe: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    };
    const fileSystem = {
      exists: vi.fn(async () => ok(false)),
      readText: vi.fn(),
    };
    const gitWorktree = {
      repository: {},
      subscribe: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    };
    const files = {
      openTree: vi.fn(async () => ok({ value: fileTree, release: treeRelease })),
      fileSystem: vi.fn(() => ok(fileSystem)),
      path: { join: (...parts: string[]) => parts.join('/') },
    };
    const context = {
      task: { id: 'task-destroy', name: 'Destroy task' },
      workDir: '/tmp/loop-destroy',
      projectId: 'project-destroy',
      projectPath: '/tmp/project-destroy',
      workspaceRuntime: {
        machine: { kind: 'local' as const },
        manager: {
          acquire: vi.fn(async () => ({
            value: {
              git: {
                openWorktree: vi.fn(async () => ({
                  value: gitWorktree,
                  release: worktreeRelease,
                })),
              },
              files,
            },
            release: runtimeRelease,
          })),
        },
      },
      settings: {
        get: vi.fn(async () => ({})),
        getDefaultBranch: vi.fn(async () => 'main'),
      },
      logPrefix: 'WorkspaceFactoryDestroyTest',
      gitRepository: {},
      gitRepositoryFetchService: {},
      extraHooks: { onDestroy },
      strictStartup: { requirePreview: false, deadlineAt },
    } as unknown as Parameters<typeof createWorkspaceFactory>[2];
    const result = await createWorkspaceFactory('loop-destroy', { kind: 'local' }, context)();
    const now = vi.spyOn(Date, 'now').mockReturnValue(deadlineAt + 1);

    try {
      await result.onDestroy?.(result.workspace);
    } finally {
      now.mockRestore();
      await result.workspace.dispose?.();
      await result.workspace.lifecycleService.dispose();
    }

    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(context.settings.get).toHaveBeenCalledTimes(4);
    expect(runtimeRelease).toHaveBeenCalledTimes(1);
  });

  it('keeps a real shared factory alive when the first waiter aborts', async () => {
    const registry = new WorkspaceRegistry();
    const runtimeGate = deferred<unknown>();
    const firstControl = new AbortController();
    const strictDeadlineAt = Date.now() + 60_000;
    const startup = vi.spyOn(LifecycleScriptService.prototype, 'startRequiredStartup');
    const runtimeRelease = vi.fn(async () => {});
    const worktreeRelease = vi.fn(async () => {});
    const treeRelease = vi.fn(async () => {});
    const fileTree = {
      subscribe: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    };
    const fileSystem = {
      exists: vi.fn(async () => ok(false)),
      readText: vi.fn(),
    };
    const gitWorktree = {
      repository: {},
      subscribe: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    };
    const files = {
      openTree: vi.fn(async () => ok({ value: fileTree, release: treeRelease })),
      fileSystem: vi.fn(() => ok(fileSystem)),
      watchChanges: vi.fn(() =>
        err({ type: 'fs-error' as const, path: '/tmp/shared', message: 'watch disabled' })
      ),
      path: { join: (...parts: string[]) => parts.join('/') },
    };
    const settings = {
      get: vi.fn(async () => ({})),
      getDefaultBranch: vi.fn(async () => 'main'),
    };
    const factory = createWorkspaceFactory(
      'loop-shared-real-factory',
      { kind: 'local' },
      {
        task: { id: 'task-shared', name: 'Shared task' },
        workDir: '/tmp/loop-shared-real-factory',
        projectId: 'project-shared',
        projectPath: '/tmp/project-shared',
        workspaceRuntime: {
          machine: { kind: 'local' },
          manager: { acquire: vi.fn(() => runtimeGate.promise) } as Parameters<
            typeof createWorkspaceFactory
          >[2]['workspaceRuntime']['manager'],
        },
        settings: settings as unknown as Parameters<typeof createWorkspaceFactory>[2]['settings'],
        logPrefix: 'WorkspaceFactorySharedTest',
        gitRepository: {} as Parameters<typeof createWorkspaceFactory>[2]['gitRepository'],
        gitRepositoryFetchService: {} as Parameters<
          typeof createWorkspaceFactory
        >[2]['gitRepositoryFetchService'],
        strictStartup: {
          requirePreview: false,
          signal: firstControl.signal,
          deadlineAt: strictDeadlineAt,
        },
      }
    );
    const first = registry.acquire('loop-shared-real-factory', 'project-shared', factory, {
      signal: firstControl.signal,
    });
    const live = registry.acquire('loop-shared-real-factory', 'project-shared', factory);

    firstControl.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    runtimeGate.resolve({
      value: {
        git: {
          openWorktree: vi.fn(async () => ({ value: gitWorktree, release: worktreeRelease })),
        },
        files,
      },
      release: runtimeRelease,
    });

    await expect(live).resolves.toMatchObject({
      workspace: { id: 'loop-shared-real-factory' },
    });
    expect(registry.refCount('loop-shared-real-factory')).toBe(1);
    expect(runtimeRelease).not.toHaveBeenCalled();
    expect(startup).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: strictDeadlineAt,
      })
    );

    await registry.teardown('loop-shared-real-factory');
    expect(runtimeRelease).toHaveBeenCalledTimes(1);
    startup.mockRestore();
  });
});

describe('dispatchWorkspaceLifecycleStartup', () => {
  it('starts the strict receipt exactly once and suppresses legacy fire-and-forget startup', () => {
    const startRequiredStartup = vi.fn(() => ({
      ready: Promise.resolve(
        ok({ setup: 'succeeded' as const, run: 'running' as const, preview: 'ready' as const })
      ),
      cancel: vi.fn(),
    }));
    const startNormal = vi.fn(async () => {});
    const required = {
      setup: { type: 'setup' as const, script: 'pnpm install' },
      run: { type: 'run' as const, script: 'pnpm dev' },
    };

    dispatchWorkspaceLifecycleStartup({
      strict: true,
      lifecycleService: { startRequiredStartup },
      required,
      startNormal,
    });

    expect(startRequiredStartup).toHaveBeenCalledTimes(1);
    expect(startRequiredStartup).toHaveBeenCalledWith(required);
    expect(startNormal).not.toHaveBeenCalled();
  });

  it('preserves the legacy startup path for ordinary workspaces', async () => {
    const startRequiredStartup = vi.fn(() => ({
      ready: Promise.resolve(
        ok({ setup: 'succeeded' as const, run: 'running' as const, preview: 'ready' as const })
      ),
      cancel: vi.fn(),
    }));
    const startNormal = vi.fn(async () => {});

    dispatchWorkspaceLifecycleStartup({
      strict: false,
      lifecycleService: { startRequiredStartup },
      required: {},
      startNormal,
    });

    await expect.poll(() => startNormal).toHaveBeenCalledTimes(1);
    expect(startRequiredStartup).not.toHaveBeenCalled();
  });
});
