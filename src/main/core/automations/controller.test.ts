import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '@shared/automations/types';
import { automationsController } from './controller';
import { getAutomation, updateAutomation } from './repo';

vi.mock('./automation-events', () => ({
  automationEvents: { _emit: vi.fn() },
}));

vi.mock('./automation-run-events', () => ({
  automationRunEvents: { _emit: vi.fn() },
}));

vi.mock('./automation-scheduler', () => ({
  automationRunDeadline: vi.fn((scheduledAt: number) => scheduledAt + 1),
  automationScheduler: { drainQueue: vi.fn() },
}));

vi.mock('./repo', () => ({
  createAutomation: vi.fn(),
  enqueueAutomationRun: vi.fn(),
  getAutomation: vi.fn(),
  listAutomations: vi.fn(),
  listRecentRuns: vi.fn(),
  listRuns: vi.fn(),
  removeAutomation: vi.fn(),
  removeRun: vi.fn(),
  setAutomationEnabled: vi.fn(),
  updateAutomation: vi.fn(),
}));

vi.mock('./runtime', () => ({
  emitRunUpdated: vi.fn(),
}));

const draftAutomation: Automation = {
  id: 'automation-1',
  name: 'Draft automation',
  description: null,
  category: 'custom',
  trigger: { kind: 'cron', expr: '0 9 * * *', tz: 'UTC' },
  actions: [],
  taskConfig: null,
  projectId: 'project-1',
  enabled: false,
  isDraft: true,
  lastRunAt: null,
  nextRunAt: null,
  builtinTemplateId: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('automationsController.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects publishing a draft when existing actions are empty', async () => {
    vi.mocked(getAutomation).mockResolvedValue(draftAutomation);

    const result = await automationsController.update(draftAutomation.id, { isDraft: false });

    expect(result).toEqual({ success: false, error: 'actions_required' });
    expect(updateAutomation).not.toHaveBeenCalled();
  });

  it('validates existing actions when publishing without an actions patch', async () => {
    const automation = {
      ...draftAutomation,
      actions: [{ kind: 'task.create' as const, prompt: 'Do the thing' }],
      isDraft: false,
    };
    vi.mocked(getAutomation).mockResolvedValue({ ...automation, isDraft: true });
    vi.mocked(updateAutomation).mockResolvedValue(automation);

    const result = await automationsController.update(draftAutomation.id, { isDraft: false });

    expect(result).toEqual({ success: true, data: automation });
    expect(updateAutomation).toHaveBeenCalledWith(draftAutomation.id, { isDraft: false });
  });
});
