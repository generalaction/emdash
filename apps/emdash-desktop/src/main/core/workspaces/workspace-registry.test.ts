import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from './workspace';
import { WorkspaceRegistry } from './workspace-registry';

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function makeWorkspace(id: string): {
  workspace: Workspace;
  dispose: ReturnType<typeof vi.fn>;
  fileTreeDispose: ReturnType<typeof vi.fn>;
  gitDispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn(async () => {});
  const fileTreeDispose = vi.fn();
  const gitDispose = vi.fn();

  return {
    workspace: {
      id,
      path: `/tmp/${id}`,
      configPath: `/tmp/${id}/.emdash.json`,
      fileSystem: {} as Workspace['fileSystem'],
      fileTree: { dispose: fileTreeDispose } as unknown as Workspace['fileTree'],
      fileTreeProjector: { dispose: vi.fn() } as unknown as Workspace['fileTreeProjector'],
      gitWorktree: { dispose: gitDispose } as unknown as Workspace['gitWorktree'],
      settings: {} as Workspace['settings'],
      lifecycleService: {
        dispose,
      } as unknown as Workspace['lifecycleService'],
      gitRepository: {} as Workspace['gitRepository'],
      gitRepositoryFetchService: {} as Workspace['gitRepositoryFetchService'],
    },
    dispose,
    fileTreeDispose,
    gitDispose,
  };
}

