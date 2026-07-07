import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationHostContext } from '../../host';
import { provider } from './index';

const planeSdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  projectsList: vi.fn(),
  usersMe: vi.fn(),
}));

vi.mock('@makeplane/plane-node-sdk', () => ({
  PlaneClient: class {
    projects = { list: planeSdk.projectsList };
    users = { me: planeSdk.usersMe };

    constructor(config: unknown) {
      planeSdk.constructor(config);
    }
  },
}));

const auth = provider.behavior.auth;
if (!auth) throw new Error('Plane integration plugin has no auth behavior');

const host: IntegrationHostContext = {
  log: {
    level: 'error',
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => host.log,
  },
};

describe('plane integration verify', () => {
  afterEach(() => {
    planeSdk.constructor.mockReset();
    planeSdk.projectsList.mockReset();
    planeSdk.usersMe.mockReset();
  });

  it('rejects invalid API base URLs before making any request', async () => {
    const result = await auth.verify(host, {
      apiBaseUrl: 'plane.example.com',
      workspaceSlug: 'my-team',
      apiKey: 'token',
    });

    expect(result).toEqual({
      connected: false,
      error: 'A valid Plane API base URL is required.',
    });
    expect(planeSdk.constructor).not.toHaveBeenCalled();
  });

  it('validates and returns normalized self-hosted credentials', async () => {
    planeSdk.usersMe.mockResolvedValue({ display_name: 'Ada Lovelace' });
    planeSdk.projectsList.mockResolvedValue({ results: [] });

    const result = await auth.verify(host, {
      apiBaseUrl: 'https://plane.example.com/',
      workspaceSlug: 'my-team',
      apiKey: ' plane_api_token ',
    });

    expect(result).toEqual({
      connected: true,
      displayName: 'Ada Lovelace',
      displayDetail: 'my-team on plane.example.com',
      credentials: {
        apiBaseUrl: 'https://plane.example.com',
        workspaceSlug: 'my-team',
        apiKey: 'plane_api_token',
      },
    });

    expect(planeSdk.constructor).toHaveBeenCalledWith({
      apiKey: 'plane_api_token',
      baseUrl: 'https://plane.example.com',
    });
    expect(planeSdk.usersMe).toHaveBeenCalledWith();
    expect(planeSdk.projectsList).toHaveBeenCalledWith('my-team', { limit: 1 });
  });

  it('falls back to the email for the display name', async () => {
    planeSdk.usersMe.mockResolvedValue({ email: 'ada@example.com' });
    planeSdk.projectsList.mockResolvedValue({ results: [] });

    const result = await auth.verify(host, {
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
      apiKey: 'stored-token',
    });

    expect(result).toEqual(
      expect.objectContaining({
        connected: true,
        displayName: 'ada@example.com',
        displayDetail: 'my-team on api.plane.so',
      })
    );
  });

  it('maps authentication failures to a friendly error', async () => {
    planeSdk.usersMe.mockRejectedValue(httpError('Invalid API key', 401));

    const result = await auth.verify(host, {
      apiBaseUrl: 'https://api.plane.so',
      workspaceSlug: 'my-team',
      apiKey: 'bad-token',
    });

    expect(result).toEqual({
      connected: false,
      error: 'Plane authentication failed. Check your credentials.',
    });
  });
});

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
