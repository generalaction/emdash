import { describe, expect, it, vi } from 'vitest';
import type { AutomationRun } from '@shared/automations/types';
import { automationEvents } from './automation-events';

vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn() } }));

const run: AutomationRun = {
  id: 'run-1',
  automationId: 'automation-1',
  scheduledAt: null,
  deadlineAt: null,
  startedAt: 1,
  finishedAt: 2,
  status: 'success',
  taskId: null,
  createdTaskId: null,
  error: null,
  triggerKind: 'manual',
  workerId: 'worker-1',
};

describe('automationEvents', () => {
  it('calls lifecycle hooks with the run payload', async () => {
    const handler = vi.fn();
    const unsubscribe = automationEvents.on('automation:run:finish', handler);

    automationEvents._emit('automation:run:finish', run);

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(run));
    unsubscribe();
  });
});
