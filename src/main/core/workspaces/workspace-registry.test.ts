import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from './workspace';
import { WorkspaceRegistry } from './workspace-registry';

function makeWorkspace(id: string): {
  workspace: Workspace;
  dispose: ReturnType<typeof vi.fn>;
  gitDispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn(async () => {});
  const gitDispose = vi.fn();

  return {
    workspace: {
      id,
      path: `/tmp/${id}`,
      fs: {} as Workspace['fs'],
      git: { dispose: gitDispose } as unknown as Workspace['git'],
      settings: {} as Workspace['settings'],
      lifecycleService: {
        dispose,
      } as unknown as Workspace['lifecycleService'],
    },
    dispose,
    gitDispose,
  };
}

describe('WorkspaceRegistry', () => {
  it('creates once and increments ref count on repeated acquire', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    const factory = vi.fn(async () => workspace);

    const first = await registry.acquire('branch:main', factory);
    const second = await registry.acquire('branch:main', factory);

    expect(first).toBe(workspace);
    expect(second).toBe(workspace);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(registry.get('branch:main')).toBe(workspace);
    expect(registry.refCount('branch:main')).toBe(2);
  });

  it('coalesces concurrent acquires for the same key', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace } = makeWorkspace('branch:main');
    let resolveFactory: ((value: Workspace) => void) | undefined;
    const factory = vi.fn(
      () =>
        new Promise<Workspace>((resolve) => {
          resolveFactory = resolve;
        })
    );

    const first = registry.acquire('branch:main', factory);
    const second = registry.acquire('branch:main', factory);

    expect(factory).toHaveBeenCalledTimes(1);
    resolveFactory?.(workspace);

    await expect(first).resolves.toBe(workspace);
    await expect(second).resolves.toBe(workspace);
    expect(registry.refCount('branch:main')).toBe(2);
  });

  it('disposes workspace resources when ref count reaches zero', async () => {
    const registry = new WorkspaceRegistry();
    const { workspace, dispose, gitDispose } = makeWorkspace('branch:main');
    const factory = vi.fn(async () => workspace);

    await registry.acquire('branch:main', factory);
    await registry.acquire('branch:main', factory);

    await registry.release('branch:main');
    expect(dispose).not.toHaveBeenCalled();
    expect(gitDispose).not.toHaveBeenCalled();
    expect(registry.refCount('branch:main')).toBe(1);

    await registry.release('branch:main');
    expect(gitDispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(registry.get('branch:main')).toBeUndefined();
    expect(registry.refCount('branch:main')).toBe(0);
  });

  it('releaseAll disposes each workspace once and clears the registry', async () => {
    const registry = new WorkspaceRegistry();
    const first = makeWorkspace('branch:main');
    const second = makeWorkspace('root:');

    await registry.acquire('branch:main', async () => first.workspace);
    await registry.acquire('branch:main', async () => first.workspace);
    await registry.acquire('root:', async () => second.workspace);

    await registry.releaseAll();

    expect(first.gitDispose).toHaveBeenCalledTimes(1);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.gitDispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(registry.refCount('branch:main')).toBe(0);
    expect(registry.refCount('root:')).toBe(0);
  });

  it('ignores release for unknown keys', async () => {
    const registry = new WorkspaceRegistry();
    await expect(registry.release('missing')).resolves.toBeUndefined();
  });
});
