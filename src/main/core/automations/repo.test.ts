import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automations } from '@main/db/schema';
import { detachProject } from './repo';

const dbMock = vi.hoisted(() => {
  const returning = vi.fn();
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { returning, where, set, update };
});

vi.mock('@main/db/client', () => ({
  db: { update: dbMock.update },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('automations repo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.returning.mockResolvedValue([{ id: 'automation-1' }, { id: 'automation-2' }]);
  });

  it('detaches every automation for a project', async () => {
    await expect(detachProject('project-1')).resolves.toBe(2);

    expect(dbMock.update).toHaveBeenCalledWith(automations);
    expect(dbMock.set).toHaveBeenCalledWith({
      projectId: null,
      enabled: 0,
      nextRunAt: null,
      updatedAt: expect.any(Number),
    });
    expect(dbMock.where).toHaveBeenCalledOnce();
    expect(dbMock.returning).toHaveBeenCalledWith({ id: automations.id });
  });
});
