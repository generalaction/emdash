import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../renderer/types/chat';
import type { Project } from '../../renderer/types/app';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const saveTaskMock = vi.fn().mockResolvedValue(undefined);
const getOrCreateDefaultConversationMock = vi.fn().mockResolvedValue(null);

vi.mock('../../renderer/lib/rpc', () => ({
  rpc: {
    db: {
      saveTask: saveTaskMock,
      getOrCreateDefaultConversation: getOrCreateDefaultConversationMock,
    },
  },
}));

vi.mock('../../renderer/lib/telemetryClient', () => ({
  captureTelemetry: vi.fn(),
}));

vi.mock('../../renderer/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseProject: Project = {
  id: 'proj-1',
  name: 'test-project',
  path: '/tmp/test-project',
  gitInfo: { branch: 'main', baseRef: 'main' },
  tasks: [],
} as unknown as Project;

function makeParams(agentRuns: AgentRun[]) {
  return {
    project: baseProject,
    taskName: 'test-task',
    agentRuns,
    linkedLinearIssue: null,
    linkedGithubIssue: null,
    linkedJiraIssue: null,
    linkedPlainThread: null,
    linkedGitlabIssue: null,
    linkedForgejoIssue: null,
    autoApprove: false,
    useWorktree: false, // skip worktree API calls
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('taskCreationService — agentModel in metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      lifecycleSetup: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  it('stores agentModel in task metadata when a model is selected', async () => {
    const { createTask } = await import('../../renderer/lib/taskCreationService');

    await createTask(makeParams([{ agent: 'claude', runs: 1, model: 'claude-opus-4-6' }]));

    expect(saveTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ agentModel: 'claude-opus-4-6' }),
      })
    );
  });

  it('stores agentModel for 1M-context model', async () => {
    const { createTask } = await import('../../renderer/lib/taskCreationService');

    await createTask(makeParams([{ agent: 'claude', runs: 1, model: 'claude-sonnet-4-6[1m]' }]));

    expect(saveTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ agentModel: 'claude-sonnet-4-6[1m]' }),
      })
    );
  });

  it('metadata is null when no model and no other metadata', async () => {
    const { createTask } = await import('../../renderer/lib/taskCreationService');

    await createTask(makeParams([{ agent: 'claude', runs: 1 }]));

    expect(saveTaskMock).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }));
  });

  it('records the correct agentId for non-Claude agents', async () => {
    const { createTask } = await import('../../renderer/lib/taskCreationService');

    await createTask(makeParams([{ agent: 'codex', runs: 1, model: 'gpt-5' } as AgentRun]));

    const call = saveTaskMock.mock.calls[0]?.[0];
    expect(call?.agentId).toBe('codex');
  });
});

describe('taskCreationService — multi-agent metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = {
      lifecycleSetup: vi.fn().mockResolvedValue({ success: true }),
      worktreeCreate: vi.fn().mockResolvedValue({
        success: true,
        worktree: { id: 'wt-1', branch: 'feat', path: '/tmp/wt-1' },
      }),
      worktreeRemove: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  it('stores agentModel from first claude run in multi-agent metadata', async () => {
    const { createTask } = await import('../../renderer/lib/taskCreationService');

    // Two claude runs — total runs > 1 → multi-agent path
    await createTask(makeParams([{ agent: 'claude', runs: 2, model: 'claude-opus-4-6' }]));

    const call = saveTaskMock.mock.calls[0]?.[0];
    expect(call?.metadata?.agentModel).toBe('claude-opus-4-6');
  });
});
