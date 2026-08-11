import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '@emdash/core/runtimes/acp/api';
import { describe, expect, it } from 'vitest';
import { enrichClaudeUpdate, parseTaskNotification } from './acp-transform';

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeToolCall(
  overrides: Partial<NormalizedEvent & { kind: 'tool_call' }> = {}
): NormalizedEvent {
  return {
    kind: 'tool_call',
    toolCallId: 'tc-1',
    title: 'Run bash',
    toolKind: 'execute',
    status: 'in_progress',
    parentToolCallId: null,
    diffs: [],
    ...overrides,
  };
}

function makeToolUpdate(
  overrides: Partial<NormalizedEvent & { kind: 'tool_update' }> = {}
): NormalizedEvent {
  return {
    kind: 'tool_update',
    toolCallId: 'tc-1',
    title: null,
    toolKind: null,
    status: 'completed',
    parentToolCallId: null,
    diffs: [],
    ...overrides,
  };
}

function makeRaw(meta?: Record<string, unknown>): SessionUpdate {
  return {
    sessionUpdate: 'tool_call',
    toolCallId: 'tc-1',
    title: 'Run bash',
    ...(meta !== undefined ? { _meta: meta } : {}),
  };
}

// ── enrichClaudeUpdate ────────────────────────────────────────────────────────

