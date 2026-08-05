import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginTaskProvisioning } from './beginTaskProvisioning';

const mocks = vi.hoisted(() => ({
  clearTaskResourceTeardown: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    update: () => ({ set: mocks.updateSet }),
  },
}));

vi.mock('@main/core/tasks/task-resource-teardown-state', () => ({
  clearTaskResourceTeardown: mocks.clearTaskResourceTeardown,
}));

describe('beginTaskProvisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it('durably starts a new lifecycle generation before clearing process state', async () => {
    await beginTaskProvisioning('task-1');

    expect(mocks.updateSet).toHaveBeenCalledWith({
      lifecycleTeardownAt: null,
      providerDestroyAt: null,
    });
    expect(mocks.updateWhere.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearTaskResourceTeardown.mock.invocationCallOrder[0]
    );
  });
});
