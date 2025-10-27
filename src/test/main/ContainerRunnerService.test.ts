import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedContainerConfig, RunnerEvent } from '@shared/container';
import { PortAllocationError } from '@shared/container';

const { loadWorkspaceContainerConfigMock } = vi.hoisted(() => ({
  loadWorkspaceContainerConfigMock: vi.fn(),
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
import { ContainerRunnerService } from '../../main/services/containerRunnerService';
// eslint-disable-next-line import/first
import { ContainerConfigLoadError } from '../../main/services/containerConfigService';

describe('ContainerRunnerService', () => {
  beforeEach(() => {
    loadWorkspaceContainerConfigMock.mockReset();
  });

  it('emits runner events and returns run info on success', async () => {
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

    const allocateMock = vi.fn(async () => [
      { service: 'app', protocol: 'tcp', container: 3000, host: 5000 },
      { service: 'api', protocol: 'tcp', container: 4000, host: 6000 },
    ]);

    const service = new ContainerRunnerService({ portAllocator: { allocate: allocateMock } });
    const events: RunnerEvent[] = [];
    service.onRunnerEvent((event) => events.push(event));

    const result = await service.startMockRun({
      workspaceId: 'ws-1',
      workspacePath: '/tmp/workspace',
      runId: 'run-123',
      now: () => 1700000000000,
    });

    expect(result).toEqual({
      ok: true,
      runId: 'run-123',
      config,
      sourcePath: '/tmp/workspace/.emdash/config.json',
    });
    expect(allocateMock).toHaveBeenCalledWith(config.ports);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      runId: 'run-123',
      type: 'lifecycle',
      status: 'building',
    });
    expect(events[events.length - 1]).toMatchObject({
      type: 'lifecycle',
      status: 'ready',
    });
  });

  it('returns config error without emitting events', async () => {
    const error = new ContainerConfigLoadError('VALIDATION_FAILED', 'Invalid config', {
      configKey: 'ports[0]',
      configPath: '/tmp/workspace/.emdash/config.json',
    });
    loadWorkspaceContainerConfigMock.mockResolvedValue({
      ok: false,
      error,
    });

    const service = new ContainerRunnerService({
      portAllocator: {
        allocate: vi.fn(),
      },
    });
    const listener = vi.fn();
    service.onRunnerEvent(listener);

    const result = await service.startMockRun({
      workspaceId: 'ws-1',
      workspacePath: '/tmp/workspace',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid config',
        configKey: 'ports[0]',
        configPath: '/tmp/workspace/.emdash/config.json',
      },
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('emits error event when port allocation fails', async () => {
    const config: ResolvedContainerConfig = {
      version: 1,
      packageManager: 'pnpm',
      start: 'pnpm dev',
      workdir: '.',
      ports: [{ service: 'app', container: 3000, protocol: 'tcp', preview: true }],
    };
    loadWorkspaceContainerConfigMock.mockResolvedValue({
      ok: true,
      config,
      sourcePath: null,
    });

    const allocateMock = vi.fn(async () => {
      throw new PortAllocationError('No ports available');
    });

    const service = new ContainerRunnerService({ portAllocator: { allocate: allocateMock } });
    const events: RunnerEvent[] = [];
    service.onRunnerEvent((event) => events.push(event));

    const result = await service.startMockRun({
      workspaceId: 'ws-1',
      workspacePath: '/tmp/workspace',
      runId: 'run-err',
      now: () => 1700000000100,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'PORT_ALLOC_FAILED',
        message: 'No ports available',
        configKey: null,
        configPath: null,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      code: 'PORT_ALLOC_FAILED',
      runId: 'run-err',
    });
  });
});
