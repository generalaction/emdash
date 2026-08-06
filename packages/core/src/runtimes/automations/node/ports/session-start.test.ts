import { err, ok } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/rpc';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import type { ConversationIndexContract } from '@services/conversation-index/api';
import type { AcpSessionStartContract, TuiSessionStartContract } from '@services/session-start/api';
import type { WorkspaceHostActionsContract } from '@services/workspace-host-actions/api';
import { describe, expect, it, vi } from 'vitest';
import { createSessionPortFromDependencies } from './session-start';

const cwd = absolute('/tmp/workspace');

describe('createSessionPortFromDependencies', () => {
  it('creates the index record and initializes the workspace before an ACP start', async () => {
    const startSession = vi.fn(async () => ok({ sessionId: 'provider-session-1' }));
    const initializeWorkspace = vi.fn(async () => ok({ active: true as const }));
    const create = vi.fn(async () => ok({ created: true }));
    const port = createSessionPortFromDependencies({
      workspaceHost: {
        initializeWorkspace,
      } as unknown as ContractClient<WorkspaceHostActionsContract>,
      acp: { startSession } as ContractClient<AcpSessionStartContract>,
      tui: unusedTuiClient(),
      conversationIndex: { create } as unknown as ContractClient<ConversationIndexContract>,
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
      fallbackTitle: 'Nightly review',
      signal: new AbortController().signal,
    });

    expect(result).toEqual(ok({ sessionId: 'provider-session-1' }));
    // Host-side record creation (spec §10.5) precedes everything: the record must
    // exist — dangling — before any session runtime reports against it.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conversation-1',
        provider: 'claude',
        type: 'acp',
        cwd: '/tmp/workspace',
        workspacePath: '/tmp/workspace',
        idRegime: 'provider-minted',
        title: 'Nightly review',
      }),
      { signal: expect.any(AbortSignal) }
    );
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      initializeWorkspace.mock.invocationCallOrder[0]!
    );
    expect(initializeWorkspace).toHaveBeenCalledWith(
      { workspacePath: cwd.path },
      { signal: expect.any(AbortSignal) }
    );
    expect(initializeWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      startSession.mock.invocationCallOrder[0]!
    );
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
    const create = vi.fn(async () => ok({ created: true }));
    const port = createSessionPortFromDependencies({
      workspaceHost: initializedWorkspaceHost(),
      acp: unusedAcpClient(),
      tui: { startSession } as ContractClient<TuiSessionStartContract>,
      conversationIndex: { create } as unknown as ContractClient<ConversationIndexContract>,
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
      fallbackTitle: 'Nightly review',
      signal: new AbortController().signal,
    });

    expect(result).toEqual(ok({ sessionId: null }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-2', type: 'pty', idRegime: 'emdash-chosen' }),
      { signal: expect.any(AbortSignal) }
    );
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

  it('fails without starting a session when record creation fails', async () => {
    const startSession = vi.fn();
    const initializeWorkspace = vi.fn();
    const port = createSessionPortFromDependencies({
      workspaceHost: {
        initializeWorkspace,
      } as unknown as ContractClient<WorkspaceHostActionsContract>,
      acp: { startSession } as unknown as ContractClient<AcpSessionStartContract>,
      tui: unusedTuiClient(),
      conversationIndex: {
        create: async () => err({ type: 'invalid-input', message: 'Bad record' }),
      } as unknown as ContractClient<ConversationIndexContract>,
    });

    await expect(
      port.start({
        conversationId: 'conversation-5',
        cwd,
        agent: {
          type: 'acp',
          start: { providerId: 'claude', model: null, initialQueue: [{ text: 'Go' }] },
        },
        fallbackTitle: 'Run',
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(err({ code: 'invalid-input', message: 'Bad record' }));
    expect(initializeWorkspace).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('fails without starting a session when workspace initialization fails', async () => {
    const startSession = vi.fn();
    const port = createSessionPortFromDependencies({
      workspaceHost: {
        initializeWorkspace: async () =>
          err({ type: 'filesystem-error', message: 'Worktree is missing' }),
      } as unknown as ContractClient<WorkspaceHostActionsContract>,
      acp: { startSession } as unknown as ContractClient<AcpSessionStartContract>,
      tui: unusedTuiClient(),
      conversationIndex: creatingConversationIndex(),
    });

    await expect(
      port.start({
        conversationId: 'conversation-4',
        cwd,
        agent: {
          type: 'acp',
          start: { providerId: 'claude', model: null, initialQueue: [{ text: 'Go' }] },
        },
        fallbackTitle: 'Run',
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(err({ code: 'filesystem-error', message: 'Worktree is missing' }));
    expect(startSession).not.toHaveBeenCalled();
  });

  it('preserves runtime error tags and maps rejected calls to a port error', async () => {
    const unavailable = createSessionPortFromDependencies({
      workspaceHost: initializedWorkspaceHost(),
      acp: {
        startSession: async () =>
          err({ type: 'runtime-unavailable', message: 'ACP is unavailable' }),
      },
      tui: unusedTuiClient(),
      conversationIndex: creatingConversationIndex(),
    });
    const rejected = createSessionPortFromDependencies({
      workspaceHost: initializedWorkspaceHost(),
      acp: {
        startSession: async () => {
          throw new Error('connection closed');
        },
      },
      tui: unusedTuiClient(),
      conversationIndex: creatingConversationIndex(),
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
      fallbackTitle: 'Run',
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

function initializedWorkspaceHost(): ContractClient<WorkspaceHostActionsContract> {
  return {
    initializeWorkspace: vi.fn(async () => ok({ active: true as const })),
  } as unknown as ContractClient<WorkspaceHostActionsContract>;
}

function creatingConversationIndex(): ContractClient<ConversationIndexContract> {
  return {
    create: vi.fn(async () => ok({ created: true })),
  } as unknown as ContractClient<ConversationIndexContract>;
}

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
