import { err, ok } from '@emdash/shared';
import { createStubLogger } from '@emdash/shared/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationDeviceFlowService } from './integration-device-flow-service';

const plugins = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@emdash/plugins/integrations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@emdash/plugins/integrations')>()),
  integrationPluginRegistry: { get: (id: string) => plugins.get(id) },
}));

const credentials = {
  instanceUrl: 'https://gitlab.com',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1,
};

function devicePlugin(complete: (signal: AbortSignal) => Promise<unknown>) {
  const verify = vi.fn(async () => ({
    connected: true as const,
    account: { id: '42', login: 'tdewitt', host: 'gitlab.com' },
    displayName: 'Tucker',
    credentials,
  }));
  plugins.set('gitlab', {
    behavior: {
      auth: {
        verify,
        startDeviceAuthorization: async () =>
          ok({
            userCode: 'N03SDJ4B',
            verificationUri: 'https://gitlab.com/oauth/device',
            expiresIn: 300,
            complete,
          }),
      },
    },
  });
  return { verify };
}

describe('IntegrationDeviceFlowService', () => {
  const connectVerified = vi.fn();
  let service: IntegrationDeviceFlowService;

  beforeEach(() => {
    plugins.clear();
    connectVerified.mockReset();
    connectVerified.mockResolvedValue({
      success: true,
      accountId: 'https://gitlab.com:42',
      displayName: 'Tucker',
      account: { login: 'tdewitt', avatarUrl: 'https://gitlab.com/avatar.png' },
    });
    service = new IntegrationDeviceFlowService({
      connections: { connectVerified },
      logger: createStubLogger().logger,
    });
  });

  it('returns the user code, then verifies and saves the approved account', async () => {
    const { verify } = devicePlugin(async () => ok(credentials));

    const started = await service.start('gitlab');
    expect(started).toEqual({
      success: true,
      flowId: expect.any(String),
      userCode: 'N03SDJ4B',
      verificationUri: 'https://gitlab.com/oauth/device',
      expiresIn: 300,
    });
    if (!started.success) return;

    await expect(service.complete(started.flowId)).resolves.toEqual({
      success: true,
      accountId: 'https://gitlab.com:42',
      displayName: 'Tucker',
      login: 'tdewitt',
      avatarUrl: 'https://gitlab.com/avatar.png',
    });
    expect(verify).toHaveBeenCalledWith(expect.anything(), credentials);
    expect(connectVerified).toHaveBeenCalledWith(
      'gitlab',
      expect.objectContaining({ connected: true, credentials }),
      { credentialSource: 'device_flow' }
    );
    await expect(service.complete(started.flowId)).resolves.toMatchObject({ success: false });
  });

  it('reconnects the selected account', async () => {
    devicePlugin(async () => ok(credentials));
    const started = await service.start('gitlab', 'https://gitlab.com:42');
    if (!started.success) throw new Error('start failed');

    await service.complete(started.flowId);
    expect(connectVerified).toHaveBeenCalledWith('gitlab', expect.anything(), {
      accountId: 'https://gitlab.com:42',
      credentialSource: 'device_flow',
    });
  });

  it('reports a cancelled flow without saving an account', async () => {
    devicePlugin(
      (signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () =>
            resolve(err({ type: 'generic', message: 'GitLab sign-in was cancelled.' }))
          )
        )
    );
    const started = await service.start('gitlab');
    if (!started.success) throw new Error('start failed');

    const completion = service.complete(started.flowId);
    service.cancel(started.flowId);

    await expect(completion).resolves.toEqual({
      success: false,
      error: 'Sign-in was cancelled.',
      cancelled: true,
    });
    expect(connectVerified).not.toHaveBeenCalled();
  });

  it('passes through a denied or expired sign-in', async () => {
    devicePlugin(async () => err({ type: 'auth_failed', message: 'GitLab sign-in was denied.' }));
    const started = await service.start('gitlab');
    if (!started.success) throw new Error('start failed');

    await expect(service.complete(started.flowId)).resolves.toEqual({
      success: false,
      error: 'GitLab sign-in was denied.',
    });
    expect(connectVerified).not.toHaveBeenCalled();
  });

  it('does not save an account whose credentials fail verification', async () => {
    const { verify } = devicePlugin(async () => ok(credentials));
    verify.mockResolvedValueOnce({
      connected: false,
      error: 'GitLab authentication failed.',
    } as never);
    const started = await service.start('gitlab');
    if (!started.success) throw new Error('start failed');

    await expect(service.complete(started.flowId)).resolves.toEqual({
      success: false,
      error: 'GitLab authentication failed.',
    });
    expect(connectVerified).not.toHaveBeenCalled();
  });

  it('passes through an account save failure', async () => {
    devicePlugin(async () => ok(credentials));
    connectVerified.mockResolvedValueOnce({
      success: false,
      error: 'This account is already connected.',
    });
    const started = await service.start('gitlab');
    if (!started.success) throw new Error('start failed');

    await expect(service.complete(started.flowId)).resolves.toEqual({
      success: false,
      error: 'This account is already connected.',
    });
  });

  it('reports an unknown or finished flow', async () => {
    await expect(service.complete('missing')).resolves.toEqual({
      success: false,
      error: 'This sign-in is no longer active.',
    });
  });

  it('reports a failure to start sign-in', async () => {
    plugins.set('gitlab', {
      behavior: {
        auth: {
          verify: vi.fn(),
          startDeviceAuthorization: async () =>
            err({ type: 'host_unreachable', message: 'Could not reach GitLab.' }),
        },
      },
    });
    await expect(service.start('gitlab')).resolves.toEqual({
      success: false,
      error: 'Could not reach GitLab.',
    });
  });

  it('rejects integrations without device sign-in', async () => {
    plugins.set('jira', { behavior: { auth: { verify: vi.fn() } } });
    await expect(service.start('jira')).resolves.toEqual({
      success: false,
      error: 'jira does not support device sign-in.',
    });
  });

  it('does not save the account when cancelled during verification', async () => {
    const { verify } = devicePlugin(async () => ok(credentials));
    let release!: () => void;
    verify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ connected: true, credentials } as never);
        })
    );
    const started = await service.start('gitlab');
    if (!started.success) throw new Error('start failed');

    const completion = service.complete(started.flowId);
    await vi.waitFor(() => expect(verify).toHaveBeenCalled());
    service.cancel(started.flowId);
    release();

    await expect(completion).resolves.toMatchObject({ success: false, cancelled: true });
    expect(connectVerified).not.toHaveBeenCalled();
  });

  it('polls a flow once when completed twice', async () => {
    const complete = vi.fn(() => new Promise<never>(() => {}));
    devicePlugin(complete);
    const started = await service.start('gitlab');
    if (!started.success) throw new Error('start failed');

    void service.complete(started.flowId);
    await expect(service.complete(started.flowId)).resolves.toEqual({
      success: false,
      error: 'This sign-in is no longer active.',
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
