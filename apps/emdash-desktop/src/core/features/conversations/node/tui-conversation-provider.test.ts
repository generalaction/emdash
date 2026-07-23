import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@core/primitives/conversations/api';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import {
  createWorkspacePromptSpillDeps,
  TuiConversationProvider,
  type TuiConversationProviderOptions,
} from './tui-conversation-provider';

const startSession = vi.hoisted(() => vi.fn());
const resumeSession = vi.hoisted(() => vi.fn());

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

  it('treats remote workspace trust as a safe no-op target', async () => {
    const maybeAutoTrust = vi.fn(() => Promise.resolve());
    const provider = createProvider({
      host: { type: 'remote', id: 'ssh-1' },
      maybeAutoTrust,
    });

    await provider.ensureSession({
      conversation: conversation({ providerId: 'claude' }),
      mode: 'start',
    });

    expect(maybeAutoTrust).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '/workspace',
        host: { kind: 'remote' },
      })
    );
  });

  it('backs prompt spill creation, writes, and cleanup with workspace files', async () => {
    const createDirectory = vi.fn().mockResolvedValue(ok(undefined));
    const writeFile = vi.fn().mockResolvedValue(ok(undefined));
    const remove = vi.fn().mockResolvedValue(ok(undefined));
    const root = hostPathFromNative('/workspace');
    const files = {
      root,
      client: {
        mutations: {
          createDirectory,
          writeFile,
          delete: remove,
        },
      },
    } as never;
    const deps = createWorkspacePromptSpillDeps(files, '/workspace', 'conversation-1');
    if (!deps.createTempDir || !deps.writeContextFile || !deps.removeTempDir) {
      throw new Error('Expected complete workspace spill dependencies');
    }

    const directory = await deps.createTempDir();
    const contextFile = `${directory}/task-context.md`;
    await deps.writeContextFile(contextFile, 'large prompt');
    await deps.removeTempDir(directory);

    expect(directory).toBe('/workspace/.emdash/tmp/prompt-conversation-1');
    expect(createDirectory).toHaveBeenNthCalledWith(1, { root, path: '.emdash' });
    expect(createDirectory).toHaveBeenNthCalledWith(2, { root, path: '.emdash/tmp' });
    expect(createDirectory).toHaveBeenNthCalledWith(3, {
      root,
      path: '.emdash/tmp/prompt-conversation-1',
    });
    expect(writeFile).toHaveBeenCalledWith({
      root,
      path: '.emdash/tmp/prompt-conversation-1/task-context.md',
      content: 'large prompt',
      precondition: { kind: 'overwrite' },
    });
    expect(remove).toHaveBeenCalledWith({
      root,
      path: '.emdash/tmp/prompt-conversation-1',
      recursive: true,
    });
  });
});

function createProvider(
  overrides: {
    host?: TuiConversationProviderOptions['host'];
    maybeAutoTrust?: ReturnType<typeof vi.fn<() => Promise<void>>>;
  } = {}
): TuiConversationProvider {
  return new TuiConversationProvider(
    {
      host: overrides.host ?? { type: 'local', id: 'local' },
      files: {
        root: hostPathFromNative('/workspace'),
        client: { mutations: {} },
      } as never,
      tuiAgents: { startSession, resumeSession } as never,
      projectId: 'project-1',
      taskId: 'task-1',
      taskPath: '/workspace',
    },
    {
      db: { select: vi.fn() } as never,
      getLocalProjectSettings: () => Promise.resolve({ writeAgentConfigToGitIgnore: true }),
      getProviderConfig: () => Promise.resolve(undefined),
      getTerminalColorEnv: () => Promise.resolve({}),
      workspaceTrust: {
        maybeAutoTrust: overrides.maybeAutoTrust ?? vi.fn(() => Promise.resolve()),
      } as never,
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
