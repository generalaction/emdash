import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistTaskProvisioned } from './persistTaskProvisioned';

const mocks = vi.hoisted(() => ({
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    update: () => ({ set: mocks.updateSet }),
  },
}));

describe('persistTaskProvisioned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it('persists the provisioned workspace without changing lifecycle generation', async () => {
    await persistTaskProvisioned('task-1', 'workspace-1');

    expect(mocks.updateSet).toHaveBeenCalledWith({
      lastInteractedAt: expect.anything(),
      workspaceId: 'workspace-1',
    });
  });
});
