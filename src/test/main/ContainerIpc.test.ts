import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedContainerConfig } from '@shared/container';

const { handlers, handleMock } = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>();
  const handleMock = vi.fn(
    (channel: string, handler: (event: unknown, args: unknown) => unknown) => {
      handlers.set(channel, handler);
    }
  );
  return { handlers, handleMock };
});

const { loadWorkspaceContainerConfigMock } = vi.hoisted(() => ({
  loadWorkspaceContainerConfigMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock('../../main/services/containerConfigService', async () => {
  const actual = await vi.importActual<typeof import('../../main/services/containerConfigService')>(
    '../../main/services/containerConfigService'
  );
  return {
    ...actual,
    loadWorkspaceContainerConfig: loadWorkspaceContainerConfigMock,
  };
});

// eslint-disable-next-line import/first
import { registerContainerIpc } from '../../main/ipc/containerIpc';

function getHandler(channel: string) {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler for ${channel} not registered`);
  }
  return handler;
}

describe('registerContainerIpc', () => {
  beforeEach(() => {
    handlers.clear();
    handleMock.mockClear();
    loadWorkspaceContainerConfigMock.mockReset();
  });

  it('returns resolved config when loader succeeds', async () => {
    const config: ResolvedContainerConfig = {
      version: 1,
      packageManager: 'pnpm',
      start: 'pnpm dev',
      workdir: '.',
      ports: [
        { service: 'app', container: 3000, protocol: 'tcp', preview: true },
        { service: 'api', container: 4000, protocol: 'tcp', preview: false },
      ],
    };
    loadWorkspaceContainerConfigMock.mockResolvedValue({
      ok: true,
      config,
      sourcePath: '/tmp/workspace/.emdash/config.json',
    });

    registerContainerIpc();
    const handler = getHandler('container:load-config');

    const result = await handler({}, { workspacePath: '  /tmp/workspace  ' });

    expect(loadWorkspaceContainerConfigMock).toHaveBeenCalledWith('/tmp/workspace');
    expect(result).toEqual({
      ok: true,
      config,
      sourcePath: '/tmp/workspace/.emdash/config.json',
    });
  });

  it('returns serialized validation error when loader fails', async () => {
    loadWorkspaceContainerConfigMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: '`service` must be a non-empty string',
        configKey: 'ports[0].service',
        configPath: '/tmp/workspace/.emdash/config.json',
      },
    });

    registerContainerIpc();
    const handler = getHandler('container:load-config');

    const result = await handler({}, { workspacePath: '/tmp/workspace' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: '`service` must be a non-empty string',
        configKey: 'ports[0].service',
        configPath: '/tmp/workspace/.emdash/config.json',
      },
    });
  });

  it('rejects missing workspace path', async () => {
    registerContainerIpc();
    const handler = getHandler('container:load-config');

    const result = await handler({}, {});

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_ARGUMENT',
        message: '`workspacePath` must be a non-empty string',
        configKey: null,
        configPath: null,
      },
    });
    expect(loadWorkspaceContainerConfigMock).not.toHaveBeenCalled();
  });

  it('handles unexpected loader errors', async () => {
    loadWorkspaceContainerConfigMock.mockRejectedValue(new Error('boom'));

    registerContainerIpc();
    const handler = getHandler('container:load-config');

    const result = await handler({}, { workspacePath: '/tmp/workspace' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Failed to load container configuration',
        configKey: null,
        configPath: null,
      },
    });
  });
});
