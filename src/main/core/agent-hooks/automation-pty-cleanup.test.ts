import { beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '@main/lib/logger';
import type { AgentEvent } from '@shared/events/agentEvents';
import { taskWasCreatedByAutomationRun } from '../automations/repo';
import { taskManager } from '../tasks/task-manager';
import { stopAutomationSessionAfterDone } from './automation-pty-cleanup';

vi.mock('../automations/repo', () => ({ taskWasCreatedByAutomationRun: vi.fn() }));
vi.mock('../tasks/task-manager', () => ({ taskManager: { getTask: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn() } }));

const stopEvent: AgentEvent = {
  type: 'stop',
  source: 'hook',
  providerId: 'claude',
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
  timestamp: 1,
  payload: {},
};

describe('stopAutomationSessionAfterDone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops the conversation PTY when an automation agent marks done', async () => {
    const stopSession = vi.fn().mockResolvedValue(undefined);
    vi.mocked(taskWasCreatedByAutomationRun).mockResolvedValue(true);
    vi.mocked(taskManager.getTask).mockReturnValue({ conversations: { stopSession } } as never);

    await stopAutomationSessionAfterDone(stopEvent);

    expect(stopSession).toHaveBeenCalledWith('conversation-1');
  });

  it('leaves non-automation tasks running after done', async () => {
    vi.mocked(taskWasCreatedByAutomationRun).mockResolvedValue(false);

    await stopAutomationSessionAfterDone(stopEvent);

    expect(taskManager.getTask).not.toHaveBeenCalled();
  });

  it('ignores non-stop agent events', async () => {
    await stopAutomationSessionAfterDone({ ...stopEvent, type: 'start' });

    expect(taskWasCreatedByAutomationRun).not.toHaveBeenCalled();
  });

  it('logs lookup failures instead of rejecting', async () => {
    vi.mocked(taskWasCreatedByAutomationRun).mockRejectedValue(new Error('db closed'));

    await expect(stopAutomationSessionAfterDone(stopEvent)).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith(
      'agent-hooks: failed to stop completed automation PTY',
      expect.objectContaining({ taskId: 'task-1', error: 'Error: db closed' })
    );
  });
});
