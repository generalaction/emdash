import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { getConversationById } from '@main/core/conversations/getConversationById';
import { mcpInternalService } from '@main/core/mcp-internal';
import {
  handleProjectList,
  handleTaskCreate,
  handleTaskList,
  handleTerminalCreate,
  handleTerminalList,
  handleTerminalSend,
} from '@main/core/mcp-internal/routes/orchestration';
import {
  invokeProjectList,
  invokeTaskCreate,
  invokeTaskList,
  invokeTerminalCreate,
  invokeTerminalList,
  invokeTerminalSend,
  invokeWorkspaceDevServers,
} from './direct-invoke';

vi.mock('@main/core/conversations/getConversationById', () => ({
  getConversationById: vi.fn(),
}));

vi.mock('@main/core/mcp-internal', () => ({
  mcpInternalService: {
    listWorkspaceDevServers: vi.fn(),
  },
}));

vi.mock('@main/core/mcp-internal/routes/orchestration', () => ({
  handleProjectList: vi.fn(),
  handleTaskList: vi.fn(),
  handleTaskCreate: vi.fn(),
  handleTerminalList: vi.fn(),
  handleTerminalCreate: vi.fn(),
  handleTerminalSend: vi.fn(),
}));

const callerConversation: Conversation = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  providerId: 'codex',
  title: 'Driver',
  lastInteractedAt: null,
  isInitialConversation: true,
};

describe('mcp direct invoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConversationById).mockResolvedValue(callerConversation);
  });

  it('resolves caller context for project and task list invocations', async () => {
    vi.mocked(handleProjectList).mockResolvedValueOnce([
      {
        id: 'project-1',
        name: 'Emdash',
        path: 'C:\\repo',
        baseRef: 'main',
        archived: false,
      },
    ]);
    vi.mocked(handleTaskList).mockResolvedValueOnce([
      {
        id: 'task-1',
        projectId: 'project-1',
        projectName: 'Emdash',
        name: 'Ship it',
        status: 'todo',
      },
    ]);

    await expect(
      invokeProjectList({
        callerConversationId: callerConversation.id,
        includeArchived: true,
      })
    ).resolves.toEqual([
      {
        id: 'project-1',
        name: 'Emdash',
        path: 'C:\\repo',
        baseRef: 'main',
        archived: false,
      },
    ]);

    await expect(
      invokeTaskList({
        callerConversationId: callerConversation.id,
        projectId: 'project-2',
        includeArchived: true,
      })
    ).resolves.toEqual([
      {
        id: 'task-1',
        projectId: 'project-1',
        projectName: 'Emdash',
        name: 'Ship it',
        status: 'todo',
      },
    ]);

    expect(handleProjectList).toHaveBeenCalledWith(
      { conversation: callerConversation },
      { includeArchived: true }
    );
    expect(handleTaskList).toHaveBeenCalledWith(
      { conversation: callerConversation },
      { projectId: 'project-2', includeArchived: true }
    );
  });

  it('forwards task and terminal mutations through the shared handlers', async () => {
    vi.mocked(handleTaskCreate).mockResolvedValueOnce({
      taskId: 'task-2',
      taskName: 'Investigate',
      taskBranch: 'investigate',
      projectId: 'project-1',
      conversationId: 'conversation-2',
    });
    vi.mocked(handleTerminalList).mockResolvedValueOnce([
      { id: 'terminal-1', projectId: 'project-1', taskId: 'task-1', name: 'Shell' },
    ]);
    vi.mocked(handleTerminalCreate).mockResolvedValueOnce({
      terminalId: 'terminal-2',
      name: 'Tests',
    });
    vi.mocked(handleTerminalSend).mockResolvedValueOnce({ ok: true });

    await expect(
      invokeTaskCreate({
        callerConversationId: callerConversation.id,
        name: 'Investigate',
        providerId: 'codex',
        initialPrompt: 'Start here',
      })
    ).resolves.toEqual({
      taskId: 'task-2',
      taskName: 'Investigate',
      taskBranch: 'investigate',
      projectId: 'project-1',
      conversationId: 'conversation-2',
    });

    await expect(
      invokeTerminalList({ callerConversationId: callerConversation.id })
    ).resolves.toEqual([
      { id: 'terminal-1', projectId: 'project-1', taskId: 'task-1', name: 'Shell' },
    ]);

    await expect(
      invokeTerminalCreate({
        callerConversationId: callerConversation.id,
        name: 'Tests',
        initialCommand: 'pnpm test',
      })
    ).resolves.toEqual({
      terminalId: 'terminal-2',
      name: 'Tests',
    });

    await expect(
      invokeTerminalSend({
        callerConversationId: callerConversation.id,
        terminalId: 'terminal-2',
        text: 'pnpm test',
        submit: true,
      })
    ).resolves.toEqual({ ok: true });

    expect(handleTaskCreate).toHaveBeenCalledWith(
      { conversation: callerConversation },
      {
        name: 'Investigate',
        providerId: 'codex',
        initialPrompt: 'Start here',
      }
    );
    expect(handleTerminalList).toHaveBeenCalledWith({ conversation: callerConversation });
    expect(handleTerminalCreate).toHaveBeenCalledWith(
      { conversation: callerConversation },
      { name: 'Tests', initialCommand: 'pnpm test' }
    );
    expect(handleTerminalSend).toHaveBeenCalledWith(
      { conversation: callerConversation },
      'terminal-2',
      { text: 'pnpm test', submit: true }
    );
  });

  it('reads workspace dev servers from the live mcp internal service for the caller task', async () => {
    vi.mocked(mcpInternalService.listWorkspaceDevServers).mockReturnValueOnce([
      {
        terminalId: 'terminal-1',
        url: 'http://127.0.0.1:3000',
        detectedAt: 1234,
      },
    ]);

    await expect(
      invokeWorkspaceDevServers({ callerConversationId: callerConversation.id })
    ).resolves.toEqual({
      servers: [
        {
          terminalId: 'terminal-1',
          url: 'http://127.0.0.1:3000',
          detectedAt: 1234,
        },
      ],
    });

    expect(mcpInternalService.listWorkspaceDevServers).toHaveBeenCalledWith(
      callerConversation.taskId
    );
  });

  it('rejects invalid direct invoke inputs and missing callers', async () => {
    await expect(
      invokeTaskCreate({
        callerConversationId: callerConversation.id,
        name: 'Invalid create',
        initialPrompt: 'missing provider',
      })
    ).rejects.toThrow('initialPrompt requires providerId');
    expect(getConversationById).not.toHaveBeenCalled();

    vi.mocked(getConversationById).mockResolvedValueOnce(null);
    await expect(
      invokeProjectList({ callerConversationId: 'missing-conversation' })
    ).rejects.toThrow('caller conversation not found: missing-conversation');
  });
});
