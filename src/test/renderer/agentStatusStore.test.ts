import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/agentEvents';
import { makePtyId } from '../../shared/ptyId';
import { AgentStatusStore } from '../../renderer/lib/agentStatusStore';
import { deriveTaskStatus } from '../../renderer/lib/deriveTaskStatus';

function makeEvent(
  ptyId: string,
  overrides: Partial<AgentEvent> & { payload?: AgentEvent['payload'] }
): AgentEvent {
  return {
    type: 'notification',
    ptyId,
    taskId: ptyId,
    providerId: 'claude',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe('AgentStatusStore', () => {
  it('marks Claude as working on submit', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.markUserInputSubmitted({ ptyId });

    expect(store.getStatus('task-1').kind).toBe('working');
  });

  it('marks Codex as working on submit', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('codex', 'main', 'task-1');

    store.markUserInputSubmitted({ ptyId });

    expect(store.getStatus('task-1').kind).toBe('working');
  });

  it('marks OpenCode as working on submit', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('opencode', 'main', 'task-1');

    store.markUserInputSubmitted({ ptyId });

    expect(store.getStatus('task-1').kind).toBe('working');
  });

  it('ignores user input for providers without semantic mapping yet', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('amp', 'main', 'task-1');

    store.markUserInputSubmitted({ ptyId });

    expect(store.getStatus('task-1').kind).toBe('unknown');
  });

  it('maps Claude notification hooks to waiting', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.handleAgentEvent(
      makeEvent(ptyId, {
        taskId: 'task-1',
        payload: { notificationType: 'permission_prompt' },
      })
    );

    expect(store.getStatus('task-1').kind).toBe('waiting');
    expect(store.getUnread('task-1')).toBe(true);
  });

  it('maps Codex turn-complete notifications to waiting', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('codex', 'main', 'task-1');

    store.handleAgentEvent(
      makeEvent(ptyId, {
        providerId: 'codex',
        taskId: 'task-1',
        payload: { notificationType: 'idle_prompt' },
      })
    );

    expect(store.getStatus('task-1').kind).toBe('waiting');
    expect(store.getUnread('task-1')).toBe(true);
  });

  it('maps OpenCode notification hooks to waiting', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('opencode', 'main', 'task-1');

    store.handleAgentEvent(
      makeEvent(ptyId, {
        providerId: 'opencode',
        taskId: 'task-1',
        payload: { notificationType: 'permission_prompt' },
      })
    );

    expect(store.getStatus('task-1').kind).toBe('waiting');
    expect(store.getUnread('task-1')).toBe(true);
  });

  it('maps OpenCode error events to error', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('opencode', 'main', 'task-1');

    store.handleAgentEvent(
      makeEvent(ptyId, {
        type: 'error',
        providerId: 'opencode',
        taskId: 'task-1',
      })
    );

    expect(store.getStatus('task-1').kind).toBe('error');
    expect(store.getUnread('task-1')).toBe(true);
  });

  it('does not mark unread when the event is for the currently visible status id', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.setActiveView({ taskId: 'task-1', statusId: 'task-1' });
    store.handleAgentEvent(
      makeEvent(ptyId, {
        taskId: 'task-1',
        payload: { notificationType: 'idle_prompt' },
      })
    );

    expect(store.getStatus('task-1').kind).toBe('waiting');
    expect(store.getUnread('task-1')).toBe(false);
  });

  it('maps Claude stop events to complete', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.handleAgentEvent(
      makeEvent(ptyId, {
        type: 'stop',
        taskId: 'task-1',
      })
    );

    expect(store.getStatus('task-1').kind).toBe('complete');
    expect(store.getUnread('task-1')).toBe(true);
  });

  it('maps Claude error events to error', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.handleAgentEvent(
      makeEvent(ptyId, {
        type: 'error',
        taskId: 'task-1',
      })
    );

    expect(store.getStatus('task-1').kind).toBe('error');
    expect(store.getUnread('task-1')).toBe(true);
  });

  it('clears working status to idle on PTY exit when no terminal event finalized it', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.markUserInputSubmitted({ ptyId });
    store.handlePtyExit({ ptyId });

    expect(store.getStatus('task-1').kind).toBe('idle');
  });

  it('clears unread when a status id is marked seen', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.handleAgentEvent(
      makeEvent(ptyId, {
        taskId: 'task-1',
        payload: { notificationType: 'idle_prompt' },
      })
    );

    store.markSeen('task-1');

    expect(store.getUnread('task-1')).toBe(false);
  });
});

describe('deriveTaskStatus', () => {
  it('prioritizes waiting over other states for multi-chat tasks', () => {
    expect(deriveTaskStatus(['complete', 'working', 'waiting'])).toBe('waiting');
  });

  it('prioritizes working over error and complete when no chat is waiting', () => {
    expect(deriveTaskStatus(['complete', 'error', 'working'])).toBe('working');
  });

  it('uses error before complete when no chat is waiting or working', () => {
    expect(deriveTaskStatus(['complete', 'error'])).toBe('error');
  });
});
