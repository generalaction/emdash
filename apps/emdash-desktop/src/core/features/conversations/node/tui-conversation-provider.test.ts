import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@core/primitives/conversations/api';
import {
  TuiConversationProvider,
  type TuiConversationProviderOptions,
} from './tui-conversation-provider';

const start = vi.hoisted(() => vi.fn());
const resume = vi.hoisted(() => vi.fn());

describe('TuiConversationProvider', () => {
  beforeEach(() => {
    start.mockReset();
    resume.mockReset();
    start.mockResolvedValue(ok({ outcome: 'started' }));
    resume.mockResolvedValue(ok({ outcome: 'resumed' }));
  });

  it('routes fresh starts to the runtime start path with the initial prompt', async () => {
    const provider = createProvider();

    const result = await provider.ensureSession({
      conversation: conversation({ providerId: 'claude', sessionId: undefined }),
      mode: 'start',
      initialPrompt: 'hello',
    });

    expect(result).toEqual({ outcome: 'started' });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        providerId: 'claude',
        sessionId: null,
        initialPrompt: 'hello',
        trustWorkspace: false,
      })
    );
    expect(resume).not.toHaveBeenCalled();
  });

  it.each(['codex', 'prime-agent'])(
    'routes native-id provider %s to the runtime resume path when a native id exists',
    async (providerId) => {
      const provider = createProvider();

      await provider.ensureSession({
        conversation: conversation({ providerId, sessionId: 'native-session' }),
        mode: 'resume',
        initialPrompt: 'do not replay',
      });

      expect(resume).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId,
          sessionId: 'native-session',
          initialPrompt: undefined,
        })
      );
      expect(start).not.toHaveBeenCalled();
    }
  );

  it.each(['codex', 'prime-agent'])(
    'downgrades missing-native-id provider %s to fresh without replaying the prompt',
    async (providerId) => {
      const provider = createProvider();

      await provider.ensureSession({
        conversation: conversation({ providerId, sessionId: 'conversation-1' }),
        mode: 'resume',
        initialPrompt: 'do not replay',
      });

      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId,
          sessionId: null,
          initialPrompt: undefined,
        })
      );
      expect(resume).not.toHaveBeenCalled();
    }
  );

  it.each([
    { label: 'local', host: { type: 'local', id: 'local' } as const },
    { label: 'remote', host: { type: 'remote', id: 'ssh-1' } as const },
  ])('sends the settings-driven trust verdict to the $label runtime', async ({ host }) => {
    const provider = createProvider({ host, autoTrustWorktrees: true });

    await provider.ensureSession({
      conversation: conversation({ providerId: 'claude' }),
      mode: 'start',
    });

    expect(start).toHaveBeenCalledWith(expect.objectContaining({ trustWorkspace: true }));
  });

  it('forces runtime trust for auto-approved conversations without reading settings', async () => {
    const getTaskSettings = vi.fn(async () => ({ autoTrustWorktrees: false }));
    const provider = createProvider({
      host: { type: 'remote', id: 'ssh-1' },
      getTaskSettings,
    });

    await provider.ensureSession({
      conversation: conversation({ providerId: 'claude', autoApprove: true }),
      mode: 'start',
    });

    expect(getTaskSettings).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ trustWorkspace: true }));
  });

  it('resolves mutable task launch context immediately before each fresh start', async () => {
    let launchContext = {
      workspace: {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        host: { type: 'local', id: 'local' } as const,
        path: '/workspace',
      },
      tmux: false,
      shellSetup: 'source old-profile',
      env: { EMDASH_TASK_NAME: 'old-name' },
    };
    const resolve = vi.fn(async () => ok(launchContext));
    const provider = createProvider({ launchContextSource: { resolve } });

    await provider.ensureSession({
      conversation: conversation({ id: 'conversation-1', providerId: 'claude' }),
      mode: 'start',
    });

    launchContext = {
      ...launchContext,
      tmux: true,
      shellSetup: 'source new-profile',
      env: { EMDASH_TASK_NAME: 'new-name' },
    };
    await provider.ensureSession({
      conversation: conversation({ id: 'conversation-2', providerId: 'claude' }),
      mode: 'start',
    });

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        providerVars: expect.objectContaining({ EMDASH_TASK_NAME: 'old-name' }),
        shellSetup: 'source old-profile',
        tmuxSessionName: undefined,
      })
    );
    expect(start).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        providerVars: expect.objectContaining({ EMDASH_TASK_NAME: 'new-name' }),
        shellSetup: 'source new-profile',
        tmuxSessionName: expect.stringMatching(/^emdash-/),
      })
    );
  });
});

function createProvider(
  overrides: {
    host?: TuiConversationProviderOptions['host'];
    autoTrustWorktrees?: boolean;
    getTaskSettings?: () => Promise<{ autoTrustWorktrees: boolean }>;
    launchContextSource?: TuiConversationProviderOptions['launchContextSource'];
  } = {}
): TuiConversationProvider {
  return new TuiConversationProvider(
    {
      host: overrides.host ?? { type: 'local', id: 'local' },
      tuiAgents: { start, resume } as never,
      projectId: 'project-1',
      taskId: 'task-1',
      taskPath: '/workspace',
      launchContextSource: overrides.launchContextSource ?? {
        resolve: async () =>
          ok({
            workspace: {
              workspaceId: 'workspace-1',
              projectId: 'project-1',
              host: overrides.host ?? { type: 'local', id: 'local' },
              path: '/workspace',
            },
            tmux: false,
            env: {},
          }),
      },
    },
    {
      db: { select: vi.fn() } as never,
      getProviderConfig: () => Promise.resolve(undefined),
      getTaskSettings:
        overrides.getTaskSettings ??
        (() => Promise.resolve({ autoTrustWorktrees: overrides.autoTrustWorktrees ?? false })),
      getTerminalColorEnv: () => Promise.resolve({}),
      resolveSessionGitCredentials: () => Promise.resolve(undefined),
    }
  );
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
