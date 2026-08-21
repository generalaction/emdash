import { err, ok } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_HOST_REF } from '#primitives/host/api';
import { hostFileRef, parseAbsolute } from '#primitives/path/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- exercises the port's registry rewiring (workspaceHost retirement, spec §4.1)
import type { WorkspaceRegistryContract } from '#runtimes/workspace-registry/api';
import type { ConversationIndexContract } from '#services/conversation-index/api';
import type { AcpSessionStartContract, TuiSessionStartContract } from '#services/session-start/api';
import { createSessionPortFromDependencies } from './session-start';

const cwd = absolute('/tmp/workspace');

describe('createSessionPortFromDependencies', () => {
  it('creates the index record and registers + activates the workspace before an ACP start', async () => {
    const start = vi.fn(async () => ok({ sessionId: 'provider-session-1' }));
    const createWorkspace = vi.fn(async () => ok({ id: 'workspace-1' }));
    const activateWorkspace = vi.fn(async () => ok({ id: 'workspace-1' }));
    const create = vi.fn(async () => ok({ created: true }));
    const port = createSessionPortFromDependencies({
      workspaceRegistry: {
        createWorkspace,
        activateWorkspace,
      } as unknown as ContractClient<WorkspaceRegistryContract>,
      acp: { start } as ContractClient<AcpSessionStartContract>,
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
        conversationId: 'conversation-1',
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
      createWorkspace.mock.invocationCallOrder[0]!
    );
    // Registration mints a fresh id and hands the registry the native cwd path.
    expect(createWorkspace).toHaveBeenCalledWith(
      { workspaceId: expect.any(String), path: '/tmp/workspace' },
      { signal: expect.any(AbortSignal) }
    );
    // Activation targets the record id the registration settled on.
    expect(activateWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1' },
      { signal: expect.any(AbortSignal) }
    );
    expect(createWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      activateWorkspace.mock.invocationCallOrder[0]!
    );
    expect(activateWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0]!
    );
    expect(start).toHaveBeenCalledWith(
      {
        conversationId: 'conversation-1',
        providerId: 'claude',
        cwd: '/tmp/workspace',
        sessionId: null,
        model: 'opus',
        modeId: 'agent',
        initialQueue: [{ text: 'Review this repository' }],
      },
      { signal: expect.any(AbortSignal) }
    );
  });

  it('adopts the existing registry record when the path is already registered', async () => {
    const start = vi.fn(async () => ok({ sessionId: 'provider-session-2' }));
    const activateWorkspace = vi.fn(async () => ok({ id: 'existing-workspace' }));
    const port = createSessionPortFromDependencies({
      workspaceRegistry: {
        createWorkspace: vi.fn(async () => ok({ id: 'existing-workspace' })),
        activateWorkspace,
      } as unknown as ContractClient<WorkspaceRegistryContract>,
      acp: { start } as ContractClient<AcpSessionStartContract>,
      tui: unusedTuiClient(),
      conversationIndex: creatingConversationIndex(),
    });

    const result = await port.start({
      conversationId: 'conversation-6',
      cwd,
      agent: {
        type: 'acp',
        start: { providerId: 'claude', model: null, initialQueue: [{ text: 'Go' }] },
      },
      fallbackTitle: 'Run',
      signal: new AbortController().signal,
    });

    expect(result).toEqual(ok({ sessionId: 'provider-session-2' }));
    expect(activateWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'existing-workspace' },
      { signal: expect.any(AbortSignal) }
    );
  });

  it('supplies terminal geometry and returns no provider session id for TUI', async () => {
    const start = vi.fn(async () => ok({ outcome: 'started' as const }));
    const create = vi.fn(async () => ok({ created: true }));
    const port = createSessionPortFromDependencies({
      workspaceRegistry: activatingWorkspaceRegistry(),
      acp: unusedAcpClient(),
      tui: { start } as ContractClient<TuiSessionStartContract>,
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
      expect.objectContaining({
        conversationId: 'conversation-2',
        type: 'pty',
        idRegime: 'emdash-chosen',
      }),
      { signal: expect.any(AbortSignal) }
    );
    expect(start).toHaveBeenCalledWith(
      {
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
      { signal: expect.any(AbortSignal) }
    );
  });

  it('fails without starting a session when record creation fails', async () => {
    const start = vi.fn();
    const createWorkspace = vi.fn();
    const port = createSessionPortFromDependencies({
      workspaceRegistry: {
        createWorkspace,
      } as unknown as ContractClient<WorkspaceRegistryContract>,
      acp: { start } as unknown as ContractClient<AcpSessionStartContract>,
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
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('fails without starting a session when workspace registration fails', async () => {
    const start = vi.fn();
    const port = createSessionPortFromDependencies({
      workspaceRegistry: {
        createWorkspace: async () => err({ type: 'path-not-found', path: '/tmp/workspace' }),
        activateWorkspace: vi.fn(),
      } as unknown as ContractClient<WorkspaceRegistryContract>,
      acp: { start } as unknown as ContractClient<AcpSessionStartContract>,
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
    ).resolves.toEqual(
      err({ code: 'path-not-found', message: 'Workspace path not found: /tmp/workspace' })
    );
    expect(start).not.toHaveBeenCalled();
  });

  it('fails without starting a session when workspace activation fails', async () => {
    const start = vi.fn();
    const port = createSessionPortFromDependencies({
      workspaceRegistry: {
        createWorkspace: async () => ok({ id: 'workspace-1' }),
        activateWorkspace: async () =>
          err({ type: 'workspace-missing', workspaceId: 'workspace-1' }),
      } as unknown as ContractClient<WorkspaceRegistryContract>,
      acp: { start } as unknown as ContractClient<AcpSessionStartContract>,
      tui: unusedTuiClient(),
      conversationIndex: creatingConversationIndex(),
    });

    await expect(
      port.start({
        conversationId: 'conversation-7',
        cwd,
        agent: {
          type: 'acp',
          start: { providerId: 'claude', model: null, initialQueue: [{ text: 'Go' }] },
        },
        fallbackTitle: 'Run',
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(
      err({
        code: 'workspace-missing',
        message: 'Workspace path is missing on disk: workspace-1',
      })
    );
    expect(start).not.toHaveBeenCalled();
  });

  it('preserves runtime error tags and maps rejected calls to a port error', async () => {
    const unavailable = createSessionPortFromDependencies({
      workspaceRegistry: activatingWorkspaceRegistry(),
      acp: {
        start: async () => err({ type: 'runtime-unavailable', message: 'ACP is unavailable' }),
      },
      tui: unusedTuiClient(),
      conversationIndex: creatingConversationIndex(),
    });
    const rejected = createSessionPortFromDependencies({
      workspaceRegistry: activatingWorkspaceRegistry(),
      acp: {
        start: async () => {
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

function activatingWorkspaceRegistry(): ContractClient<WorkspaceRegistryContract> {
  return {
    createWorkspace: vi.fn(async () => ok({ id: 'workspace-1' })),
    activateWorkspace: vi.fn(async () => ok({ id: 'workspace-1' })),
  } as unknown as ContractClient<WorkspaceRegistryContract>;
}

function creatingConversationIndex(): ContractClient<ConversationIndexContract> {
  return {
    create: vi.fn(async () => ok({ created: true })),
  } as unknown as ContractClient<ConversationIndexContract>;
}

function unusedAcpClient(): ContractClient<AcpSessionStartContract> {
  return { start: vi.fn() };
}

function unusedTuiClient(): ContractClient<TuiSessionStartContract> {
  return { start: vi.fn() };
}

function absolute(input: string) {
  const parsed = parseAbsolute(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}
