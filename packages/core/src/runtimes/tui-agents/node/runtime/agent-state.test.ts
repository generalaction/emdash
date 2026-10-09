import { peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import type { TuiAgentState } from '#runtimes/tui-agents/api';
import {
  createTuiAgentStatesLiveModel,
  createTuiAgentStatesListModel,
  createTuiSessionsLiveModel,
  createTuiSessionsListModel,
  produceCell,
} from '#runtimes/tui-agents/node/state/live-models';
import { TuiAgentStates } from './agent-state';

function createTracker() {
  const sessionsLiveModel = createTuiSessionsLiveModel();
  const agentStatesLiveModel = createTuiAgentStatesLiveModel();
  const sessions = createTuiSessionsListModel(sessionsLiveModel);
  const agentStates = createTuiAgentStatesListModel(agentStatesLiveModel);
  const onSessionIdChanged = vi.fn();
  const onAgentStateChanged = vi.fn();
  const tracker = new TuiAgentStates(
    sessions,
    agentStates,
    () => 1_000,
    onSessionIdChanged,
    onAgentStateChanged
  );
  return { tracker, sessions, agentStates, onSessionIdChanged, onAgentStateChanged };
}

describe('TuiAgentStates', () => {
  it.each(['idle', 'working', 'awaiting-input', 'error', 'completed'] as const)(
    'publishes a task name without changing existing %s state fields',
    (status) => {
      const { tracker, agentStates, onAgentStateChanged } = createTracker();
      const previous: TuiAgentState = {
        conversationId: 'conv-1',
        providerId: 'codex',
        status,
        source: 'hook',
        notificationType: 'permission_prompt',
        title: 'Permission required',
        message: 'Approve command',
        lastAssistantMessage: 'I need permission',
        updatedAt: 500,
      };
      tracker.restore(previous);

      tracker.setTaskName('conv-1', 'Fix login');

      const expected = { ...previous, taskName: 'Fix login', updatedAt: 1_000 };
      expect(peek(agentStates.states.list)['conv-1']).toEqual(expected);
      expect(onAgentStateChanged).toHaveBeenCalledExactlyOnceWith('conv-1', expected);
    }
  );

  it('creates neutral naming state before the first provider status event', () => {
    const { tracker, agentStates, onAgentStateChanged } = createTracker();

    tracker.setTaskName('conv-1', 'Fix login');

    const expected = {
      conversationId: 'conv-1',
      status: 'idle',
      taskName: 'Fix login',
      updatedAt: 1_000,
    };
    expect(peek(agentStates.states.list)['conv-1']).toEqual(expected);
    expect(onAgentStateChanged).toHaveBeenCalledExactlyOnceWith('conv-1', expected);
  });

  it('preserves taskName through hook, input, and idle status updates', () => {
    const { tracker, agentStates } = createTracker();
    tracker.setTaskName('conv-1', 'Fix login');

    tracker.applyCanonicalEvent('conv-1', 'codex', {
      kind: 'status',
      type: 'stop',
      lastAssistantMessage: 'Done',
    });
    expect(peek(agentStates.states.list)['conv-1']).toMatchObject({
      taskName: 'Fix login',
      status: 'completed',
      lastAssistantMessage: 'Done',
    });

    tracker.markInputSubmitted('conv-1', { hooks: { kind: 'none' } }, '\r');
    expect(peek(agentStates.states.list)['conv-1']).toMatchObject({
      taskName: 'Fix login',
      status: 'working',
      source: 'input',
    });

    tracker.resetToIdle('conv-1');
    expect(peek(agentStates.states.list)['conv-1']).toMatchObject({
      taskName: 'Fix login',
      status: 'idle',
    });
  });

  it('does not publish the same task name twice', () => {
    const { tracker, onAgentStateChanged } = createTracker();

    tracker.setTaskName('conv-1', 'Fix login');
    tracker.setTaskName('conv-1', 'Fix login');

    expect(onAgentStateChanged).toHaveBeenCalledTimes(1);
  });

  it('maps canonical status hook events to agent state', () => {
    const { tracker, agentStates } = createTracker();

    tracker.applyCanonicalEvent('conv-1', 'codex', {
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      message: 'approve command',
    });

    expect(peek(agentStates.states.list)['conv-1']).toMatchObject({
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
    expect(peek(agentStates.states.list)['conv-1']?.status).toBe('working');

    tracker.markInputSubmitted(
      'conv-2',
      { hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['start'] } },
      '\r'
    );
    expect(peek(agentStates.states.list)['conv-2']).toBeUndefined();
  });

  it('publishes valid provider session ids through the sessions model', () => {
    const { tracker, sessions, onSessionIdChanged } = createTracker();
    produceCell(sessions.states.list, (draft) => {
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

    expect(peek(sessions.states.list)['conv-1']?.sessionId).toBe('T-123');
    expect(onSessionIdChanged).toHaveBeenCalledWith('conv-1', 'T-123');
  });

  it('adopts a provider session id carried on a status event', () => {
    const { tracker, sessions, agentStates, onSessionIdChanged } = createTracker();
    produceCell(sessions.states.list, (draft) => {
      draft['conv-1'] = {
        conversationId: 'conv-1',
        providerId: 'claude',
        sessionId: 'conv-1',
        status: 'running',
        cols: 120,
        rows: 30,
        resume: null,
        startedAt: 1,
      };
    });

    tracker.applyCanonicalEvent('conv-1', 'claude', {
      kind: 'status',
      type: 'start',
      providerSessionId: 'resumed-session',
    });

    expect(peek(sessions.states.list)['conv-1']?.sessionId).toBe('resumed-session');
    expect(onSessionIdChanged).toHaveBeenCalledWith('conv-1', 'resumed-session');
    expect(peek(agentStates.states.list)['conv-1']?.status).toBe('working');
  });

  it('does not re-publish an unchanged session id carried on status events', () => {
    const { tracker, sessions, onSessionIdChanged } = createTracker();
    produceCell(sessions.states.list, (draft) => {
      draft['conv-1'] = {
        conversationId: 'conv-1',
        providerId: 'claude',
        sessionId: 'conv-1',
        status: 'running',
        cols: 120,
        rows: 30,
        resume: null,
        startedAt: 1,
      };
    });

    tracker.applyCanonicalEvent('conv-1', 'claude', {
      kind: 'status',
      type: 'start',
      providerSessionId: 'conv-1',
    });
    tracker.applyCanonicalEvent('conv-1', 'claude', {
      kind: 'status',
      type: 'stop',
      providerSessionId: 'conv-1',
    });

    expect(onSessionIdChanged).not.toHaveBeenCalled();
  });
});
