import { beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '@main/lib/logger';
import type { AgentEvent } from '@shared/events/agentEvents';
import { taskWasCreatedByAutomationRun } from '../automations/repo';
import { taskSessionManager } from '../tasks/task-session-manager';
import { stopAutomationSessionAfterDone } from './automation-pty-cleanup';

vi.mock('../automations/repo', () => ({ taskWasCreatedByAutomationRun: vi.fn() }));
vi.mock('../tasks/task-session-manager', () => ({ taskSessionManager: { getTask: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn() } }));

function makeStopEvent(conversationId: string): AgentEvent {
  return {
    type: 'stop',
    source: 'hook',
    providerId: 'claude',
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId,
    timestamp: 1,
    payload: {},
  };
}

describe('stopAutomationSessionAfterDone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops the conversation PTY when an automation agent marks done', async () => {
    const stopEvent = makeStopEvent('conversation-stop');
    const stopSession = vi.fn().mockResolvedValue(undefined);
    vi.mocked(taskWasCreatedByAutomationRun).mockResolvedValue(true);
    vi.mocked(taskSessionManager.getTask).mockReturnValue({
      conversations: { stopSession },
    } as never);

    await stopAutomationSessionAfterDone(stopEvent);

    expect(stopSession).toHaveBeenCalledWith('conversation-stop');
  });

  it('deduplicates concurrent stop events for the same conversation', async () => {
    const stopEvent = makeStopEvent('conversation-dedupe');
    let finishStopSession!: () => void;
    const stopSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStopSession = resolve;
        })
    );
    vi.mocked(taskWasCreatedByAutomationRun).mockResolvedValue(true);
    vi.mocked(taskSessionManager.getTask).mockReturnValue({
      conversations: { stopSession },
    } as never);

    const firstStop = stopAutomationSessionAfterDone(stopEvent);
    const duplicateStop = stopAutomationSessionAfterDone({ ...stopEvent });
    await Promise.resolve();
    finishStopSession();
    await Promise.all([firstStop, duplicateStop]);

    expect(stopSession).toHaveBeenCalledTimes(1);
  });

  it('allows a later stop event after the previous stop finishes', async () => {
    const stopEvent = makeStopEvent('conversation-repeat');
    const stopSession = vi.fn().mockResolvedValue(undefined);
    vi.mocked(taskWasCreatedByAutomationRun).mockResolvedValue(true);
    vi.mocked(taskSessionManager.getTask).mockReturnValue({
      conversations: { stopSession },
    } as never);

    await stopAutomationSessionAfterDone(stopEvent);
    await stopAutomationSessionAfterDone(stopEvent);

    expect(stopSession).toHaveBeenCalledTimes(2);
  });

  it('leaves non-automation tasks running after done', async () => {
    const stopEvent = makeStopEvent('conversation-non-automation');
    vi.mocked(taskWasCreatedByAutomationRun).mockResolvedValue(false);

    await stopAutomationSessionAfterDone(stopEvent);

    expect(taskSessionManager.getTask).not.toHaveBeenCalled();
  });

  it('ignores non-stop agent events', async () => {
    const stopEvent = makeStopEvent('conversation-non-stop');
    await stopAutomationSessionAfterDone({ ...stopEvent, type: 'start' });

    expect(taskWasCreatedByAutomationRun).not.toHaveBeenCalled();
  });

  it('logs lookup failures instead of rejecting', async () => {
    const stopEvent = makeStopEvent('conversation-lookup-failure');
    vi.mocked(taskWasCreatedByAutomationRun).mockRejectedValue(new Error('db closed'));

    await expect(stopAutomationSessionAfterDone(stopEvent)).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith(
      'agent-hooks: failed to stop completed automation PTY',
      expect.objectContaining({ taskId: 'task-1', error: 'Error: db closed' })
    );
  });
});
