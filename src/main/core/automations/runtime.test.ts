import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { executeTaskCreate } from './actions/taskCreate';
import { updateRun } from './repo';
import { runQueuedAutomation } from './runtime';

vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('./actions/taskCreate', () => ({ executeTaskCreate: vi.fn() }));
vi.mock('./repo', () => ({ updateAutomationSchedule: vi.fn(), updateRun: vi.fn() }));

const automation: Automation = {
  id: 'automation-1',
  name: 'Daily follow-up',
  description: null,
  category: 'custom',
  trigger: { expr: '0 9 * * *', tz: 'UTC' },
  actions: [{ kind: 'task.create', prompt: 'Check things' }],
  taskConfig: null,
  projectId: 'project-1',
  enabled: true,
  isDraft: false,
  lastRunAt: null,
  nextRunAt: null,
  builtinTemplateId: null,
  createdAt: 0,
  updatedAt: 0,
};

const run: AutomationRun = {
  id: 'run-1',
  automationId: automation.id,
  scheduledAt: null,
  deadlineAt: null,
  startedAt: 1,
  finishedAt: null,
  status: 'running',
  taskId: null,
  createdTaskId: null,
  error: null,
  triggerKind: 'manual',
  workerId: 'worker-1',
};

describe('runQueuedAutomation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateRun).mockResolvedValue(null);
  });

  it('does not attach a task id when task creation fails before a task exists', async () => {
    vi.mocked(executeTaskCreate).mockResolvedValue({
      success: false,
      error: { message: 'project_not_found' },
    });

    const result = await runQueuedAutomation(automation, run);

    expect(result).toEqual({ success: false, error: 'project_not_found' });
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'failed',
      finishedAt: expect.any(Number),
      taskId: null,
      createdTaskId: null,
      error: 'project_not_found',
    });
  });
});
