import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { ROOT_RELATIVE_PATH } from '@emdash/core/primitives/path/api';
import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { WorkspacePlacementResolver } from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { LocalProject } from '@core/primitives/projects/api';

const project: LocalProject = {
  type: 'local',
  id: 'project-1',
  name: 'Emdash',
  path: '/home/jona/emdash/repositories/emdash',
  baseRef: 'main',
  repositoryWorkspaceId: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

function makeResolver(options: {
  home?: string;
  existingPaths?: string[];
  registeredPaths?: string[];
  appOverrides?: Record<string, string>;
  projectOverride?: string;
}) {
  const existingPaths = new Set(options.existingPaths ?? []);
  const registeredPaths = new Set(options.registeredPaths ?? []);
  const getHomeDir = vi.fn().mockResolvedValue(hostPathFromNative(options.home ?? '/home/jona'));
  const exists = vi.fn(async ({ root, relative }) => {
    expect(relative).toBe(ROOT_RELATIVE_PATH);
    return ok(existingPaths.has(nativePathFromHost(root)));
  });
  const broker = {
    client: vi.fn(async () => ok({ files: { getHomeDir, fs: { exists } } })),
  };
  const resolver = new WorkspacePlacementResolver({
    broker: broker as never,
    getSettings: () => ({
      getWithMeta: vi.fn(async () => ({
        value: {},
        defaults: {},
        overrides: options.appOverrides ?? {},
      })) as never,
    }),
    findProjectByPath: vi.fn(async (_host, candidate) =>
      registeredPaths.has(candidate) ? project : undefined
    ),
    loadProjectWorktreeDirectory: vi.fn(async () => options.projectOverride),
  });
  return { resolver, broker, exists, getHomeDir };
}

describe('WorkspacePlacementResolver', () => {
  it('derives the project pool from the target host default', async () => {
    const { resolver, getHomeDir } = makeResolver({ home: '/home/jona' });

    await expect(resolver.resolveWorktreePool(project)).resolves.toEqual({
      success: true,
      data: '/home/jona/emdash/worktrees/emdash-ba5cbeaf',
    });
    await resolver.resolveWorktreePool(project);
    expect(getHomeDir).toHaveBeenCalledTimes(1);
  });

  it('expands a per-project override against the target host home', async () => {
    const { resolver } = makeResolver({
      home: '/home/remote',
      projectOverride: '~/fast-worktrees',
    });

    const remoteProject = {
      ...project,
      type: 'ssh' as const,
      connectionId: 'ssh-1',
      path: '/srv/repositories/emdash',
    };
    const result = await resolver.resolveWorktreePool(remoteProject);

    expect(result).toMatchObject({
      success: true,
      data: expect.stringMatching(/^\/home\/remote\/fast-worktrees\/emdash-[a-f0-9]{8}$/u),
    });
  });

  it('suffixes clone destinations occupied in either the filesystem or project registry', async () => {
    const { resolver } = makeResolver({
      home: '/home/jona',
      existingPaths: ['/chosen/emdash'],
      registeredPaths: ['/chosen/emdash-2'],
    });

    await expect(
      resolver.resolveRepositoryDestination(LOCAL_HOST_REF, 'emdash', '/chosen')
    ).resolves.toEqual({ success: true, data: '/chosen/emdash-3' });
  });

  it('uses an explicit app root on the target host when the UI does not choose one', async () => {
    const { resolver } = makeResolver({
      appOverrides: { defaultProjectsDirectory: '~/source' },
    });

    await expect(
      resolver.resolveRepositoryDestination(hostRef('remote', 'ssh-1'), 'api')
    ).resolves.toEqual({ success: true, data: '/home/jona/source/api' });
  });

  it('returns runtime and filesystem failures without allocating a path', async () => {
    const runtimeFailure = {
      type: 'runtime-host-unavailable' as const,
      host: LOCAL_HOST_REF,
      message: 'offline',
    };
    const resolver = new WorkspacePlacementResolver({
      broker: {
        client: async () => err(runtimeFailure),
      } as never,
      getSettings: () => ({ getWithMeta: vi.fn() }) as never,
      findProjectByPath: vi.fn(),
      loadProjectWorktreeDirectory: vi.fn(),
    });

    await expect(resolver.resolveRepositoryDestination(LOCAL_HOST_REF, 'repo')).resolves.toEqual(
      err(runtimeFailure)
    );
  });
});
