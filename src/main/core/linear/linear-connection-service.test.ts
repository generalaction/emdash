import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ISSUE_PROVIDER_CAPABILITIES } from '@shared/issue-providers';
import { LinearConnectionService } from './linear-connection-service';

const mocks = vi.hoisted(() => {
  type Viewer = {
    displayName: string;
    organization: Promise<{ name: string }>;
  };

  class MockAuthenticationLinearError extends Error {
    status?: number;

    constructor(status?: number, message = 'Linear authentication error') {
      super(message);
      this.status = status;
    }
  }

  class MockForbiddenLinearError extends Error {
    status?: number;

    constructor(status?: number, message = 'Linear forbidden error') {
      super(message);
      this.status = status;
    }
  }

  const mockViewerValues: Array<Viewer | Promise<Viewer> | Error> = [];
  let viewerRequested: (() => void) | undefined;

  class MockLinearClient {
    get viewer() {
      viewerRequested?.();
      viewerRequested = undefined;

      const value = mockViewerValues.shift();
      if (value instanceof Error) {
        return Promise.reject(value);
      }

      return Promise.resolve(
        value ?? {
          displayName: 'Linear User',
          organization: Promise.resolve({ name: 'General Action' }),
        }
      );
    }
  }

  return {
    mockGetSecret: vi.fn(),
    mockSetSecret: vi.fn(),
    mockDeleteSecret: vi.fn(),
    mockViewerValues,
    setViewerRequestedHook: (hook: (() => void) | undefined) => {
      viewerRequested = hook;
    },
    MockAuthenticationLinearError,
    MockForbiddenLinearError,
    MockLinearClient,
  };
});

vi.mock('@linear/sdk', () => ({
  AuthenticationLinearError: mocks.MockAuthenticationLinearError,
  ForbiddenLinearError: mocks.MockForbiddenLinearError,
  LinearClient: mocks.MockLinearClient,
}));

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: (...args: unknown[]) => mocks.mockGetSecret(...args),
    setSecret: (...args: unknown[]) => mocks.mockSetSecret(...args),
    deleteSecret: (...args: unknown[]) => mocks.mockDeleteSecret(...args),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: vi.fn() },
}));

function viewer(displayName: string) {
  return {
    displayName,
    organization: Promise.resolve({ name: displayName }),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LinearConnectionService', () => {
  let service: LinearConnectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockViewerValues.length = 0;
    mocks.setViewerRequestedHook(undefined);
    mocks.mockGetSecret.mockResolvedValue('lin_token');
    mocks.mockSetSecret.mockResolvedValue(undefined);
    mocks.mockDeleteSecret.mockResolvedValue(undefined);
    service = new LinearConnectionService();
  });

  it('keeps Linear connected when the SDK maps an HTTP timeout to AuthenticationLinearError', async () => {
    mocks.mockViewerValues.push(
      viewer('General Action'),
      new mocks.MockAuthenticationLinearError(408, 'GraphQL Error (Code: 408)')
    );

    await expect(service.checkConnection()).resolves.toEqual({
      connected: true,
      displayName: 'General Action',
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });

    await expect(service.checkConnection()).resolves.toEqual({
      connected: true,
      displayName: 'General Action',
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });
  });

  it('keeps a stored Linear token connected when the first verification fails transiently', async () => {
    mocks.mockViewerValues.push(
      new mocks.MockAuthenticationLinearError(408, 'GraphQL Error (Code: 408)')
    );

    await expect(service.checkConnection()).resolves.toEqual({
      connected: true,
      displayName: undefined,
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });
  });

  it('disconnects Linear on a real authentication failure', async () => {
    mocks.mockViewerValues.push(new mocks.MockAuthenticationLinearError(401, 'Unauthorized'));

    await expect(service.checkConnection()).resolves.toEqual({
      connected: false,
      error: 'Unauthorized',
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });
  });

  it('disconnects Linear on a real forbidden failure', async () => {
    mocks.mockViewerValues.push(new mocks.MockForbiddenLinearError(403, 'Forbidden'));

    await expect(service.checkConnection()).resolves.toEqual({
      connected: false,
      error: 'Forbidden',
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });
  });

  it('keeps an invalid token disconnected after a later transient failure', async () => {
    mocks.mockViewerValues.push(
      new mocks.MockAuthenticationLinearError(401, 'Unauthorized'),
      new mocks.MockAuthenticationLinearError(408, 'GraphQL Error (Code: 408)')
    );

    await expect(service.checkConnection()).resolves.toEqual({
      connected: false,
      error: 'Unauthorized',
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });

    await expect(service.checkConnection()).resolves.toEqual({
      connected: false,
      error: 'Unauthorized',
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });
  });

  it('ignores a stale verification result after the token changes', async () => {
    const oldViewer = deferred<ReturnType<typeof viewer>>();
    const staleViewerRequested = deferred<void>();
    mocks.mockViewerValues.push(oldViewer.promise, viewer('New Workspace'));
    mocks.setViewerRequestedHook(() => staleViewerRequested.resolve());

    const staleCheck = service.checkConnection();
    await staleViewerRequested.promise;

    await expect(service.saveToken('new_token')).resolves.toEqual({
      success: true,
      workspaceName: 'New Workspace',
    });

    oldViewer.resolve(viewer('Old Workspace'));

    await expect(staleCheck).resolves.toEqual({
      connected: true,
      displayName: 'New Workspace',
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });

    mocks.mockViewerValues.push(
      new mocks.MockAuthenticationLinearError(408, 'GraphQL Error (Code: 408)')
    );

    await expect(service.checkConnection()).resolves.toEqual({
      connected: true,
      displayName: 'New Workspace',
      capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,
    });
  });
});
