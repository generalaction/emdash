import { describe, expect, it, vi } from 'vitest';
import type { ProjectWorkspacesResult } from '@core/primitives/workspaces/api';
import { WorkspaceScanCache } from './workspace-scan-cache';

describe('WorkspaceScanCache', () => {
  it('returns cached results until they become stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cache = new WorkspaceScanCache();
    const refresh = vi
      .fn<() => Promise<ProjectWorkspacesResult>>()
      .mockResolvedValueOnce(result('project-1', ['/repo/a']))
      .mockResolvedValueOnce(result('project-1', ['/repo/b']));

    await expect(cache.getOrRefresh('project-1', refresh)).resolves.toMatchObject({
      rows: [{ path: '/repo/a' }],
    });
    await expect(cache.getOrRefresh('project-1', refresh)).resolves.toMatchObject({
      rows: [{ path: '/repo/a' }],
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(40_000);
    await expect(cache.getOrRefresh('project-1', refresh, { maxAgeMs: 10 })).resolves.toMatchObject(
      {
        rows: [{ path: '/repo/a' }],
      }
    );
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(cache.get('project-1')).toMatchObject({ rows: [{ path: '/repo/b' }] });
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('merges usage details without changing other rows', () => {
    const cache = new WorkspaceScanCache();
    cache.set('project-1', result('project-1', ['/repo/a', '/repo/b']));

    cache.mergeUsageResults('project-1', [
      {
        path: '/repo/a',
        success: true,
        usage: { totalBytes: 10, artifactBytes: 4, errors: [] },
      },
    ]);

    expect(cache.get('project-1')).toMatchObject({
      totalBytes: 10,
      artifactBytes: 4,
      rows: [
        { path: '/repo/a', usage: { totalBytes: 10, artifactBytes: 4 } },
        { path: '/repo/b', usage: null },
      ],
    });
  });

  it('evicts paths per project and keeps other projects isolated', () => {
    const cache = new WorkspaceScanCache();
    cache.set('project-1', result('project-1', ['/repo/a']));
    cache.set('project-2', result('project-2', ['/repo/a']));

    cache.evict('project-1', '/repo/a');

    expect(cache.get('project-1')?.rows).toEqual([]);
    expect(cache.get('project-2')?.rows).toMatchObject([{ path: '/repo/a' }]);
  });

  it('evicts host resources only from matching host entries', () => {
    const cache = new WorkspaceScanCache();
    cache.set('local-project', result('local-project', ['/repo/a']), { hostId: 'local' });
    cache.set('remote-project', result('remote-project', ['/repo/a']), { hostId: 'remote-1' });
    cache.set('unknown-host-project', result('unknown-host-project', ['/repo/a']));

    cache.evictResource({ kind: 'worktree', hostId: 'remote-1', path: '/repo/a' });

    expect(cache.get('local-project')?.rows).toMatchObject([{ path: '/repo/a' }]);
    expect(cache.get('remote-project')?.rows).toEqual([]);
    expect(cache.get('unknown-host-project')?.rows).toEqual([]);
  });
});

function result(projectId: string, paths: string[]): ProjectWorkspacesResult {
  const rows = paths.map((path) => ({
    kind: 'workspace' as const,
    projectId,
    workspaceId: `${projectId}:${path}`,
    path,
    tasks: [],
    usage: null,
    pathState: 'measured' as const,
    canCleanArtifacts: true,
    canDelete: true,
    hasActiveSessions: false,
    errors: [],
  }));
  return {
    scannedAt: new Date().toISOString(),
    projectId,
    rows,
    totalBytes: 0,
    artifactBytes: 0,
    warnings: [],
  };
}
