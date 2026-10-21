import { ok } from '@emdash/shared';
import { observable, runInAction } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import { gitRepositoryStoreToken } from '@core/features/source-control/contributions/browser/project-stores';
import { PullRequestRefreshController } from './pull-request-refresh-controller';

const repositoryUrl = 'https://github.com/emdash/emdash';
const otherRepositoryUrl = 'https://github.com/emdash/other';

function harness() {
  const projects = observable.map<string, unknown>();
  const revalidate = vi.fn(async () => ok(undefined));
  const getClient = vi.fn(async () => ({ refreshRepository: revalidate }));
  const window = new EventTarget();
  const controller = new PullRequestRefreshController({ projects } as never, getClient, { window });
  function addProject(projectId: string, url = repositoryUrl) {
    const repository = observable({ pullRequestRepositoryUrl: url });
    runInAction(() =>
      projects.set(projectId, {
        context: {
          kind: 'available',
          context: {
            get(token: unknown) {
              expect(token).toBe(gitRepositoryStoreToken);
              return repository;
            },
          },
        },
      })
    );
    return repository;
  }
  return { controller, projects, getClient, revalidate, window, addProject };
}

describe('PullRequestRefreshController', () => {
  it('does not refresh on activation, hydration, repository changes, focus or visibility', async () => {
    const h = harness();
    h.addProject('first');
    h.controller.activate();
    const repository = h.addProject('other');
    runInAction(() => {
      repository.pullRequestRepositoryUrl = otherRepositoryUrl;
    });
    h.window.dispatchEvent(new Event('focus'));
    h.window.dispatchEvent(new Event('visibilitychange'));
    // Navigation is deliberately not a dependency or event source for this controller.
    h.window.dispatchEvent(new Event('popstate'));
    await Promise.resolve();
    expect(h.getClient).not.toHaveBeenCalled();
    h.controller.dispose();
  });

  it('checks each unique current repository on reconnect and activates only once', async () => {
    const h = harness();
    h.addProject('first');
    h.addProject('duplicate', 'git@github.com:emdash/emdash.git');
    h.addProject('other', otherRepositoryUrl);
    h.projects.set('hydrating', { context: { kind: 'hydrating' } });
    h.controller.activate();
    h.controller.activate();
    h.window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(h.revalidate).toHaveBeenCalledTimes(2));
    expect(h.revalidate).toHaveBeenCalledWith({ repositoryUrl, policy: 'if-stale' });
    expect(h.revalidate).toHaveBeenCalledWith({
      repositoryUrl: otherRepositoryUrl,
      policy: 'if-stale',
    });
    h.controller.dispose();
  });

  it('uses current repository identities and excludes removed projects on reconnect', async () => {
    const h = harness();
    const repository = h.addProject('first');
    h.addProject('removed');
    h.controller.activate();
    runInAction(() => {
      repository.pullRequestRepositoryUrl = otherRepositoryUrl;
      h.projects.delete('removed');
    });
    h.window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(h.revalidate).toHaveBeenCalledTimes(1));
    expect(h.revalidate).toHaveBeenCalledWith({
      repositoryUrl: otherRepositoryUrl,
      policy: 'if-stale',
    });
    h.controller.dispose();
  });

  it('releases the listener and ignores client resolution after disposal', async () => {
    const h = harness();
    let resolve!: (client: { refreshRepository: typeof h.revalidate }) => void;
    h.getClient.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    h.addProject('first');
    h.controller.activate();
    h.window.dispatchEvent(new Event('online'));
    expect(h.getClient).toHaveBeenCalledTimes(1);
    h.controller.dispose();
    resolve({ refreshRepository: h.revalidate });
    await Promise.resolve();
    h.window.dispatchEvent(new Event('online'));
    h.addProject('other', otherRepositoryUrl);
    await Promise.resolve();
    expect(h.getClient).toHaveBeenCalledTimes(1);
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it('does not acquire a client when there are no repositories', () => {
    const h = harness();
    h.controller.activate();
    h.window.dispatchEvent(new Event('online'));
    expect(h.getClient).not.toHaveBeenCalled();
    h.controller.dispose();
  });
});
