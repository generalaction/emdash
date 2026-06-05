import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import { executeTaskCreate } from './actions/taskCreate';
import { updateRun } from './repo';
import type { OnStepCompleted } from './run-transitions';
import { runQueuedAutomation } from './runtime';

vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('./actions/taskCreate', () => ({ executeTaskCreate: vi.fn() }));
vi.mock('./repo', () => ({ updateRun: vi.fn() }));

const automation: Automation = {
  id: 'automation-1',
  name: 'Daily follow-up',
  triggerConfig: { expr: '0 9 * * *', tz: 'UTC' },
  conversationConfig: { prompt: 'Check things', provider: 'claude', autoApprove: false },
  projectId: 'project-1',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

const run: AutomationRun = {
  id: 'run-1',
  automationId: automation.id,
  scheduledAt: null,
  deadlineAt: null,
  startedAt: 1,
  taskCreatedAt: null,
  launchedAt: null,
  finishedAt: null,
  status: 'creating_task',
  taskId: null,
  error: null,
  triggerKind: 'manual',
  triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
  conversationConfigSnapshot: { prompt: 'Check things', provider: 'claude', autoApprove: false },
  taskConfigSnapshot: null,
  generatedTaskName: null,
};

describe('runQueuedAutomation', () => {
  let onStepCompleted: OnStepCompleted;

  beforeEach(() => {
    vi.clearAllMocks();
    onStepCompleted = vi.fn() as unknown as OnStepCompleted;
    vi.mocked(updateRun).mockImplementation(async (_, values) => ({ ...run, ...values }));
  });

  it('marks a successful run as done and notifies the step callback', async () => {
    vi.mocked(executeTaskCreate).mockResolvedValue({ success: true, data: { taskId: 'task-1' } });

    const result = await runQueuedAutomation(automation, run, onStepCompleted);

    expect(result.success).toBe(true);
    expect(executeTaskCreate).toHaveBeenCalledWith(automation, run, onStepCompleted);
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'done',
      finishedAt: expect.any(Number),
    });
    expect(onStepCompleted).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('propagates error from executeTaskCreate without calling markRunFailed again', async () => {
    // executeTaskCreate already calls markRunFailed internally; runtime just propagates the err
    vi.mocked(executeTaskCreate).mockResolvedValue({
      success: false,
      error: 'project_not_found',
    });

    const result = await runQueuedAutomation(automation, run, onStepCompleted);

    expect(result).toEqual({ success: false, error: 'project_not_found' });
    // updateRun should NOT be called by runtime.ts (taskCreate already handled it)
    expect(updateRun).not.toHaveBeenCalled();
    // onStepCompleted not called by runtime (executeTaskCreate is responsible for step callbacks)
    expect(onStepCompleted).not.toHaveBeenCalled();
  });

  it('skips orphan automations before calling executeTaskCreate', async () => {
    const skippedRun = {
      ...run,
      status: 'skipped' as const,
      finishedAt: Date.now(),
      error: JSON.stringify({ step: 'queue', code: 'no_project' }),
    };
    vi.mocked(updateRun).mockResolvedValue(skippedRun);

    const result = await runQueuedAutomation(
      { ...automation, projectId: undefined },
      run,
      onStepCompleted
    );

    expect(result).toEqual({ success: false, error: 'no_project' });
    expect(executeTaskCreate).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'skipped',
      error: JSON.stringify({ step: 'queue', code: 'no_project' }),
      finishedAt: expect.any(Number),
    });
    expect(onStepCompleted).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
  });

  it('skips a run with empty prompt before calling executeTaskCreate', async () => {
    const noPromptAutomation = {
      ...automation,
      conversationConfig: { prompt: '   ', provider: 'claude', autoApprove: false },
    };
    const skippedRun = {
      ...run,
      status: 'skipped' as const,
      finishedAt: Date.now(),
      error: JSON.stringify({ step: 'queue', code: 'no_actions_configured' }),
    };
    vi.mocked(updateRun).mockResolvedValue(skippedRun);

    const result = await runQueuedAutomation(noPromptAutomation, run, onStepCompleted);

    expect(result.success).toBe(true);
    expect(executeTaskCreate).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'skipped',
      error: JSON.stringify({ step: 'queue', code: 'no_actions_configured' }),
      finishedAt: expect.any(Number),
    });
    expect(onStepCompleted).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
  });

  it('catches unexpected throws from executeTaskCreate and propagates them', async () => {
    vi.mocked(executeTaskCreate).mockRejectedValue(new Error('unexpected'));

    const result = await runQueuedAutomation(automation, run, onStepCompleted);

    expect(result).toEqual({ success: false, error: 'unexpected' });
    // updateRun not called by runtime (no terminal transition for caught throws)
    expect(updateRun).not.toHaveBeenCalled();
  });
});
