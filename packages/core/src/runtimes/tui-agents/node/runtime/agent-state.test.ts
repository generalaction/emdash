import {
  createTuiAgentStatesLiveHost,
  createTuiAgentStatesListModel,
  createTuiSessionsLiveHost,
  createTuiSessionsListModel,
} from '@runtimes/tui-agents/node/state/live-models';
import { describe, expect, it, vi } from 'vitest';
import { TuiAgentStates } from './agent-state';

function createTracker() {
  const sessionsHost = createTuiSessionsLiveHost();
  const agentStatesHost = createTuiAgentStatesLiveHost();
  const sessions = createTuiSessionsListModel(sessionsHost);
  const agentStates = createTuiAgentStatesListModel(agentStatesHost);
  const onSessionIdChanged = vi.fn();
  const onAgentStateChanged = vi.fn();
  const tracker = new TuiAgentStates(
    sessions,
    agentStates,
    onSessionIdChanged,
    onAgentStateChanged
  );
  return { tracker, sessions, agentStates, onSessionIdChanged, onAgentStateChanged };
}

describe('TuiAgentStates', () => {
  it('maps canonical status hook events to agent state', () => {
    const { tracker, agentStates } = createTracker();

    tracker.applyCanonicalEvent('conv-1', 'codex', {
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      message: 'approve command',
    });

    expect(agentStates.states.list.snapshot().data['conv-1']).toMatchObject({
      conversationId: 'conv-1',
      providerId: 'codex',
      status: 'awaiting-input',
      source: 'hook',
      notificationType: 'permission_prompt',
      message: 'approve command',
      updatedAt: expect.any(Number),
    });
  });

  it('marks input submitted as working only when the provider lacks a start hook', () => {
    const { tracker, agentStates } = createTracker();

    tracker.markInputSubmitted('conv-1', { hooks: { kind: 'none' } }, '\r');
    expect(agentStates.states.list.snapshot().data['conv-1']?.status).toBe('working');

    tracker.markInputSubmitted(
      'conv-2',
      { hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['start'] } },
      '\r'
    );
    expect(agentStates.states.list.snapshot().data['conv-2']).toBeUndefined();
  });

  it('publishes valid provider session ids through the sessions model', () => {
    const { tracker, sessions, onSessionIdChanged } = createTracker();
    sessions.states.list.produce((draft) => {
      draft['conv-1'] = {
        conversationId: 'conv-1',
        providerId: 'amp',
        sessionId: null,
        status: 'running',
        cols: 120,
        rows: 30,
        resume: null,
        startedAt: 1,
      };
    });

    tracker.applyCanonicalEvent('conv-1', 'amp', {
      kind: 'session',
      providerSessionId: 'T-123',
    });

    expect(sessions.states.list.snapshot().data['conv-1']?.sessionId).toBe('T-123');
    expect(onSessionIdChanged).toHaveBeenCalledWith('conv-1', 'T-123');
  });
});
