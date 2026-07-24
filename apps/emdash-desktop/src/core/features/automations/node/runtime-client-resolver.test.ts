import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAutomationRuntimeAvailability,
  resolveAutomationRuntimeClient,
} from './runtime-client-resolver';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  getProjectById: vi.fn(),
}));

const dependencies = {
  runtimes: { client: mocks.client },
  getProjectById: mocks.getProjectById,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('automation runtime resolution', () => {
  it('resolves unassigned automations to the local runtime client', async () => {
    const client = {} as never;
    mocks.client.mockResolvedValue(ok(client));

    await expect(resolveAutomationRuntimeClient(dependencies)).resolves.toBe(client);
    expect(mocks.client).toHaveBeenCalledWith(LOCAL_HOST_REF);
  });

  it('resolves project hosts and converts typed broker failures to errors', async () => {
    const remote = hostRef('remote', 'ssh-1');
    mocks.getProjectById.mockResolvedValue({
      id: 'project-1',
      type: 'ssh',
      connectionId: 'ssh-1',
    });
    mocks.client.mockResolvedValue(
      err({ type: 'host-unavailable', host: remote, message: 'Remote unavailable' })
    );

    await expect(resolveAutomationRuntimeClient(dependencies, 'project-1')).rejects.toMatchObject({
      message: 'Remote unavailable',
    });
    expect(mocks.client).toHaveBeenCalledWith(remote);
  });

  it('marks local projects available', async () => {
    mocks.getProjectById.mockResolvedValue({ id: 'project-1', type: 'local' });
    mocks.client.mockResolvedValue(ok({}));

    await expect(getAutomationRuntimeAvailability(dependencies, 'project-1')).resolves.toEqual({
      available: true,
    });
    expect(mocks.client).toHaveBeenCalledWith(LOCAL_HOST_REF);
  });

  it('marks remote projects available when the runtime broker resolves their host', async () => {
    const remote = hostRef('remote', 'ssh-1');
    mocks.getProjectById.mockResolvedValue({
      id: 'project-1',
      type: 'ssh',
      connectionId: 'ssh-1',
    });
    mocks.client.mockResolvedValue(ok({}));

    await expect(getAutomationRuntimeAvailability(dependencies, 'project-1')).resolves.toEqual({
      available: true,
    });
    expect(mocks.client).toHaveBeenCalledWith(remote);
  });

  it('uses the runtime broker error when a project host is unavailable', async () => {
    const remote = hostRef('remote', 'ssh-1');
    mocks.getProjectById.mockResolvedValue({
      id: 'project-1',
      type: 'ssh',
      connectionId: 'ssh-1',
    });
    mocks.client.mockResolvedValue(
      err({ type: 'host-unavailable', host: remote, message: 'Remote unavailable' })
    );

    await expect(getAutomationRuntimeAvailability(dependencies, 'project-1')).resolves.toEqual({
      available: false,
      reason: 'Remote unavailable',
    });
  });

  it('marks missing projects unavailable', async () => {
    mocks.getProjectById.mockResolvedValue(undefined);

    await expect(getAutomationRuntimeAvailability(dependencies, 'missing')).resolves.toEqual({
      available: false,
      reason: 'The automation project no longer exists.',
    });
  });
});