describe('enrichClaudeUpdate', () => {
  it('is identity for message kind', () => {
    const update: NormalizedEvent = {
      kind: 'message',
      role: 'assistant',
      messageId: 'assistant',
      text: 'hello',
    };
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-1' } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for thinking kind', () => {
    const update: NormalizedEvent = { kind: 'thinking', messageId: 'main', text: 'thinking...' };
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-1' } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for ignored kind', () => {
    const update: NormalizedEvent = { kind: 'ignored' };
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-1' } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for tool_call when _meta is absent', () => {
    const update = makeToolCall();
    const raw = makeRaw();
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for tool_call when claudeCode is absent', () => {
    const update = makeToolCall();
    const raw = makeRaw({ other: 'value' });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for tool_call when parentToolUseId is absent', () => {
    const update = makeToolCall();
    const raw = makeRaw({ claudeCode: { toolName: 'Bash' } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('is identity for tool_call when parentToolUseId is not a string', () => {
    const update = makeToolCall();
    const raw = makeRaw({ claudeCode: { parentToolUseId: 42 } });
    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('promotes parentToolUseId to parentToolCallId on tool_call', () => {
    const update = makeToolCall();
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-abc' } });
    const result = enrichClaudeUpdate(update, raw);
    expect(result).not.toBe(update);
    expect(result).toMatchObject({ kind: 'tool_call', parentToolCallId: 'parent-abc' });
  });

  it('promotes parentToolUseId to parentToolCallId on tool_update', () => {
    const update = makeToolUpdate();
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-xyz' } });
    const result = enrichClaudeUpdate(update, raw);
    expect(result).not.toBe(update);
    expect(result).toMatchObject({ kind: 'tool_update', parentToolCallId: 'parent-xyz' });
  });

  it('uses rawOutput as Claude execute output fallback when standard content is absent', () => {
    const update = makeToolUpdate();
    const raw = {
      ...makeRaw({ claudeCode: { toolName: 'Bash' } }),
      rawOutput: 'hello from raw output',
    } as unknown as SessionUpdate;

    expect(enrichClaudeUpdate(update, raw)).toMatchObject({
      kind: 'tool_update',
      outputText: 'hello from raw output',
    });
  });

  it('does not overwrite standard outputText with Claude rawOutput', () => {
    const update = makeToolUpdate({ outputText: 'standard output' });
    const raw = {
      ...makeRaw({ claudeCode: { toolName: 'Bash' } }),
      rawOutput: 'raw output',
    } as unknown as SessionUpdate;

    expect(enrichClaudeUpdate(update, raw)).toBe(update);
  });

  it('preserves all other fields on tool_call when enriching', () => {
    const update = makeToolCall({ toolCallId: 'tc-99', title: 'Read file', toolKind: 'read' });
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-1' } });
    const result = enrichClaudeUpdate(update, raw);
    expect(result).toMatchObject({
      kind: 'tool_call',
      toolCallId: 'tc-99',
      title: 'Read file',
      toolKind: 'read',
    });
  });

  it('does not mutate the original update', () => {
    const update = makeToolCall();
    const raw = makeRaw({ claudeCode: { parentToolUseId: 'parent-42' } });
    enrichClaudeUpdate(update, raw);
    expect(update).toMatchObject({ kind: 'tool_call', parentToolCallId: null });
  });

  it('reclassifies Claude Agent tool calls as subagent events', () => {
    const update = makeToolCall({ title: 'Task', toolKind: 'think' });
    const raw = makeRaw({ claudeCode: { toolName: 'Agent' } });

    expect(enrichClaudeUpdate(update, raw)).toMatchObject({
      kind: 'subagent',
      toolCallId: 'tc-1',
      title: 'Task',
      status: 'in_progress',
      parentToolCallId: null,
    });
  });

  it('marks async-launched agents as running background subagents', () => {
    const update = makeToolUpdate({ title: null, status: 'completed' });
    const raw = makeRaw({
      claudeCode: {
        toolName: 'Agent',
        toolResponse: {
          isAsync: true,
          status: 'async_launched',
          agentId: 'agent-1',
          description: 'Find event parsing',
          outputFile: '/tmp/agent-1.output',
        },
      },
    });

    expect(enrichClaudeUpdate(update, raw)).toMatchObject({
      kind: 'subagent',
      agentId: 'agent-1',
      background: true,
      outputFile: '/tmp/agent-1.output',
      title: 'Find event parsing',
      status: 'in_progress',
    });
  });

  it('reclassifies task-notification user chunks as subagent updates', () => {
    const update: NormalizedEvent = {
      kind: 'message',
      role: 'user',
      messageId: 'u1',
      text: [
        '<task-notification>',
        '<task-id>agent-1</task-id>',
        '<tool-use-id>toolu_123</tool-use-id>',
        '<output-file>/tmp/agent-1.output</output-file>',
        '<status>completed</status>',
        '<summary>Agent "Find event parsing" finished</summary>',
        '</task-notification>',
      ].join('\n'),
    };

    expect(enrichClaudeUpdate(update, makeRaw())).toEqual({
      kind: 'subagent_update',
      agentId: 'agent-1',
      toolCallId: 'toolu_123',
      status: 'completed',
      summary: 'Agent "Find event parsing" finished',
      outputFile: '/tmp/agent-1.output',
    });
  });

  it('ignores local command pseudo-user chunks', () => {
    const update: NormalizedEvent = {
      kind: 'message',
      role: 'user',
      messageId: 'u1',
      text: '<command-name>/model</command-name>',
    };

    expect(enrichClaudeUpdate(update, makeRaw())).toEqual({ kind: 'ignored' });
  });
});

describe('parseTaskNotification', () => {
  it('extracts the stable notification fields without parsing the result body', () => {
    expect(
      parseTaskNotification(
        [
          '<task-notification>',
          '<task-id>agent-1</task-id>',
          '<tool-use-id>toolu_123</tool-use-id>',
          '<output-file>/tmp/agent-1.output</output-file>',
          '<status>completed</status>',
          '<summary>Background command "Search & report" completed</summary>',
          '<result>May contain <xml-like> text and markdown.</result>',
          '</task-notification>',
        ].join('\n')
      )
    ).toEqual({
      taskId: 'agent-1',
      toolUseId: 'toolu_123',
      outputFile: '/tmp/agent-1.output',
      status: 'completed',
      summary: 'Background command "Search & report" completed',
    });
  });
});
