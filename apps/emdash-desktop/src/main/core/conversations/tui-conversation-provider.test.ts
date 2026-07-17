import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/core/conversations/conversations';
import { TuiConversationProvider } from './tui-conversation-provider';

const startSession = vi.hoisted(() => vi.fn());
const resumeSession = vi.hoisted(() => vi.fn());

vi.mock('@main/core/agents/workspace-trust', () => ({
  workspaceTrustService: { maybeAutoTrust: vi.fn(() => Promise.resolve()) },
}));

vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: { getItem: vi.fn(() => Promise.resolve(null)) },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn(() => Promise.resolve({ writeAgentConfigToGitIgnore: true })) },
}));

vi.mock('@main/core/terminal-shell/color-env', () => ({
  getTerminalColorEnv: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@main/gateway/accessors', () => ({
  getTuiAgentsRuntimeClient: vi.fn(() =>
    Promise.resolve({
      startSession,
      resumeSession,
    })
  ),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(),
  },
}));

describe('TuiConversationProvider', () => {
  beforeEach(() => {
    startSession.mockReset();
    resumeSession.mockReset();
    startSession.mockResolvedValue(ok({ outcome: 'started' }));
    resumeSession.mockResolvedValue(ok({ outcome: 'resumed' }));
  });

  it('routes fresh starts to the runtime start path with the initial prompt', async () => {
    const provider = createProvider();

    const result = await provider.ensureSession({
      conversation: conversation({ providerId: 'claude', sessionId: undefined }),
      mode: 'start',
      initialPrompt: 'hello',
    });

    expect(result).toEqual({ outcome: 'started' });
    expect(startSession).toHaveBeenCalledWith({
      input: expect.objectContaining({
        conversationId: 'conversation-1',
        providerId: 'claude',
        sessionId: null,
        initialPrompt: 'hello',
      }),
    });
    expect(resumeSession).not.toHaveBeenCalled();
  });

  it('routes native-id providers to the runtime resume path when a native id exists', async () => {
    const provider = createProvider();

    await provider.ensureSession({
      conversation: conversation({ providerId: 'codex', sessionId: 'native-session' }),
      mode: 'resume',
      initialPrompt: 'do not replay',
    });

    expect(resumeSession).toHaveBeenCalledWith({
      input: expect.objectContaining({
        providerId: 'codex',
        sessionId: 'native-session',
        initialPrompt: undefined,
      }),
    });
    expect(startSession).not.toHaveBeenCalled();
  });

  it('downgrades missing-native-id providers to fresh without replaying the prompt', async () => {
    const provider = createProvider();

    await provider.ensureSession({
      conversation: conversation({ providerId: 'codex', sessionId: 'conversation-1' }),
      mode: 'resume',
      initialPrompt: 'do not replay',
    });

    expect(startSession).toHaveBeenCalledWith({
      input: expect.objectContaining({
        providerId: 'codex',
        sessionId: null,
        initialPrompt: undefined,
      }),
    });
    expect(resumeSession).not.toHaveBeenCalled();
  });
});

function createProvider(): TuiConversationProvider {
  return new TuiConversationProvider({
    projectId: 'project-1',
    taskId: 'task-1',
    taskPath: '/workspace',
  });
}

function conversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'claude',
    title: 'Conversation',
    lastInteractedAt: null,
    isInitialConversation: false,
    type: 'pty',
    ...overrides,
  };
}
