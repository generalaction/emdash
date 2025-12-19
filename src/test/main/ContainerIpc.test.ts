import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedContainerConfig, RunnerEvent } from '@shared/container';

const {
  handlers,
  handleMock,
  windows,
  getAllWindowsMock,
  startRunMock,
  containerRunnerServiceMock,
  getRunnerEventListener,
  onRunnerEventMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>();
  const handleMock = vi.fn(
    (channel: string, handler: (event: unknown, args: unknown) => unknown) => {
      handlers.set(channel, handler);
    }
  );

  const windows: Array<{ webContents: { send: ReturnType<typeof vi.fn> } }> = [];
  const getAllWindowsMock = vi.fn(() => windows);

  const startRunMock = vi.fn();
  const containerRunnerServiceMock: any = {};
  let runnerListener: ((event: RunnerEvent) => void) | null = null;

  const onRunnerEventMock = vi.fn((listener: (event: RunnerEvent) => void) => {
    runnerListener = listener;
    return containerRunnerServiceMock;
  });

  containerRunnerServiceMock.onRunnerEvent = onRunnerEventMock;
  containerRunnerServiceMock.startRun = startRunMock;

  return {
    handlers,
    handleMock,
    windows,
    getAllWindowsMock,
    startRunMock,
    containerRunnerServiceMock,
    getRunnerEventListener: () => runnerListener,
    onRunnerEventMock,
  };
});

const { loadTaskContainerConfigMock } = vi.hoisted(() => ({
  loadTaskContainerConfigMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
}));

vi.mock('../../main/services/containerConfigService', async () => {
  const actual = await vi.importActual<typeof import('../../main/services/containerConfigService')>(
    '../../main/services/containerConfigService'
  );
  return {
    ...actual,
    loadTaskContainerConfig: loadTaskContainerConfigMock,
  };
});

vi.mock('../../main/services/containerRunnerService', () => ({
  containerRunnerService: containerRunnerServiceMock,
}));

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
    loadTaskContainerConfigMock.mockReset();
    startRunMock.mockReset();
    onRunnerEventMock.mockClear();
    windows.length = 0;
    getAllWindowsMock.mockClear();
  });

  describe('container:load-config', () => {
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
      loadTaskContainerConfigMock.mockResolvedValue({
        ok: true,
        config,
        sourcePath: '/tmp/task/.emdash/config.json',
      });

      registerContainerIpc();
      const handler = getHandler('container:load-config');

      const result = await handler({}, { taskPath: '  /tmp/task  ' });

      expect(loadTaskContainerConfigMock).toHaveBeenCalledWith('/tmp/task');
      expect(result).toEqual({
        ok: true,
        config,
        sourcePath: '/tmp/task/.emdash/config.json',
      });
    });

    it('returns serialized validation error when loader fails', async () => {
      loadTaskContainerConfigMock.mockResolvedValue({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: '`service` must be a non-empty string',
          configKey: 'ports[0].service',
          configPath: '/tmp/task/.emdash/config.json',
        },
      });

      registerContainerIpc();
      const handler = getHandler('container:load-config');

      const result = await handler({}, { taskPath: '/tmp/task' });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: '`service` must be a non-empty string',
          configKey: 'ports[0].service',
          configPath: '/tmp/task/.emdash/config.json',
        },
      });
    });

    it('rejects missing task path', async () => {
      registerContainerIpc();
      const handler = getHandler('container:load-config');

      const result = await handler({}, {});

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: '`taskPath` must be a non-empty string',
          configKey: null,
          configPath: null,
        },
      });
      expect(loadTaskContainerConfigMock).not.toHaveBeenCalled();
    });

    it('handles unexpected loader errors', async () => {
      loadTaskContainerConfigMock.mockRejectedValue(new Error('boom'));

      registerContainerIpc();
      const handler = getHandler('container:load-config');

      const result = await handler({}, { taskPath: '/tmp/task' });

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

  describe('container:start-run', () => {
    it('starts run via container runner service and returns run info', async () => {
      const config: ResolvedContainerConfig = {
        version: 1,
        packageManager: 'pnpm',
        start: 'pnpm dev',
        workdir: '.',
        ports: [{ service: 'app', container: 3000, protocol: 'tcp', preview: true }],
      };
      startRunMock.mockResolvedValue({
        ok: true,
        runId: 'run-123',
        config,
        sourcePath: '/tmp/task/.emdash/config.json',
      });

      registerContainerIpc();
      const handler = getHandler('container:start-run');

      const result = await handler({}, { taskId: ' ws-1 ', taskPath: ' /tmp/task ' });

      expect(startRunMock).toHaveBeenCalledWith({
        taskId: 'ws-1',
        taskPath: '/tmp/task',
      });
      expect(result).toEqual({
        ok: true,
        runId: 'run-123',
        sourcePath: '/tmp/task/.emdash/config.json',
      });
    });

    it('returns serialized error when runner service fails', async () => {
      startRunMock.mockResolvedValue({
        ok: false,
        error: {
          code: 'PORT_ALLOC_FAILED',
          message: 'Unable to allocate port',
          configKey: null,
          configPath: null,
        },
      });

      registerContainerIpc();
      const handler = getHandler('container:start-run');

      const result = await handler({}, { taskId: 'ws-1', taskPath: '/tmp/task' });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'PORT_ALLOC_FAILED',
          message: 'Unable to allocate port',
          configKey: null,
          configPath: null,
        },
      });
    });

    it('rejects invalid arguments', async () => {
      registerContainerIpc();
      const handler = getHandler('container:start-run');

      const result = await handler({}, { taskId: '', taskPath: '' });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: '`taskId` and `taskPath` must be provided to start a container run',
          configKey: null,
          configPath: null,
        },
      });
      expect(startRunMock).not.toHaveBeenCalled();
    });
  });

  it('forwards container runner events to renderer windows', () => {
    registerContainerIpc();
    const listener = getRunnerEventListener();
    expect(listener).toBeTruthy();

    const sendMock = vi.fn();
    windows.push({ webContents: { send: sendMock } });

    const event: RunnerEvent = {
      ts: 1700000000000,
      taskId: 'ws-1',
      runId: 'run-1',
      mode: 'container',
      type: 'lifecycle',
      status: 'building',
    };

    listener?.(event);

    expect(getAllWindowsMock).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith('run:event', event);
  });
});
