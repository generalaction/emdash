import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestsRuntimeClient } from '@core/services/pull-requests/api';
import { PullRequestsRegistration } from './pull-requests-registration';

const mocks = vi.hoisted(() => ({
  projects: new Map<
    string,
    { remoteUrls: string[]; subscribeRemotes?: (handler: () => void) => () => void }
  >(),
  resolveAuth: vi.fn(),
  workerReady: new Set<() => void>(),
  resume: new Set<() => void>(),
}));

vi.mock('@emdash/shared/logger', () => ({
  log: { warn: vi.fn() },
}));

function createClient() {
  return {
    registerRepository: vi.fn(async () => ok()),
    unregisterRepository: vi.fn(async () => ok()),
    releaseRepository: vi.fn(async () => ok()),
    refreshRepository: vi.fn(async () => ok()),
  };
}

function createRegistration(client: ReturnType<typeof createClient>) {
  return new PullRequestsRegistration({
    getClient: async () => client as unknown as PullRequestsRuntimeClient,
    onProjectOpened: vi.fn(() => () => {}),
    onProjectClosed: vi.fn(() => () => {}),
    onResume: (handler) => {
      mocks.resume.add(handler);
      return () => {
        mocks.resume.delete(handler);
      };
    },
    onWorkerReady: (handler) => {
      mocks.workerReady.add(handler);
      return () => {
        mocks.workerReady.delete(handler);
      };
    },
    subscribeToProjectRemotes: (projectId, handler) => {
      const project = mocks.projects.get(projectId);
      return project?.subscribeRemotes?.(handler);
    },
    resolveProjectRepositoryUrls: async (projectId) =>
      mocks.projects.get(projectId)?.remoteUrls ?? [],
    resolveProjectAuthContext: mocks.resolveAuth,
  });
}

