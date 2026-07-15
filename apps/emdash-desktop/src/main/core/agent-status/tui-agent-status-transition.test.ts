import type { TuiAgentState } from '@emdash/core/runtimes/tui-agents/api';
import { describe, expect, it } from 'vitest';
import {
  eventFromTuiAgentState,
  shouldApplyAgentStateTransition,
} from './tui-agent-status-transition';

function state(overrides: Partial<TuiAgentState> = {}): TuiAgentState {
  return {
    conversationId: 'conv-1',
    providerId: 'codex',
    status: 'working',
    source: 'hook',
    updatedAt: 123,
    ...overrides,
  };
}

describe('TUI agent status transition mapping', () => {
  it('maps working agent state to a start event with desktop context', () => {
    expect(
      eventFromTuiAgentState(state(), {
        projectId: 'project-1',
        taskId: 'task-1',
      })
    ).toMatchObject({
      type: 'start',
      source: 'hook',
      providerId: 'codex',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conv-1',
      timestamp: 123,
    });
  });

  it('maps awaiting input to a notification event', () => {
    expect(
      eventFromTuiAgentState(
        state({
          status: 'awaiting-input',
          notificationType: 'permission_prompt',
          message: 'Approve?',
        }),
        {
          projectId: 'project-1',
          taskId: 'task-1',
        }
      )
    ).toMatchObject({
      type: 'notification',
      payload: {
        notificationType: 'permission_prompt',
        message: 'Approve?',
      },
    });
  });

  it('does not project idle as an AgentEvent', () => {
    expect(
      eventFromTuiAgentState(state({ status: 'idle' }), {
        projectId: 'project-1',
        taskId: 'task-1',
      })
    ).toBeNull();
  });

  it('suppresses duplicate status and notification-type updates', () => {
    expect(
      shouldApplyAgentStateTransition(
        state({ status: 'awaiting-input', notificationType: 'permission_prompt' }),
        state({ status: 'awaiting-input', notificationType: 'permission_prompt' })
      )
    ).toBe(false);
    expect(
      shouldApplyAgentStateTransition(state({ status: 'working' }), state({ status: 'completed' }))
    ).toBe(true);
  });
});
