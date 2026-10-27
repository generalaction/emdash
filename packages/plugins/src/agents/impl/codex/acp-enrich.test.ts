import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { decodeSessionUpdate } from '@emdash/core/runtimes/acp/api';
import { describe, expect, it } from 'vitest';
import { enrichCodexUpdate } from './acp-enrich';

const startupFailure = (server: string): SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: `mcp_startup.${encodeURIComponent(server)}`,
  title: `mcp__${server}__startup`,
  kind: 'other',
  status: 'failed',
  content: [{ type: 'content', content: { type: 'text', text: 'Connection refused' } }],
});

describe('Codex MCP startup diagnostics', () => {
  it('extracts the server identity without parsing diagnostic prose', () => {
    const raw = startupFailure('docs / team_ä');
    expect(enrichCodexUpdate(decodeSessionUpdate(raw), raw)).toEqual({
      kind: 'mcp_startup_failure',
      server: 'docs / team_ä',
      error: 'Connection refused',
    });
  });

  it.each([
    { toolCallId: 'ordinary-tool-call' },
    { toolCallId: 'mcp_startup.%ZZ' },
    { title: 'mcp__docs__search' },
    { status: 'completed' as const },
    { kind: 'execute' as const },
  ])('preserves nonmatching events: %j', (overrides) => {
    const raw = { ...startupFailure('docs'), ...overrides } as SessionUpdate;
    const decoded = decodeSessionUpdate(raw);
    expect(enrichCodexUpdate(decoded, raw)).toBe(decoded);
  });
});
