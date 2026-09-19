import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { retrySchedules } from '@emdash/shared/scheduling';
import { createController } from '@emdash/wire/rpc';
import { FakeWorkerProcessSpawner } from '@emdash/wire/testing';
import { createWireWorkerHost, runWireComponentWorker } from '@emdash/wire/worker';
import { describe, expect, it, vi } from 'vitest';
import { gitPlatformAuthContract } from '../api';
import { pullRequestsComponent } from './component';
import { PullRequestsRegistration } from './pull-requests-registration';

const githubAuthController = createController(gitPlatformAuthContract, {
  resolveAuth: () =>
    err({
      type: 'auth_required',
      host: 'github.com',
      message: 'GitHub authentication required',
      hint: 'Connect GitHub',
    }),
});

describe('pullRequestsComponent', () => {
  it('restores periodic inventory for open projects after a supervised worker crash', async () => {
    const spawner = new FakeWorkerProcessSpawner();
    const scope = createScope();
    const host = createWireWorkerHost({ scope, processSpawner: spawner });
    const resolveAuth = vi.fn(() =>
      err({ type: 'auth_required' as const, host: 'github.com', message: 'No token' })
    );
    const worker = host.create(pullRequestsComponent, {
      executable: 'pull-requests-worker',
      dependencies: { githubAuth: createController(gitPlatformAuthContract, { resolveAuth }) },
      config: { databasePath: ':memory:', incrementalIntervalMs: 30 },
      shutdownGraceMs: 0,
      supervision: { restart: 'on-failure', schedule: retrySchedules.sequence([0]) },
    });
    const ready = worker.ready();
    await flush();
    void runWireComponentWorker(pullRequestsComponent, {
      port: spawner.latest().childPort,
      exit: () => {},
    });
    const client = await ready;
    const repositoryUrl = 'https://github.com/emdash/emdash';
    const registration = new PullRequestsRegistration({
      getClient: async () => client,
      onWorkerReady: (handler) =>
        worker.onStateChanged((state) => {
          if (state.kind === 'ready') handler();
        }),
      onProjectOpened: () => () => {},
      onProjectClosed: () => () => {},
      onResume: () => () => {},
      subscribeToProjectRemotes: () => undefined,
      resolveProjectRepositoryUrls: async () => [repositoryUrl],
      resolveProjectAuthContext: async () => ok({ accountId: 'test' }),
    });
    registration.initialize();
    try {
      await registration.onProjectOpened('project');
      await vi.waitFor(() => expect(resolveAuth.mock.calls.length).toBeGreaterThanOrEqual(2));
      const oldGeneration = worker.state.kind === 'ready' ? worker.state.generation : 0;
      spawner.latest().emitExit({ code: 1 });
      await vi.waitFor(() => expect(spawner.processes).toHaveLength(2));
      resolveAuth.mockClear();
      void runWireComponentWorker(pullRequestsComponent, {
        port: spawner.latest().childPort,
        exit: () => {},
      });
      await vi.waitFor(() =>
        expect(worker.state).toMatchObject({ kind: 'ready', generation: oldGeneration + 1 })
      );
      // No project-open event, navigation or manual refresh after the crash.
      await vi.waitFor(() => expect(resolveAuth.mock.calls.length).toBeGreaterThanOrEqual(2));
      expect(await worker.ready()).toBe(client);
    } finally {
      registration.dispose();
      await host.dispose();
    }
  });

  it('runs in process with full validation and its private database', async () => {
    const scope = createScope({ label: 'pull-requests-test' });
    const component = pullRequestsComponent.create({
      scope,
      dependencies: {
        githubAuth: {
          resolveAuth: async () =>
            err({
              type: 'auth_required',
              host: 'github.com',
              message: 'GitHub authentication required',
              hint: 'Connect GitHub',
            }),
        },
      },
      config: { databasePath: ':memory:' },
    });
    const repositoryUrl = 'https://github.com/emdash/emdash';

    await expect(component.client.registerRepository({ repositoryUrl })).resolves.toEqual(ok());
    await expect(
      component.client.listPullRequests({
        repositoryUrls: [repositoryUrl],
        cursor: null,
        limit: 10,
      })
    ).resolves.toEqual(ok({ prs: [], nextCursor: null }));
    await component.dispose();
  });

  it('boots through WorkerHost and forwards the GitHub auth dependency', async () => {
    const spawner = new FakeWorkerProcessSpawner();
    const scope = createScope({ label: 'pull-requests-worker-test' });
    const host = createWireWorkerHost({ scope, processSpawner: spawner });
    const worker = host.create(pullRequestsComponent, {
      executable: 'pull-requests-worker',
      dependencies: { githubAuth: githubAuthController },
      config: { databasePath: ':memory:' },
      shutdownGraceMs: 0,
    });

    const ready = worker.ready();
    await flush();
    void runWireComponentWorker(pullRequestsComponent, {
      port: spawner.latest().childPort,
      exit: () => {},
    });
    const client = await ready;
    const repositoryUrl = 'https://github.com/emdash/emdash';
    await expect(client.registerRepository({ repositoryUrl })).resolves.toEqual(ok());
    await expect(client.refreshRepository({ repositoryUrl, policy: 'force' })).resolves.toEqual(
      err({
        type: 'github_auth_required',
        host: 'github.com',
        hint: 'Connect GitHub',
      })
    );
    await expect(
      client.listPullRequests({ repositoryUrls: [repositoryUrl], cursor: null, limit: 10 })
    ).resolves.toEqual(ok({ prs: [], nextCursor: null }));

    await host.dispose();
  });
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
