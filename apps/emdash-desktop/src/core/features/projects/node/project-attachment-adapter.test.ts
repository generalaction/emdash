import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { WireError } from '@emdash/wire/rpc';
import { peek } from '@emdash/wire/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import type { RepoFacts } from '@core/primitives/project-settings/api';
import type { Project } from '@core/primitives/projects/api';
import { createWorkerHostAvailability } from '@core/services/hosts/node/worker-host-availability';
import type { CreateProjectProviderDependencies } from './create-project-provider';
import { createProjectAttachmentAdapter } from './project-attachment-adapter';
import { createProjectAttachmentManager } from './project-attachment-manager';
import {
  ProjectSettingsRepository,
  type StoredProjectSettings,
} from './settings/project-settings-storage';
import { createRepoFactsCache } from './settings/repo-facts';

vi.mock('./settings/repo-facts', () => ({ createRepoFactsCache: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(createRepoFactsCache).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const facts: RepoFacts = {
  remotes: [{ name: 'origin', host: 'github.com', headBranch: 'main', branches: ['main'] }],
  localBranches: ['main'],
};

function setup() {
  const project: Project = {
    id: 'slow-project',
    name: 'Slow project',
    path: 'C:\\Repos\\project',
    type: 'local',
    repositoryWorkspaceId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    baseRef: 'origin/main',
  };
  let row: StoredProjectSettings = {
    baseProjectSettingsJson: JSON.stringify({ baseRemote: 'origin', tmuxDefaultMigrated: true }),
    shareableProjectSettingsJson: '{}',
    legacyConfigMigratedAt: '2026-09-01T00:00:00.000Z',
  };
  vi.spyOn(ProjectSettingsRepository.prototype, 'get').mockImplementation(async () => row);
  vi.spyOn(ProjectSettingsRepository.prototype, 'mutate').mockImplementation(
    async (_id, change) => {
      row = { ...row, ...change(row) };
      return row;
    }
  );
  const repoFacts = { get: vi.fn(async () => facts), dispose: vi.fn(async () => {}) };
  vi.mocked(createRepoFactsCache).mockReturnValue(repoFacts);
  const inspectPath = vi.fn(async () => ok({ kind: 'repository' }));
  const fetch = { start: vi.fn(), stop: vi.fn() };
  const teardownAllForProject = vi.fn(async () => {});
  const createGitRepository = vi.fn(() => ({
    subscribeRemotes: vi.fn(() => () => {}),
    getBaseRemote: vi.fn(async () => 'origin'),
    getEffectiveRemotes: vi.fn(async () => ({ baseRemote: 'origin', pushRemote: 'origin' })),
    getRemoteState: vi.fn(),
  }));
  // Only external runtime and persistence boundaries are substituted. Provider
  // construction, settings migration, deadline and attachment ownership are real.
  const dependencies = {
    db: {} as CreateProjectProviderDependencies['db'],
    runtimes: {
      client: vi.fn(async () =>
        ok({
          git: { inspectPath },
          files: {
            fs: {
              stat: vi.fn(async () => ok({ type: 'directory' })),
              readText: vi.fn(async () => ({ success: false, error: { type: 'not-found' } })),
            },
            getHomeDir: vi.fn(async () => ({ path: hostPathFromNative('C:\\Users\\test') })),
          },
          hostSettings: { get: vi.fn(async () => ok({ settings: {} })) },
          terminals: {},
          workspaceRegistry: {},
        })
      ) as unknown as CreateProjectProviderDependencies['runtimes']['client'],
    },
    createGitRepository,
    createGitRepositoryFetch: vi.fn(() => fetch),
    ensureAbsoluteDir: vi.fn(async () => ok<void>()),
    getProjectDefaults: vi.fn(async () => ({ tmuxByDefault: false })),
    taskSessions: { teardownAllForProject },
  } satisfies CreateProjectProviderDependencies;
  const adapter = {
    ...createProjectAttachmentAdapter(dependencies),
    loadProject: async () => project,
  };
  return {
    project,
    adapter,
    dependencies,
    inspectPath,
    repoFacts,
    fetch,
    createGitRepository,
    teardownAllForProject,
  };
}

describe('Project attachment startup', () => {
  it('attaches an older Windows project when Git facts arrive after the former 20-second deadline', async () => {
    const h = setup();
    h.repoFacts.get.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25_000));
      return facts;
    });
    const scope = createScope({ label: 'slow-project-startup' });
    const manager = createProjectAttachmentManager({
      scope,
      availability: createWorkerHostAvailability({
        scope,
        readiness: { prepare: async () => ok() },
      }),
      adapter: h.adapter,
    });
    try {
      const state = manager.track(h.project.id, scope);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(peek(state).kind).toBe('attaching');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(peek(state).kind).toBe('attached');
      expect(manager.requireAttached(h.project.id).success).toBe(true);
      expect(h.fetch.start).toHaveBeenCalledOnce();
    } finally {
      // Avoid delaying disposal with the simulated cold-cache read.
      h.repoFacts.get.mockResolvedValue(facts);
      await scope.dispose();
    }
  });

  it.each(['cancel', 'deadline'] as const)(
    'releases partial resources on %s and never starts a late provider',
    async (reason) => {
      const h = setup();
      const pending = deferred<RepoFacts>();
      h.repoFacts.get.mockReturnValue(pending.promise);
      const controller = new AbortController();
      const opened = h.adapter.open(h.project, controller.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.repoFacts.get).toHaveBeenCalledOnce();
      if (reason === 'cancel') controller.abort();
      else await vi.advanceTimersByTimeAsync(60_000);
      expect((await opened).success).toBe(false);
      expect(h.repoFacts.dispose).toHaveBeenCalledOnce();
      pending.resolve(facts);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.createGitRepository).not.toHaveBeenCalled();
      expect(h.fetch.start).not.toHaveBeenCalled();
      expect(h.teardownAllForProject).not.toHaveBeenCalled();
    }
  );

  it('recovers automatically from one local Wire timeout within the attachment budget', async () => {
    const h = setup();
    h.inspectPath.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      throw new WireError('TIMEOUT', "Wire call 'inspectPath' timed out after 30000ms");
    });
    const opened = h.adapter.open(h.project, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(31_001);
    const result = await opened;
    expect(result.success).toBe(true);
    expect(h.inspectPath).toHaveBeenCalledTimes(2);
    if (result.success) await result.data.release();
  });

  it('bounds retries when the local runtime keeps timing out', async () => {
    const h = setup();
    h.inspectPath.mockRejectedValue(new WireError('TIMEOUT', 'Runtime timed out'));
    const opened = h.adapter.open(h.project, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await opened).toMatchObject({ success: false, error: { message: 'Runtime timed out' } });
    expect(h.inspectPath).toHaveBeenCalledTimes(2);
  });

  it('does not retry ordinary initialization failures', async () => {
    const h = setup();
    h.inspectPath.mockRejectedValue(new Error('Permission denied'));
    expect(await h.adapter.open(h.project, new AbortController().signal)).toMatchObject({
      success: false,
      error: { message: 'Permission denied' },
    });
    expect(h.inspectPath).toHaveBeenCalledOnce();
  });

  it('cancels the retry delay when the attachment owner goes away', async () => {
    const h = setup();
    h.inspectPath.mockRejectedValueOnce(new WireError('TIMEOUT', 'Runtime timed out'));
    const controller = new AbortController();
    const opened = h.adapter.open(h.project, controller.signal);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    expect((await opened).success).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.inspectPath).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves SSH timeout recovery to the Host supervisor', async () => {
    const h = setup();
    h.inspectPath.mockRejectedValue(new WireError('TIMEOUT', 'Remote timed out'));
    const project: Project = { ...h.project, type: 'ssh', connectionId: 'remote-host' };
    expect(await h.adapter.open(project, new AbortController().signal)).toMatchObject({
      success: false,
      error: { message: 'Remote timed out' },
    });
    expect(h.inspectPath).toHaveBeenCalledOnce();
  });

  it('cancels an in-flight inspection without allocating a late provider', async () => {
    const h = setup();
    const pending = deferred<ReturnType<typeof ok<{ kind: string }>>>();
    h.inspectPath.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const opened = h.adapter.open(h.project, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.inspectPath).toHaveBeenCalledWith(expect.anything(), {
      signal: expect.any(AbortSignal),
    });
    controller.abort();
    expect((await opened).success).toBe(false);
    pending.resolve(ok({ kind: 'repository' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(createRepoFactsCache).not.toHaveBeenCalled();
    expect(h.fetch.start).not.toHaveBeenCalled();
  });

  it('cleans up resources when construction fails after starting background fetch', async () => {
    const h = setup();
    h.fetch.start.mockImplementation(() => {
      throw new Error('Fetch startup failed');
    });
    expect(await h.adapter.open(h.project, new AbortController().signal)).toMatchObject({
      success: false,
      error: { message: 'Fetch startup failed' },
    });
    expect(h.fetch.stop).toHaveBeenCalledOnce();
    expect(h.repoFacts.dispose).toHaveBeenCalledOnce();
    expect(h.teardownAllForProject).not.toHaveBeenCalled();
  });

  it('releases a provider cancelled at handoff without tearing down live task sessions', async () => {
    const h = setup();
    const controller = new AbortController();
    h.fetch.start.mockImplementation(() => controller.abort());
    const opened = h.adapter.open(h.project, controller.signal);
    expect((await opened).success).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetch.stop).toHaveBeenCalledOnce();
    expect(h.repoFacts.dispose).toHaveBeenCalledOnce();
    expect(h.teardownAllForProject).not.toHaveBeenCalled();
  });
});
