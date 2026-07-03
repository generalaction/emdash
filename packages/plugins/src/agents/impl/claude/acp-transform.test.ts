import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '@emdash/core/acp';
import { describe, expect, it } from 'vitest';
import { enrichClaudeUpdate } from './acp-transform';

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
});
