import {
  defineRepositoryPlugin,
  registerRepositoryPluginBehavior,
  type RepositoryHostProbeResult,
  type RepositoryPluginProvider,
} from '@emdash/plugins/repository';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryRouter } from './repository-router';

function plugin(
  integrationId: string,
  options: {
    knownHosts?: string[];
    probe?: (hostname: string) => Promise<RepositoryHostProbeResult>;
  } = {}
): RepositoryPluginProvider {
  const definition = defineRepositoryPlugin(
    { integrationId },
    { repository: { knownHosts: options.knownHosts ?? [] } },
    {}
  );
  return registerRepositoryPluginBehavior(definition, {
    repository: {
      listOwners: async () => ok([]),
      createRepository: async () => err({ type: 'generic', message: 'unused' }),
      deleteRepository: async () => ok(),
      ...(options.probe ? { probeHost: (_host, hostname) => options.probe!(hostname) } : {}),
    },
  });
}

describe('RepositoryRouter', () => {
  const accounts = new Map<string, Array<{ host?: string }>>();
  const listAccounts = vi.fn(async (integrationId: string) => accounts.get(integrationId) ?? []);

  beforeEach(() => {
    accounts.clear();
    listAccounts.mockClear();
  });

  function router(plugins: RepositoryPluginProvider[], now = () => 0) {
    return new RepositoryRouter({ plugins: () => plugins, listAccounts, now });
  }

  it('routes a declared host without listing accounts or probing', async () => {
    const probe = vi.fn(async (_hostname: string): Promise<RepositoryHostProbeResult> => ok());
    const result = await router([plugin('github', { knownHosts: ['github.com'], probe })]).route(
      'git@github.com:emdash/emdash.git'
    );
    expect(result).toEqual(
      ok({
        integrationId: 'github',
        repository: expect.objectContaining({
          host: 'github.com',
          repositoryUrl: 'https://github.com/emdash/emdash',
        }),
      })
    );
    expect(listAccounts).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it('routes to the integration with a connected account on the host, keeping nested groups', async () => {
    accounts.set('gitlab', [{ host: 'gitlab.com' }]);
    const result = await router([
      plugin('github', { knownHosts: ['github.com'] }),
      plugin('gitlab'),
    ]).route('https://gitlab.com/group/sub/project.git');
    expect(result).toEqual(
      ok({
        integrationId: 'gitlab',
        repository: expect.objectContaining({
          host: 'gitlab.com',
          nameWithOwner: 'group/sub/project',
        }),
      })
    );
  });

  it('still requires the probe to pass for an account-matched host that can be probed', async () => {
    accounts.set('github', [{ host: 'ghe.example.com' }]);
    const probe = vi.fn(
      async (hostname: string): Promise<RepositoryHostProbeResult> =>
        err({ type: 'host_unreachable' as const, host: hostname, message: 'ENOTFOUND' })
    );
    expect(
      await router([plugin('github', { knownHosts: ['github.com'], probe })]).route(
        'https://ghe.example.com/acme/repo'
      )
    ).toEqual(err({ type: 'host_unreachable', host: 'ghe.example.com', reason: 'ENOTFOUND' }));
  });

  it('reports a host that two connected integrations claim as ambiguous', async () => {
    accounts.set('a', [{ host: 'git.example.com' }]);
    accounts.set('b', [{ host: 'GIT.example.com' }]);
    expect(await router([plugin('a'), plugin('b')]).route('https://git.example.com/x/y')).toEqual(
      err({ type: 'ambiguous_host', host: 'git.example.com', integrationIds: ['a', 'b'] })
    );
  });

  it('probes unclaimed hosts, so unconnected GitHub Enterprise still routes', async () => {
    const probe = vi.fn(async (_hostname: string): Promise<RepositoryHostProbeResult> => ok());
    expect(
      await router([plugin('github', { knownHosts: ['github.com'], probe })]).route(
        'https://ghe.example.com/acme/repo'
      )
    ).toMatchObject({ success: true, data: { integrationId: 'github' } });
    expect(probe).toHaveBeenCalledWith('ghe.example.com');
  });

  it('errors instead of defaulting when no integration claims the host', async () => {
    const probe = vi.fn(async (hostname: string) =>
      err({ type: 'unsupported_host' as const, host: hostname, message: 'not GitHub' })
    );
    expect(
      await router([plugin('github', { knownHosts: ['github.com'], probe })]).route(
        'https://git.example.com/acme/repo'
      )
    ).toEqual(err({ type: 'no_integration_for_host', host: 'git.example.com' }));
  });

  it('reports an inconclusive probe rather than claiming no integration', async () => {
    const probe = vi.fn(async (hostname: string) =>
      err({ type: 'host_unreachable' as const, host: hostname, message: 'ENOTFOUND' })
    );
    expect(
      await router([plugin('github', { probe })]).route('https://ghe.example.com/acme/repo')
    ).toEqual(err({ type: 'host_unreachable', host: 'ghe.example.com', reason: 'ENOTFOUND' }));
  });

  it('rejects remotes that are not repository URLs', async () => {
    expect(await router([plugin('github')]).route('not a url')).toEqual(
      err({ type: 'invalid_remote' })
    );
  });

  it('caches probe results, expiring negative verdicts sooner', async () => {
    let now = 0;
    const probe = vi.fn(async (hostname: string) =>
      err({ type: 'unsupported_host' as const, host: hostname, message: 'no' })
    );
    const subject = router([plugin('github', { probe })], () => now);
    await subject.route('https://git.example.com/a/b');
    await subject.route('https://git.example.com/a/c');
    expect(probe).toHaveBeenCalledTimes(1);
    now = 2 * 60 * 1000 + 1;
    await subject.route('https://git.example.com/a/b');
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
