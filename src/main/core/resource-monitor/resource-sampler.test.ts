import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
const getAppMetricsMock = vi.hoisted(() => vi.fn());
const logWarnMock = vi.hoisted(() => vi.fn());
const pidusageMock = vi.hoisted(() => Object.assign(vi.fn(), { clear: vi.fn() }));
const registryState = vi.hoisted(() => ({
  active: [] as Array<{
    sessionId: string;
    pid: number | undefined;
    metadata?: { providerId?: 'amp'; title?: string };
  }>,
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('electron', () => ({
  app: {
    getAppMetrics: getAppMetricsMock,
  },
}));

vi.mock('pidusage', () => ({
  default: pidusageMock,
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    listActiveSessions: () => registryState.active,
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn().mockResolvedValue({ enabled: true }),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: logWarnMock,
  },
}));

const { sampleOnce } = await import('./resource-sampler');

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const MiB = 1024 * 1024;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    ...originalPlatform,
    value: platform,
  });
}

function mockProcessTree(stdout: string): void {
  execFileMock.mockImplementation((_file, _args, _options, callback) => {
    callback(null, stdout);
  });
}

function stat(
  cpu: number,
  memory: number,
  ppid: number
): { cpu: number; memory: number; ppid: number } {
  return { cpu, memory, ppid };
}

describe('resource sampler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('linux');
    registryState.active = [
      {
        sessionId: 'project-1:task-1:conversation-1',
        pid: 100,
        metadata: { providerId: 'amp', title: 'Amp' },
      },
    ];
    getAppMetricsMock.mockReturnValue([]);
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('samples a local PTY as the whole descendant process tree', async () => {
    mockProcessTree(['PID PPID', '100 1', '101 100', '102 101', '200 1', ''].join('\n'));
    pidusageMock.mockResolvedValue({
      100: stat(1, 3 * MiB, 1),
      101: stat(5, 50 * MiB, 100),
      102: stat(2, 20 * MiB, 101),
    });

    const snapshot = await sampleOnce();

    expect(pidusageMock).toHaveBeenCalledWith([100, 101, 102]);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      sessionId: 'project-1:task-1:conversation-1',
      pid: 100,
      ppid: 1,
      cpu: 8,
      memory: 73 * MiB,
      providerId: 'amp',
      title: 'Amp',
    });
  });

  it('samples only the root PID on Windows without calling ps', async () => {
    setPlatform('win32');
    pidusageMock.mockResolvedValue({
      100: stat(4, 12 * MiB, 1),
    });

    const snapshot = await sampleOnce();

    expect(execFileMock).not.toHaveBeenCalled();
    expect(pidusageMock).toHaveBeenCalledWith([100]);
    expect(snapshot.entries[0]).toMatchObject({
      pid: 100,
      ppid: 1,
      cpu: 4,
      memory: 12 * MiB,
    });
  });

  it('attributes separate process trees to separate active sessions', async () => {
    registryState.active = [
      {
        sessionId: 'project-1:task-1:conversation-1',
        pid: 100,
        metadata: { providerId: 'amp', title: 'Amp 1' },
      },
      {
        sessionId: 'project-2:task-2:conversation-2',
        pid: 200,
        metadata: { providerId: 'amp', title: 'Amp 2' },
      },
    ];
    mockProcessTree(
      ['PID PPID', '100 1', '101 100', '102 100', '200 1', '201 200', ''].join('\n')
    );
    pidusageMock.mockResolvedValue({
      100: stat(1, 3 * MiB, 1),
      101: stat(2, 10 * MiB, 100),
      102: stat(3, 20 * MiB, 100),
      200: stat(4, 4 * MiB, 1),
      201: stat(5, 40 * MiB, 200),
    });

    const snapshot = await sampleOnce();

    expect(pidusageMock).toHaveBeenCalledWith([100, 102, 101, 200, 201]);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[0]).toMatchObject({
      sessionId: 'project-1:task-1:conversation-1',
      pid: 100,
      ppid: 1,
      cpu: 6,
      memory: 33 * MiB,
      title: 'Amp 1',
    });
    expect(snapshot.entries[1]).toMatchObject({
      sessionId: 'project-2:task-2:conversation-2',
      pid: 200,
      ppid: 1,
      cpu: 9,
      memory: 44 * MiB,
      title: 'Amp 2',
    });
  });

  it('falls back to sampling the root PID when process tree lookup fails', async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(new Error('ps failed'));
    });
    pidusageMock.mockResolvedValue({
      100: stat(4, 12 * MiB, 1),
    });

    const snapshot = await sampleOnce();

    expect(logWarnMock).toHaveBeenCalledWith(
      'resource-sampler: process tree lookup failed',
      expect.any(Error)
    );
    expect(pidusageMock).toHaveBeenCalledWith([100]);
    expect(snapshot.entries[0]).toMatchObject({
      pid: 100,
      ppid: 1,
      cpu: 4,
      memory: 12 * MiB,
    });
  });
});
