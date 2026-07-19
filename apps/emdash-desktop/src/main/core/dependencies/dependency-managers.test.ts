import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/gateway/desktop-workers', () => ({
  hostDependenciesClient: {},
}));

const { getDependencyManager } = await import('./dependency-managers');

describe('getDependencyManager', () => {
  it('returns a typed host-unavailable error for remote dependencies', async () => {
    await expect(getDependencyManager('ssh-1')).resolves.toEqual({
      success: false,
      error: {
        type: 'host-unavailable',
        host: { type: 'remote', id: 'ssh-1' },
        message: 'Remote host dependencies require the workspace server.',
      },
    });
  });
});
