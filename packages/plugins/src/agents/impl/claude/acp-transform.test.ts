import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { normalizeClaudeUpdate } from './acp-transform';

/** Minimal text chunk fixture — overrides replace the top-level object. */
function textChunk(metaOverride?: Record<string, unknown>): SessionUpdate {
  const base: SessionUpdate = {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'hello' },
  };
  if (metaOverride !== undefined) {
    return { ...base, _meta: metaOverride };
  }
  return base;
}

describe('normalizeClaudeUpdate', () => {
  it('is identity when _meta is absent', () => {
    const update = textChunk();
    expect(normalizeClaudeUpdate(update)).toBe(update);
  });

  it('is identity when _meta.claudeCode is absent', () => {
    const update = textChunk({ other: 'value' });
    expect(normalizeClaudeUpdate(update)).toBe(update);
  });

  it('is identity when parentToolUseId is absent from claudeCode', () => {
    const update = textChunk({ claudeCode: { toolName: 'Bash' } });
    expect(normalizeClaudeUpdate(update)).toBe(update);
  });

  it('is identity when parentToolUseId is not a string', () => {
    const update = textChunk({ claudeCode: { parentToolUseId: 42 } });
    expect(normalizeClaudeUpdate(update)).toBe(update);
  });

  it('promotes parentToolUseId to _meta.emdash.parentToolCallId', () => {
    const update = textChunk({ claudeCode: { parentToolUseId: 'tool-abc-123' } });
    const result = normalizeClaudeUpdate(update);
    expect(result).not.toBe(update);
    expect((result._meta as { emdash?: { parentToolCallId?: string } }).emdash?.parentToolCallId).toBe(
      'tool-abc-123'
    );
  });

  it('preserves existing _meta fields alongside the promoted value', () => {
    const update = textChunk({
      claudeCode: { parentToolUseId: 'tool-parent', toolName: 'Read' },
      existingKey: 'preserved',
    });
    const result = normalizeClaudeUpdate(update);
    const meta = result._meta as Record<string, unknown>;
    expect(meta.existingKey).toBe('preserved');
    expect((meta.claudeCode as { toolName: string }).toolName).toBe('Read');
    expect((meta.emdash as { parentToolCallId: string }).parentToolCallId).toBe('tool-parent');
  });

  it('preserves existing _meta.emdash fields when promoting', () => {
    const update = textChunk({
      claudeCode: { parentToolUseId: 'tool-xyz' },
      emdash: { otherField: 'keep-me' },
    });
    const result = normalizeClaudeUpdate(update);
    const emdash = (result._meta as { emdash?: Record<string, unknown> }).emdash;
    expect(emdash?.parentToolCallId).toBe('tool-xyz');
    expect(emdash?.otherField).toBe('keep-me');
  });

  it('does not mutate the original update', () => {
    const update = textChunk({ claudeCode: { parentToolUseId: 'tool-xyz' } });
    normalizeClaudeUpdate(update);
    const cc = (update._meta as { claudeCode: { parentToolUseId: string } }).claudeCode;
    expect(cc.parentToolUseId).toBe('tool-xyz');
    expect((update._meta as { emdash?: unknown }).emdash).toBeUndefined();
  });
});