describe('PullRequestsRegistration', () => {
  beforeEach(() => {
    mocks.projects.clear();
    mocks.workerReady.clear();
    mocks.resume.clear();
    mocks.resolveAuth.mockReset();
    mocks.resolveAuth.mockResolvedValue(ok({ accountId: 'account-1' }));
  });

  it('registers repositories without an account binding', async () => {
    const repositoryUrl = 'https://github.com/acme/repo';
    mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    const client = createClient();
    const registration = createRegistration(client);

    await registration.onProjectOpened('project-1');

    expect(client.registerRepository).toHaveBeenCalledWith({ repositoryUrl });
    expect(mocks.resolveAuth).not.toHaveBeenCalled();
  });

  it('replays only current shared repository interest after every worker restart', async () => {
    const shared = 'https://github.com/acme/shared';
    const closed = 'https://github.com/acme/closed';
    mocks.projects.set('one', { remoteUrls: [shared] });
    mocks.projects.set('two', { remoteUrls: [shared] });
    mocks.projects.set('closed', { remoteUrls: [closed] });
    const client = createClient();
    const registration = createRegistration(client);
    registration.initialize();
    await registration.onProjectOpened('one');
    await registration.onProjectOpened('two');
    await registration.onProjectOpened('closed');
    await registration.onProjectClosed('closed');
    for (let generation = 0; generation < 2; generation++) {
      client.registerRepository.mockClear();
      for (const ready of mocks.workerReady) ready();
      await vi.waitFor(() =>
        expect(client.registerRepository).toHaveBeenCalledExactlyOnceWith({ repositoryUrl: shared })
      );
    }
    registration.dispose();
    client.registerRepository.mockClear();
    for (const ready of mocks.workerReady) ready();
    await Promise.resolve();
    expect(client.registerRepository).not.toHaveBeenCalled();
  });

  it('revalidates only unique current repositories on wake and removes the listener on disposal', async () => {
    const shared = 'https://github.com/acme/shared';
    const closed = 'https://github.com/acme/closed';
    mocks.projects.set('one', { remoteUrls: [shared] });
    mocks.projects.set('two', { remoteUrls: [shared] });
    mocks.projects.set('closed', { remoteUrls: [closed] });
    const client = createClient();
    const registration = createRegistration(client);
    registration.initialize();
    await registration.onProjectOpened('one');
    await registration.onProjectOpened('two');
    await registration.onProjectOpened('closed');
    await registration.onProjectClosed('closed');
    expect(client.refreshRepository).not.toHaveBeenCalled();
    for (const resume of mocks.resume) resume();
    await vi.waitFor(() =>
      expect(client.refreshRepository).toHaveBeenCalledExactlyOnceWith({
        repositoryUrl: shared,
        policy: 'if-stale',
      })
    );
    registration.dispose();
    expect(mocks.resume.size).toBe(0);
  });

  it('only cancels a shared repository after its last project closes', async () => {
    const repositoryUrl = 'https://github.com/acme/shared';
    mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    mocks.projects.set('project-2', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    const client = createClient();
    const registration = createRegistration(client);

    await registration.onProjectOpened('project-1');
    await registration.onProjectOpened('project-2');
    await registration.onProjectClosed('project-1');
    expect(client.releaseRepository).not.toHaveBeenCalled();

    await registration.onProjectClosed('project-2');
    expect(client.releaseRepository).toHaveBeenCalledWith({ repositoryUrl });
  });

  it.each(['releaseRepository', 'unregisterRepository'] as const)(
    'waits for a pending %s before registering a reopened repository',
    async (operation) => {
      const repositoryUrl = 'https://github.com/acme/repo';
      mocks.projects.set('project', { remoteUrls: [repositoryUrl] });
      const client = createClient();
      const registration = createRegistration(client);
      const events: string[] = [];
      client.registerRepository.mockImplementation(async () => {
        events.push('register');
        return ok();
      });
      await registration.onProjectOpened('project');
      let finish!: () => void;
      client[operation].mockImplementationOnce(async () => {
        events.push('stop started');
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        events.push('stop finished');
        return ok();
      });
      const closing =
        operation === 'releaseRepository'
          ? registration.onProjectClosed('project')
          : registration.deleteProjectData('project');
      await vi.waitFor(() => expect(finish).toBeDefined());
      const reopening = registration.onProjectOpened('project');
      try {
        await vi.waitFor(async () => {
          await expect(registration.resolveSyncIdentity(repositoryUrl)).resolves.toEqual(
            ok({ accountId: 'account-1' })
          );
        });
        expect(events).toEqual(['register', 'stop started']);
      } finally {
        finish();
        await Promise.all([closing, reopening]);
      }
      expect(events).toEqual(['register', 'stop started', 'stop finished', 'register']);
    }
  );

  it('does not block a different repository while a release is pending', async () => {
    const slow = 'https://github.com/acme/slow';
    const other = 'https://github.com/acme/other';
    mocks.projects.set('slow', { remoteUrls: [slow] });
    mocks.projects.set('other', { remoteUrls: [other] });
    const client = createClient();
    const registration = createRegistration(client);
    await registration.onProjectOpened('slow');
    let finish!: () => void;
    client.releaseRepository.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return ok();
    });
    const closing = registration.onProjectClosed('slow');
    await vi.waitFor(() => expect(finish).toBeDefined());
    try {
      const opening = registration.onProjectOpened('other');
      await vi.waitFor(() =>
        expect(client.registerRepository).toHaveBeenCalledWith({ repositoryUrl: other })
      );
      await opening;
    } finally {
      finish();
      await closing;
    }
  });

  it('skips a queued release when the repository is referenced again before it runs', async () => {
    const repositoryUrl = 'https://github.com/acme/repo';
    mocks.projects.set('project', { remoteUrls: [repositoryUrl] });
    const client = createClient();
    const registration = createRegistration(client);
    await registration.onProjectOpened('project');
    let finish!: () => void;
    client.registerRepository.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return ok();
    });
    const refreshing = registration.refreshProject('project');
    await vi.waitFor(() => expect(finish).toBeDefined());
    const closing = registration.onProjectClosed('project');
    const reopening = registration.onProjectOpened('project');
    try {
      await vi.waitFor(async () => {
        await expect(registration.resolveSyncIdentity(repositoryUrl)).resolves.toEqual(
          ok({ accountId: 'account-1' })
        );
      });
    } finally {
      finish();
      await Promise.all([refreshing, closing, reopening]);
    }
    expect(client.releaseRepository).not.toHaveBeenCalled();
  });

  it('releases replayed interest if the project closes while registration is in flight', async () => {
    const repositoryUrl = 'https://github.com/acme/repo';
    mocks.projects.set('project', { remoteUrls: [repositoryUrl] });
    const client = createClient();
    const registration = createRegistration(client);
    registration.initialize();
    await registration.onProjectOpened('project');
    let finish!: () => void;
    client.registerRepository.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return ok();
    });
    for (const ready of mocks.workerReady) ready();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const closing = registration.onProjectClosed('project');
    finish();
    await closing;
    await vi.waitFor(() => expect(client.releaseRepository).toHaveBeenCalledTimes(2));
    registration.dispose();
  });

  it('does not subscribe or register repositories when a project has no repository', async () => {
    mocks.projects.set('project-1', { remoteUrls: [] });
    const client = createClient();
    const registration = createRegistration(client);

    await registration.onProjectOpened('project-1');

    expect(client.registerRepository).not.toHaveBeenCalled();
  });

  it('unregisters repositories when their project is deleted', async () => {
    const repositoryUrl = 'https://github.com/acme/deleted';
    mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    const client = createClient();
    const registration = createRegistration(client);

    await registration.onProjectOpened('project-1');
    await registration.deleteProjectData('project-1');

    expect(client.unregisterRepository).toHaveBeenCalledWith({ repositoryUrl });
  });

  describe('resolveSyncIdentity', () => {
    it('resolves the effective account of an open project at request time', async () => {
      const repositoryUrl = 'https://github.com/acme/repo';
      mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
      const registration = createRegistration(createClient());
      await registration.onProjectOpened('project-1');

      await expect(registration.resolveSyncIdentity(repositoryUrl)).resolves.toEqual(
        ok({ accountId: 'account-1' })
      );

      // An account change is visible on the very next request — no event plumbing.
      mocks.resolveAuth.mockResolvedValue(ok({ accountId: 'account-2' }));
      await expect(registration.resolveSyncIdentity(repositoryUrl)).resolves.toEqual(
        ok({ accountId: 'account-2' })
      );
    });

    it('fails closed when no open project references the repository', async () => {
      const registration = createRegistration(createClient());

      await expect(
        registration.resolveSyncIdentity('https://github.com/acme/unknown')
      ).resolves.toEqual(
        err({
          type: 'account_unresolvable',
          host: 'github.com',
          message: 'No open project references this repository.',
        })
      );
      expect(mocks.resolveAuth).not.toHaveBeenCalled();
    });

    it('fails closed on an unresolvable account pin, never a fallback identity', async () => {
      const repositoryUrl = 'https://github.com/acme/repo';
      mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
      mocks.resolveAuth.mockResolvedValue(
        err({
          type: 'account_selection_failed',
          message: 'The pinned GitHub account no longer exists.',
        })
      );
      const registration = createRegistration(createClient());
      await registration.onProjectOpened('project-1');

      await expect(registration.resolveSyncIdentity(repositoryUrl)).resolves.toEqual(
        err({
          type: 'account_unresolvable',
          host: 'github.com',
          message: 'The pinned GitHub account no longer exists.',
        })
      );
    });

    it('maps an explicitly disabled account to a quiet disabled status', async () => {
      const repositoryUrl = 'https://github.com/acme/repo';
      mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
      mocks.resolveAuth.mockResolvedValue(
        err({ type: 'disabled', message: 'GitHub API is disabled for this project.' })
      );
      const registration = createRegistration(createClient());
      await registration.onProjectOpened('project-1');

      await expect(registration.resolveSyncIdentity(repositoryUrl)).resolves.toEqual(
        err({
          type: 'github_disabled',
          host: 'github.com',
          message: 'GitHub API is disabled for this project.',
        })
      );
    });

    it('maps a missing account inference to a connect prompt', async () => {
      const repositoryUrl = 'https://github.com/acme/repo';
      mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
      mocks.resolveAuth.mockResolvedValue(
        err({ type: 'unconfigured', message: 'No connected GitHub account matches this project.' })
      );
      const registration = createRegistration(createClient());
      await registration.onProjectOpened('project-1');

      await expect(registration.resolveSyncIdentity(repositoryUrl)).resolves.toEqual(
        err({
          type: 'auth_required',
          host: 'github.com',
          message: 'No connected GitHub account matches this project.',
          hint: 'Connect a GitHub account from settings.',
        })
      );
    });

    it('uses the first referencing project that resolves an account', async () => {
      const repositoryUrl = 'https://github.com/acme/shared';
      mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
      mocks.projects.set('project-2', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
      const registration = createRegistration(createClient());
      await registration.onProjectOpened('project-1');
      await registration.onProjectOpened('project-2');
      mocks.resolveAuth
        .mockResolvedValueOnce(err({ type: 'account_selection_failed', message: 'Broken pin.' }))
        .mockResolvedValueOnce(ok({ accountId: 'account-2' }));

      await expect(registration.resolveSyncIdentity(repositoryUrl)).resolves.toEqual(
        ok({ accountId: 'account-2' })
      );
    });
  });
});
