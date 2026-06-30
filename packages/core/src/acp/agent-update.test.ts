import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { toAgentUpdate } from './agent-update';

// ── helpers ───────────────────────────────────────────────────────────────────

function agentText(text: string, messageId?: string): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    messageId,
    content: { type: 'text', text },
  };
}

function userText(text: string, messageId?: string): SessionUpdate {
  return {
    sessionUpdate: 'user_message_chunk',
    messageId,
    content: { type: 'text', text },
  };
}

function agentThought(text: string): SessionUpdate {
  return {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text },
  };
}

describe('toAgentUpdate', () => {
  // ── message variants ──────────────────────────────────────────────────────

  it('converts agent_message_chunk text to message (assistant)', () => {
    const result = toAgentUpdate(agentText('hello', 'msg-1'));
    expect(result).toStrictEqual({
      kind: 'message',
      role: 'assistant',
      messageId: 'msg-1',
      text: 'hello',
    });
  });

  it('converts user_message_chunk text to message (user)', () => {
    const result = toAgentUpdate(userText('world', 'msg-2'));
    expect(result).toStrictEqual({
      kind: 'message',
      role: 'user',
      messageId: 'msg-2',
      text: 'world',
    });
  });

  it('uses null messageId when messageId is absent', () => {
    const result = toAgentUpdate(agentText('hi'));
    expect(result).toMatchObject({ kind: 'message', messageId: null });
  });

  it('returns ignored for non-text agent message content', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'abc', mimeType: 'image/png' },
    };
    expect(toAgentUpdate(update)).toStrictEqual({ kind: 'ignored' });
  });

  it('returns ignored for empty agent message text', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '' },
    };
    expect(toAgentUpdate(update)).toStrictEqual({ kind: 'ignored' });
  });

  // ── thinking ──────────────────────────────────────────────────────────────

  it('converts agent_thought_chunk to thinking', () => {
    const result = toAgentUpdate(agentThought('pondering'));
    expect(result).toStrictEqual({
      kind: 'thinking',
      messageId: null,
      text: 'pondering',
    });
  });

  it('returns ignored for non-text thought content', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'image', data: 'abc', mimeType: 'image/png' },
    };
    expect(toAgentUpdate(update)).toStrictEqual({ kind: 'ignored' });
  });

  // ── tool_call ─────────────────────────────────────────────────────────────

  it('converts tool_call with all fields', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Run bash',
      kind: 'execute',
      status: 'in_progress',
    };
    expect(toAgentUpdate(update)).toStrictEqual({
      kind: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Run bash',
      toolKind: 'execute',
      status: 'in_progress',
      parentToolCallId: null,
      diffs: [],
    });
  });

  it('passes status and kind through unchanged', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-2',
      title: 'Edit file',
      kind: 'edit',
      status: 'completed',
    };
    const result = toAgentUpdate(update);
    expect(result).toMatchObject({ kind: 'tool_call', toolKind: 'edit', status: 'completed' });
  });

  it('sets parentToolCallId to null (enrich hook responsibility)', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-3',
      title: 'Think',
      _meta: { claudeCode: { parentToolUseId: 'parent-x' } },
    };
    const result = toAgentUpdate(update);
    expect(result).toMatchObject({ kind: 'tool_call', parentToolCallId: null });
  });

  it('extracts diffs from tool_call content', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-4',
      title: 'Write',
      content: [
        { type: 'diff', path: 'src/foo.ts', oldText: 'old', newText: 'new' },
        { type: 'diff', path: 'src/bar.ts', oldText: null, newText: 'created' },
      ],
    };
    const result = toAgentUpdate(update);
    expect(result).toMatchObject({
      kind: 'tool_call',
      diffs: [
        { path: 'src/foo.ts', oldText: 'old', newText: 'new' },
        { path: 'src/bar.ts', oldText: null, newText: 'created' },
      ],
    });
  });

  it('ignores non-diff tool_call content blocks', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-5',
      title: 'Run',
      content: [{ type: 'content', content: { type: 'text', text: 'output' } }],
    };
    const result = toAgentUpdate(update);
    expect(result).toMatchObject({ kind: 'tool_call', diffs: [] });
  });

  it('uses null for absent kind and status', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-6',
      title: 'No kind',
    };
    const result = toAgentUpdate(update);
    expect(result).toMatchObject({ kind: 'tool_call', toolKind: null, status: null });
  });

  // ── tool_call_update ──────────────────────────────────────────────────────

  it('converts tool_call_update with all fields', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      title: 'Updated title',
      status: 'completed',
    };
    expect(toAgentUpdate(update)).toStrictEqual({
      kind: 'tool_update',
      toolCallId: 'tc-1',
      title: 'Updated title',
      toolKind: null,
      status: 'completed',
      parentToolCallId: null,
      diffs: [],
    });
  });

  it('extracts diffs from tool_call_update content', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-2',
      status: 'completed',
      content: [{ type: 'diff', path: 'a.ts', oldText: null, newText: 'x' }],
    };
    const result = toAgentUpdate(update);
    expect(result).toMatchObject({
      kind: 'tool_update',
      diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }],
    });
  });

  // ── ignored variants ──────────────────────────────────────────────────────

  it('converts plan with no entries to plan with empty entries', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'plan',
      entries: [],
    };
    expect(toAgentUpdate(update)).toStrictEqual({ kind: 'plan', entries: [] });
  });

  it('converts plan entries passing through content, status, and priority', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Add slugify helper', status: 'completed', priority: 'high' },
        { content: 'Write unit test', status: 'in_progress', priority: 'medium' },
        { content: 'Update README', status: 'pending', priority: 'low' },
      ],
    };
    expect(toAgentUpdate(update)).toStrictEqual({
      kind: 'plan',
      entries: [
        { content: 'Add slugify helper', status: 'completed', priority: 'high' },
        { content: 'Write unit test', status: 'in_progress', priority: 'medium' },
        { content: 'Update README', status: 'pending', priority: 'low' },
      ],
    });
  });

  it('returns ignored for available_commands_update', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'available_commands_update',
      availableCommands: [],
    };
    expect(toAgentUpdate(update)).toStrictEqual({ kind: 'ignored' });
  });

  it('returns ignored for current_mode_update', () => {
    const update: SessionUpdate = {
      sessionUpdate: 'current_mode_update',
      currentModeId: 'auto',
    };
    expect(toAgentUpdate(update)).toStrictEqual({ kind: 'ignored' });
  });
});
