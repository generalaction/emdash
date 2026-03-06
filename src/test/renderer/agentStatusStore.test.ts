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
  it('does not mark Claude as working until output confirms the submit was accepted', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.markUserInputSubmitted({ ptyId });

    expect(store.getStatus('task-1').kind).toBe('unknown');
  });

  it('marks Claude as working after a pending submit gets a busy PTY signal', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.markUserInputSubmitted({ ptyId });
    store.handlePtyData({ ptyId, chunk: 'Esc to interrupt' });

    expect(store.getStatus('task-1').kind).toBe('working');
  });

  it('ignores user input for providers without semantic mapping yet', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('codex', 'main', 'task-1');

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
  });

  it('clears working status to idle on PTY exit when no terminal event finalized it', () => {
    const store = new AgentStatusStore();
    const ptyId = makePtyId('claude', 'main', 'task-1');

    store.markUserInputSubmitted({ ptyId });
    store.handlePtyData({ ptyId, chunk: 'Esc to interrupt' });
    store.handlePtyExit({ ptyId });

    expect(store.getStatus('task-1').kind).toBe('idle');
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
