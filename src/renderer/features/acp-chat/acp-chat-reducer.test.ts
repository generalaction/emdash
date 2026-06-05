import { describe, expect, it } from 'vitest';
import { acpChatReducer, createInitialAcpChatState } from './acp-chat-reducer';

describe('acpChatReducer', () => {
  it('replays missed startup and message events', () => {
    const state = acpChatReducer(createInitialAcpChatState(), {
      type: 'replay',
      events: [
        {
          type: 'session',
          projectId: 'project-1',
          taskId: 'task-1',
          conversationId: 'conversation-1',
          acpSessionId: 'session-1',
        },
        {
          type: 'update',
          projectId: 'project-1',
          taskId: 'task-1',
          conversationId: 'conversation-1',
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'hello' },
          },
        },
        {
          type: 'update',
          projectId: 'project-1',
          taskId: 'task-1',
          conversationId: 'conversation-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'world' },
          },
        },
      ],
    });

    expect(state.status).toBe('ready');
    expect(state.acpSessionId).toBe('session-1');
    expect(state.items).toEqual([
      { id: 'user-0', kind: 'user', text: 'hello' },
      { id: 'assistant-1', kind: 'assistant', text: 'world' },
    ]);
  });

  it('coalesces streamed assistant text chunks', () => {
    let state = createInitialAcpChatState();
    state = acpChatReducer(state, {
      type: 'event',
      event: {
        type: 'update',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
        },
      },
    });
    state = acpChatReducer(state, {
      type: 'event',
      event: {
        type: 'update',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: ' world' },
        },
      },
    });

    expect(state.items).toEqual([{ id: 'assistant-0', kind: 'assistant', text: 'hello world' }]);
  });

  it('adds and removes permission requests', () => {
    let state = createInitialAcpChatState();
    state = acpChatReducer(state, {
      type: 'event',
      event: {
        type: 'permission_request',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        request: {
          requestId: '99',
          title: 'Run command',
          kind: 'execute',
          options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
          details: '{}',
        },
      },
    });
    expect(state.items).toHaveLength(1);

    state = acpChatReducer(state, {
      type: 'event',
      event: {
        type: 'permission_resolved',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        requestId: '99',
        outcome: 'selected',
      },
    });

    expect(state.items).toHaveLength(0);
  });

  it('tracks tool call updates', () => {
    let state = createInitialAcpChatState();
    state = acpChatReducer(state, {
      type: 'event',
      event: {
        type: 'update',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          title: 'Read file',
          kind: 'read',
          status: 'pending',
        },
      },
    });
    state = acpChatReducer(state, {
      type: 'event',
      event: {
        type: 'update',
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          status: 'completed',
        },
      },
    });

    expect(state.items[0]).toMatchObject({ kind: 'tool', status: 'completed' });
  });
});
