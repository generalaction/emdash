import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAutomationRuntimeAvailability,
  resolveAutomationRuntime,
} from './runtime-client-resolver';

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getRuntimeClient: vi.fn(),
}));

vi.mock('@main/core/projects/operations/getProjects', () => ({
  getProjectById: mocks.getProjectById,
}));

vi.mock('./automations-runtime-host', () => ({
  getAutomationsRuntimeClient: mocks.getRuntimeClient,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('automation runtime resolution', () => {
  it('resolves local projects to the desktop runtime', async () => {
    const client = { deploy: vi.fn() };
    mocks.getProjectById.mockResolvedValue({ id: 'project-1', type: 'local' });
    mocks.getRuntimeClient.mockResolvedValue(client);

    await expect(resolveAutomationRuntime('project-1')).resolves.toEqual({
      key: 'local',
      client,
    });
  });

  it('marks SSH projects unavailable until a workspace-server transport is connected', async () => {
    mocks.getProjectById.mockResolvedValue({ id: 'project-1', type: 'ssh' });

    await expect(getAutomationRuntimeAvailability('project-1')).resolves.toEqual({
      available: false,
      reason: 'This desktop build cannot reach the remote automation runtime yet.',
    });
    await expect(resolveAutomationRuntime('project-1')).rejects.toThrow(
      'This desktop build cannot reach the remote automation runtime yet'
    );
    expect(mocks.getRuntimeClient).not.toHaveBeenCalled();
  });
});