describe('WorkspaceRegistry', () => {
  it('orphan-cancels a held factory and disposes its late result exactly once', async () => {
    const registry = new WorkspaceRegistry();
    const late = makeWorkspace('loop:late');
    const factoryResult = deferred<{ workspace: Workspace }>();
    const controller = new AbortController();

    const acquisition = registry.acquire('loop:late', 'test-project', () => factoryResult.promise, {
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    });
    controller.abort(new Error('verification stopped'));

    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    const removeWorktree = vi.fn();
    const teardown = registry.teardown('loop:late').then(removeWorktree);
    await Promise.resolve();
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(registry.get('loop:late')).toBeUndefined();
    expect(registry.refCount('loop:late')).toBe(0);

    const onCreateSideEffect = vi.fn();
    const onCreate = vi.fn(async () => {});
    factoryResult.resolve({ workspace: late.workspace, onCreateSideEffect, onCreate });

    await teardown;
    await expect.poll(() => late.dispose).toHaveBeenCalledTimes(1);
    expect(late.fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(late.gitDispose).toHaveBeenCalledTimes(1);
    expect(registry.get('loop:late')).toBeUndefined();
    expect(registry.refCount('loop:late')).toBe(0);
    expect(onCreateSideEffect).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(removeWorktree).toHaveBeenCalledTimes(1);
  });

  it('keeps a shared acquisition alive when only the controlled waiter stops', async () => {
    const registry = new WorkspaceRegistry();
    const shared = makeWorkspace('branch:shared');
    const factoryResult = deferred<{ workspace: Workspace }>();
    const controller = new AbortController();
    const factory = vi.fn(() => factoryResult.promise);

    const live = registry.acquire('branch:shared', 'test-project', factory);
    const controlled = registry.acquire('branch:shared', 'test-project', factory, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(controlled).rejects.toMatchObject({ name: 'AbortError' });
    factoryResult.resolve({ workspace: shared.workspace });
    await expect(live.then((result) => result.workspace)).resolves.toBe(shared.workspace);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(registry.get('branch:shared')).toBe(shared.workspace);
    expect(registry.refCount('branch:shared')).toBe(1);
    expect(shared.dispose).not.toHaveBeenCalled();
  });

  it('tombstones teardown during a held first factory before any late publication', async () => {
    const registry = new WorkspaceRegistry();
    const late = makeWorkspace('loop:tombstoned');
    const factoryResult = deferred<{ workspace: Workspace; onCreateSideEffect(): void }>();
    const onCreateSideEffect = vi.fn();
    const acquisition = registry.acquire(
      'loop:tombstoned',
      'test-project',
      () => factoryResult.promise
    );

    const teardown = registry.teardown('loop:tombstoned');
    factoryResult.resolve({ workspace: late.workspace, onCreateSideEffect });

    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    await expect(teardown).resolves.toBeUndefined();
    expect(onCreateSideEffect).not.toHaveBeenCalled();
    expect(registry.get('loop:tombstoned')).toBeUndefined();
    expect(registry.refCount('loop:tombstoned')).toBe(0);
    expect(late.dispose).toHaveBeenCalledTimes(1);
  });

  it('retains failed teardown state and retries only incomplete cleanup', async () => {
    const registry = new WorkspaceRegistry();
    const item = makeWorkspace('branch:retry-teardown');
    const onDestroy = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('teardown held state failed'))
      .mockResolvedValueOnce();
    await registry.acquire('branch:retry-teardown', 'test-project', async () => ({
      workspace: item.workspace,
      onDestroy,
    }));

    await expect(registry.teardown('branch:retry-teardown')).rejects.toThrow(
      'teardown held state failed'
    );
    expect(registry.get('branch:retry-teardown')).toBe(item.workspace);
    expect(item.fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(item.gitDispose).toHaveBeenCalledTimes(1);
    expect(item.dispose).toHaveBeenCalledTimes(1);

    await expect(registry.teardown('branch:retry-teardown')).resolves.toBeUndefined();
    expect(onDestroy).toHaveBeenCalledTimes(2);
    expect(item.fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(item.gitDispose).toHaveBeenCalledTimes(1);
    expect(item.dispose).toHaveBeenCalledTimes(1);
    expect(registry.get('branch:retry-teardown')).toBeUndefined();
  });

  it('finishes a failed teardown tombstone before reacquiring the same key', async () => {
    const registry = new WorkspaceRegistry();
    const old = makeWorkspace('branch:reacquire-old');
    const replacement = makeWorkspace('branch:reacquire-new');
    const onDestroy = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('old teardown failed'))
      .mockResolvedValueOnce();
    await registry.acquire('branch:reacquire', 'test-project', async () => ({
      workspace: old.workspace,
      onDestroy,
    }));
    await expect(registry.teardown('branch:reacquire')).rejects.toThrow('old teardown failed');
    const replacementFactory = vi.fn(async () => ({ workspace: replacement.workspace }));

    const acquired = await registry.acquire('branch:reacquire', 'test-project', replacementFactory);

    expect(acquired.workspace).toBe(replacement.workspace);
    expect(onDestroy).toHaveBeenCalledTimes(2);
    expect(old.fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(old.gitDispose).toHaveBeenCalledTimes(1);
    expect(old.dispose).toHaveBeenCalledTimes(1);
    expect(replacementFactory).toHaveBeenCalledTimes(1);
    expect(registry.refCount('branch:reacquire')).toBe(1);
  });

  it('retains an unregistered disposal tombstone until failed cleanup retries', async () => {
    const registry = new WorkspaceRegistry();
    const item = makeWorkspace('loop:dispose-retry');
    item.dispose
      .mockRejectedValueOnce(new Error('lifecycle disposal failed'))
      .mockResolvedValueOnce(undefined);
    const acquisition = registry.acquire('loop:dispose-retry', 'test-project', async () => ({
      workspace: item.workspace,
      onCreate: async () => {
        throw new Error('creation hook failed');
      },
    }));

    await expect(acquisition).rejects.toMatchObject({
      name: 'WorkspaceAcquisitionQuiescenceFailure',
    });
    const removeWorktree = vi.fn();
    await registry.teardown('loop:dispose-retry').then(removeWorktree);

    expect(removeWorktree).toHaveBeenCalledTimes(1);
    expect(item.fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(item.gitDispose).toHaveBeenCalledTimes(1);
    expect(item.dispose).toHaveBeenCalledTimes(2);
    expect(registry.get('loop:dispose-retry')).toBeUndefined();
  });

  it('creates once and increments ref count on repeated acquire', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const factory = vi.fn(async () => ({ workspace }));

    const first = await registry.acquire('branch:main', 'test-project', factory);
    const second = await registry.acquire('branch:main', 'test-project', factory);

    expect(first.workspace).toBe(workspace);
    expect(second.workspace).toBe(workspace);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(registry.get('branch:main')).toBe(workspace);
    expect(registry.refCount('branch:main')).toBe(2);
  });

  it('coalesces concurrent acquires for the same key', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    let resolveFactory: ((value: { workspace: Workspace }) => void) | undefined;
    const factory = vi.fn(
      () =>
        new Promise<{ workspace: Workspace }>((resolve) => {
          resolveFactory = resolve;
        })
    );

    const first = registry.acquire('branch:main', 'test-project', factory);
    const second = registry.acquire('branch:main', 'test-project', factory);

    expect(factory).toHaveBeenCalledTimes(1);
    resolveFactory?.({ workspace });

    await expect(first.then((acquired) => acquired.workspace)).resolves.toBe(workspace);
    await expect(second.then((acquired) => acquired.workspace)).resolves.toBe(workspace);
    expect(registry.refCount('branch:main')).toBe(2);
  });

  it('disposes workspace resources when ref count reaches zero', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace, dispose, fileTreeDispose, gitDispose } = makeWorkspace('branch:main');
    const factory = vi.fn(async () => ({ workspace }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.acquire('branch:main', 'test-project', factory);

    await registry.teardown('branch:main');
    expect(dispose).not.toHaveBeenCalled();
    expect(fileTreeDispose).not.toHaveBeenCalled();
    expect(gitDispose).not.toHaveBeenCalled();
    expect(registry.refCount('branch:main')).toBe(1);

    await registry.teardown('branch:main');
    expect(fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(gitDispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(registry.get('branch:main')).toBeUndefined();
    expect(registry.refCount('branch:main')).toBe(0);
  });

  it('teardownAll disposes each workspace once and clears the registry', async () => {
    const registry = new WorkspaceRegistry();
    const first = makeWorkspace('branch:main');
    const second = makeWorkspace('root:');

    await registry.acquire('branch:main', 'test-project', async () => ({
      workspace: first.workspace,
    }));
    await registry.acquire('branch:main', 'test-project', async () => ({
      workspace: first.workspace,
    }));
    await registry.acquire('root:', 'test-project', async () => ({ workspace: second.workspace }));

    await registry.teardownAll();

    expect(first.fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(first.gitDispose).toHaveBeenCalledTimes(1);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(second.gitDispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(registry.refCount('branch:main')).toBe(0);
    expect(registry.refCount('root:')).toBe(0);
  });

  it('ignores teardown for unknown keys', async () => {
    const registry = new WorkspaceRegistry();
    await expect(registry.teardown('missing')).resolves.toBeUndefined();
  });

  it('calls onCreateSideEffect once on first acquire and not on re-acquire', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const onCreateSideEffect = vi.fn();
    const factory = vi.fn(async () => ({ workspace, onCreateSideEffect }));

    await registry.acquire('branch:main', 'test-project', factory);
    expect(onCreateSideEffect).toHaveBeenCalledTimes(1);
    expect(onCreateSideEffect).toHaveBeenCalledWith(workspace);

    await registry.acquire('branch:main', 'test-project', factory);
    expect(onCreateSideEffect).toHaveBeenCalledTimes(1);
  });

  it('awaits onCreate before acquire resolves', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const order: string[] = [];

    const onCreate = vi.fn(async () => {
      order.push('onCreate');
    });
    const factory = vi.fn(async () => ({ workspace, onCreate }));

    const acquired = registry.acquire('branch:main', 'test-project', factory).then((result) => {
      order.push('acquired');
      return result.workspace;
    });

    await acquired;

    expect(order).toEqual(['onCreate', 'acquired']);
    expect(onCreate).toHaveBeenCalledWith(workspace);
  });

  it('does not call onCreate on re-acquire', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const onCreate = vi.fn(async () => {});
    const factory = vi.fn(async () => ({ workspace, onCreate }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.acquire('branch:main', 'test-project', factory);

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('calls onDestroy once at final teardown, not on earlier teardowns', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const onDestroy = vi.fn(async () => {});
    const factory = vi.fn(async () => ({ workspace, onDestroy }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.acquire('branch:main', 'test-project', factory);

    await registry.teardown('branch:main');
    expect(onDestroy).not.toHaveBeenCalled();

    await registry.teardown('branch:main');
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(onDestroy).toHaveBeenCalledWith(workspace);
  });

  it('calls onDestroy before git.dispose and lifecycleService.dispose', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace, dispose, fileTreeDispose, gitDispose } = makeWorkspace('branch:main');
    const order: string[] = [];

    dispose.mockImplementation(() => {
      order.push('lifecycleDispose');
      return undefined;
    });
    fileTreeDispose.mockImplementation(() => {
      order.push('fileTreeDispose');
    });
    gitDispose.mockImplementation(() => {
      order.push('gitDispose');
    });

    const onDestroy = vi.fn(() => {
      order.push('onDestroy');
      return Promise.resolve();
    });
    const factory = vi.fn(async () => ({ workspace, onDestroy }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.teardown('branch:main');

    expect(order).toEqual(['onDestroy', 'fileTreeDispose', 'gitDispose', 'lifecycleDispose']);
  });

  it('calls onDestroy for each entry in teardownAll', async () => {
    const registry = new WorkspaceRegistry();
    const first = makeWorkspace('branch:main');
    const second = makeWorkspace('root:');
    const onDestroyFirst = vi.fn(async () => {});
    const onDestroySecond = vi.fn(async () => {});

    await registry.acquire('branch:main', 'test-project', async () => ({
      workspace: first.workspace,
      onDestroy: onDestroyFirst,
    }));
    await registry.acquire('root:', 'test-project', async () => ({
      workspace: second.workspace,
      onDestroy: onDestroySecond,
    }));

    await registry.teardownAll();

    expect(onDestroyFirst).toHaveBeenCalledTimes(1);
    expect(onDestroyFirst).toHaveBeenCalledWith(first.workspace);
    expect(onDestroySecond).toHaveBeenCalledTimes(1);
    expect(onDestroySecond).toHaveBeenCalledWith(second.workspace);
  });

  it('calls onDetach (not onDestroy) when tearing down with detach mode', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const onDestroy = vi.fn(async () => {});
    const onDetach = vi.fn(async () => {});
    const factory = vi.fn(async () => ({ workspace, onDestroy, onDetach }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.teardown('branch:main', 'detach');

    expect(onDetach).toHaveBeenCalledTimes(1);
    expect(onDetach).toHaveBeenCalledWith(workspace);
    expect(onDestroy).not.toHaveBeenCalled();
  });

  it('calls onDestroy (not onDetach) when tearing down with terminate mode', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const onDestroy = vi.fn(async () => {});
    const onDetach = vi.fn(async () => {});
    const factory = vi.fn(async () => ({ workspace, onDestroy, onDetach }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.teardown('branch:main', 'terminate');

    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(onDestroy).toHaveBeenCalledWith(workspace);
    expect(onDetach).not.toHaveBeenCalled();
  });

  it('does not call onDetach when ref count has not reached zero', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const onDetach = vi.fn(async () => {});
    const factory = vi.fn(async () => ({ workspace, onDetach }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.acquire('branch:main', 'test-project', factory);

    await registry.teardown('branch:main', 'detach');
    expect(onDetach).not.toHaveBeenCalled();

    await registry.teardown('branch:main', 'detach');
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it('teardownAllForProject passes detach mode to hooks', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const onDestroy = vi.fn(async () => {});
    const onDetach = vi.fn(async () => {});

    await registry.acquire('branch:main', 'test-project', async () => ({
      workspace,
      onDestroy,
      onDetach,
    }));

    await registry.teardownAllForProject('test-project', 'detach');

    expect(onDetach).toHaveBeenCalledTimes(1);
    expect(onDestroy).not.toHaveBeenCalled();
  });

  it('releases leases for a project without running teardown hooks', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace, dispose, fileTreeDispose, gitDispose } = makeWorkspace('branch:main');
    const onDestroy = vi.fn(async () => {});
    const onDetach = vi.fn(async () => {});

    await registry.acquire('branch:main', 'test-project', async () => ({
      workspace,
      onDestroy,
      onDetach,
    }));

    await registry.releaseLeasesForProject('test-project');

    expect(fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(gitDispose).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(onDestroy).not.toHaveBeenCalled();
    expect(onDetach).not.toHaveBeenCalled();
    expect(registry.refCount('branch:main')).toBe(1);

    await registry.teardownAllForProject('test-project');

    expect(fileTreeDispose).toHaveBeenCalledTimes(1);
    expect(gitDispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(onDetach).not.toHaveBeenCalled();
  });
});
