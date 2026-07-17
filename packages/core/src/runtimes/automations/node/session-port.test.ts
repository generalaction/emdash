import { err, ok } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/api';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import type { AcpSessionStartContract, TuiSessionStartContract } from '@services/session-start/api';
import { describe, expect, it, vi } from 'vitest';
import { createSessionPortFromDependencies } from './session-port';

const cwd = absolute('/tmp/workspace');

describe('createSessionPortFromDependencies', () => {
  it('maps an ACP automation config to the narrow start dependency', async () => {
    const startSession = vi.fn(async () => ok({ sessionId: 'provider-session-1' }));
    const port = createSessionPortFromDependencies({
      acp: { startSession } as ContractClient<AcpSessionStartContract>,
      tui: unusedTuiClient(),
    });

    const result = await port.start({
      conversationId: 'conversation-1',
      cwd,
      agent: {
        type: 'acp',
        start: {
          providerId: 'claude',
          model: 'opus',
          modeId: 'agent',
          initialQueue: [{ text: 'Review this repository' }],
        },
      },
      signal: new AbortController().signal,
    });

    expect(result).toEqual(ok({ sessionId: 'provider-session-1' }));
    expect(startSession).toHaveBeenCalledWith(
      {
        input: {
          conversationId: 'conversation-1',
          providerId: 'claude',
          cwd: '/tmp/workspace',
          sessionId: null,
          model: 'opus',
          modeId: 'agent',
          initialQueue: [{ text: 'Review this repository' }],
        },
      },
      { signal: expect.any(AbortSignal) }
    );
  });

  it('supplies terminal geometry and returns no provider session id for TUI', async () => {
    const startSession = vi.fn(async () => ok({ outcome: 'started' as const }));
    const port = createSessionPortFromDependencies({
      acp: unusedAcpClient(),
      tui: { startSession } as ContractClient<TuiSessionStartContract>,
    });

    const result = await port.start({
      conversationId: 'conversation-2',
      cwd,
      agent: {
        type: 'tui',
        start: {
          providerId: 'codex',
          model: null,
          initialPrompt: 'Review this repository',
          autoApprove: true,
        },
      },
      signal: new AbortController().signal,
    });

    expect(result).toEqual(ok({ sessionId: null }));
    expect(startSession).toHaveBeenCalledWith(
      {
        input: {
          conversationId: 'conversation-2',
          providerId: 'codex',
          cwd: '/tmp/workspace',
          sessionId: null,
          model: null,
          initialPrompt: 'Review this repository',
          autoApprove: true,
          cols: 80,
          rows: 24,
        },
      },
      { signal: expect.any(AbortSignal) }
    );
  });

  it('preserves runtime error tags and maps rejected calls to a port error', async () => {
    const unavailable = createSessionPortFromDependencies({
      acp: {
        startSession: async () =>
          err({ type: 'runtime-unavailable', message: 'ACP is unavailable' }),
      },
      tui: unusedTuiClient(),
    });
    const rejected = createSessionPortFromDependencies({
      acp: {
        startSession: async () => {
          throw new Error('connection closed');
        },
      },
      tui: unusedTuiClient(),
    });
    const input = {
      conversationId: 'conversation-3',
      cwd,
      agent: {
        type: 'acp' as const,
        start: {
          providerId: 'claude',
          model: null,
          initialQueue: [{ text: 'Review this repository' }],
        },
      },
      signal: new AbortController().signal,
    };

    await expect(unavailable.start(input)).resolves.toEqual(
      err({ code: 'runtime-unavailable', message: 'ACP is unavailable' })
    );
    await expect(rejected.start(input)).resolves.toEqual(
      err({ code: 'session_start_failed', message: 'connection closed' })
    );
  });
});

function unusedAcpClient(): ContractClient<AcpSessionStartContract> {
  return { startSession: vi.fn() };
}

function unusedTuiClient(): ContractClient<TuiSessionStartContract> {
  return { startSession: vi.fn() };
}

function absolute(input: string) {
  const parsed = parseAbsolute(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}
