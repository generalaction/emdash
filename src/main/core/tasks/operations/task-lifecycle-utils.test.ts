import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteWorkspaceIfUnused } from './task-lifecycle-utils';

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  deleteWhere: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.limit,
        }),
      }),
    }),
    delete: (...args: unknown[]) => {
      mocks.del(...args);
      return { where: mocks.deleteWhere };
    },
  },
}));

vi.mock('@main/core/search/workspace-file-index-service', () => ({
  workspaceFileIndexService: { deleteIndex: vi.fn() },
}));

describe('deleteWorkspaceIfUnused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteWhere.mockResolvedValue(undefined);
  });

  it('deletes the workspace row when no other task references it', async () => {
    mocks.limit.mockResolvedValue([]);

    await deleteWorkspaceIfUnused('ws-1', 'task-1');

    expect(mocks.del).toHaveBeenCalledTimes(1);
  });

  it('keeps the workspace row when a sibling task still references it', async () => {
    mocks.limit.mockResolvedValue([{ id: 'task-2' }]);

    await deleteWorkspaceIfUnused('ws-1', 'task-1');

    expect(mocks.del).not.toHaveBeenCalled();
  });
});
