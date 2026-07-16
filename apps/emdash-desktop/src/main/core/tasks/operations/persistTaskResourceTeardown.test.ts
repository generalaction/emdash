import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistTaskResourceTeardown } from './persistTaskResourceTeardown';

const mocks = vi.hoisted(() => ({
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    update: () => ({ set: mocks.updateSet }),
  },
}));

describe('persistTaskResourceTeardown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it('records both completed resource phases for a retained task row', async () => {
    await persistTaskResourceTeardown('task-1');

    expect(mocks.updateSet).toHaveBeenCalledWith({
      lifecycleTeardownAt: expect.anything(),
      providerDestroyAt: expect.anything(),
    });
  });
});
