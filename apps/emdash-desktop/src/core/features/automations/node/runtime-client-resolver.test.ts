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

    await expect(getAutomationRuntimeAvailability(dependencies, 'project-1')).resolves.toEqual({
      available: true,
    });
  });

  it('marks SSH projects unavailable until a workspace-server transport is connected', async () => {
    mocks.getProjectById.mockResolvedValue({ id: 'project-1', type: 'ssh' });

    await expect(getAutomationRuntimeAvailability(dependencies, 'project-1')).resolves.toEqual({
      available: false,
      reason: 'Run adoption is not yet supported for remote projects.',
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
