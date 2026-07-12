import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from './workspace';
import { WorkspaceRegistry } from './workspace-registry';

function makeWorkspace(id: string): {
  workspace: Workspace;
  dispose: ReturnType<typeof vi.fn>;
  workspaceDispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn(async () => {});
  const workspaceDispose = vi.fn(async () => {});

  return {
    workspace: {
      id,
      path: `/tmp/${id}`,
      configPath: `/tmp/${id}/.emdash.json`,
      fileSystem: {} as Workspace['fileSystem'],
      gitCheckout: {} as Workspace['gitCheckout'],
      settings: {} as Workspace['settings'],
      lifecycleService: {
        dispose,
      } as unknown as Workspace['lifecycleService'],
      gitRepository: {} as Workspace['gitRepository'],
      gitRepositoryFetchService: {} as Workspace['gitRepositoryFetchService'],
      dispose: workspaceDispose,
    },
    dispose,
    workspaceDispose,
  };
}

describe('WorkspaceRegistry', () => {
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
    const { workspace, dispose, workspaceDispose } = makeWorkspace('branch:main');
    const factory = vi.fn(async () => ({ workspace }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.acquire('branch:main', 'test-project', factory);

    await registry.teardown('branch:main');
    expect(dispose).not.toHaveBeenCalled();
    expect(workspaceDispose).not.toHaveBeenCalled();
    expect(registry.refCount('branch:main')).toBe(1);

    await registry.teardown('branch:main');
    expect(workspaceDispose).toHaveBeenCalledTimes(1);
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

    expect(first.workspaceDispose).toHaveBeenCalledTimes(1);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.workspaceDispose).toHaveBeenCalledTimes(1);
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

  it('calls onDestroy before workspace and lifecycle disposal', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace, dispose, workspaceDispose } = makeWorkspace('branch:main');
    const order: string[] = [];

    dispose.mockImplementation(() => {
      order.push('lifecycleDispose');
      return undefined;
    });
    workspaceDispose.mockImplementation(() => {
      order.push('workspaceDispose');
    });

    const onDestroy = vi.fn(() => {
      order.push('onDestroy');
      return Promise.resolve();
    });
    const factory = vi.fn(async () => ({ workspace, onDestroy }));

    await registry.acquire('branch:main', 'test-project', factory);
    await registry.teardown('branch:main');

    expect(order).toEqual(['onDestroy', 'workspaceDispose', 'lifecycleDispose']);
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
    const { workspace, dispose, workspaceDispose } = makeWorkspace('branch:main');
    const onDestroy = vi.fn(async () => {});
    const onDetach = vi.fn(async () => {});

    await registry.acquire('branch:main', 'test-project', async () => ({
      workspace,
      onDestroy,
      onDetach,
    }));

    await registry.releaseLeasesForProject('test-project');

    expect(workspaceDispose).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(onDestroy).not.toHaveBeenCalled();
    expect(onDetach).not.toHaveBeenCalled();
    expect(registry.refCount('branch:main')).toBe(1);

    await registry.teardownAllForProject('test-project');

    expect(workspaceDispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(onDetach).not.toHaveBeenCalled();
  });
});
