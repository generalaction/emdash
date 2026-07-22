import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRepositoryService } from '@main/core/git/repository/service';

const mocks = vi.hoisted(() => ({
  getAcpRuntimeClient: vi.fn(),
  startSession: vi.fn(),
  getPlugin: vi.fn(),
  isValidProviderId: vi.fn(),
  listPlugins: vi.fn(),
  createConversation: vi.fn(),
  openProject: vi.fn(),
  getProject: vi.fn(),
  settingsGet: vi.fn(),
  generateRandom: vi.fn(),
  generateTaskName: vi.fn(),
  prepareCreateTask: vi.fn(),
  commitCreateTask: vi.fn(),
  finalizeCreateTask: vi.fn(),
  notifyTaskCreated: vi.fn(),
  launch: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@main/core/acp/controller', () => ({
  getAcpRuntimeClient: mocks.getAcpRuntimeClient,
}));

vi.mock('@main/core/agents/plugin-registry', () => ({
  getPlugin: mocks.getPlugin,
  isValidProviderId: mocks.isValidProviderId,
  listPlugins: mocks.listPlugins,
}));

vi.mock('@main/core/conversations/createConversation', () => ({
  createConversation: mocks.createConversation,
}));

vi.mock('@main/core/projects/operations/openProject', () => ({
  openProject: mocks.openProject,
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/settings/settings-registry', () => ({
  DEFAULT_AGENT_ID: 'claude',
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: mocks.settingsGet },
}));

vi.mock('@main/core/tasks/name-generation/generateTaskName', () => ({
  generateRandom: mocks.generateRandom,
  generateTaskName: mocks.generateTaskName,
}));

vi.mock('@main/core/tasks/operations/createTask', () => ({
  prepareCreateTask: mocks.prepareCreateTask,
  commitCreateTask: mocks.commitCreateTask,
  finalizeCreateTask: mocks.finalizeCreateTask,
}));

vi.mock('@main/core/tasks/task-service', () => ({
  taskService: { notifyTaskCreated: mocks.notifyTaskCreated, launch: mocks.launch },
}));

vi.mock('@main/db/client', () => ({
  db: { transaction: mocks.transaction },
}));

const { createTaskFromPrompt, isValidBranchName, resolveFromBranch, resolveModel } =
  await import('./create-task-from-prompt');

const ORIGIN = { name: 'origin', url: 'git@example.com:owner/repo.git' };
const UPSTREAM = { name: 'upstream', url: 'git@example.com:upstream/repo.git' };

function fakeGitRepository(
  overrides: {
    defaultBranch?: string;
    remotes?: { name: string; url: string }[];
    baseRemote?: string;
    branches?: unknown[];
  } = {}
): GitRepositoryService {
  const branches = overrides.branches ?? [
    { type: 'local', branch: 'main' },
    { type: 'remote', branch: 'main', remote: ORIGIN },
    { type: 'local', branch: 'local-only' },
    { type: 'remote', branch: 'remote-only', remote: ORIGIN },
    { type: 'remote', branch: 'upstream-only', remote: UPSTREAM },
  ];
  return {
    getDefaultBranch: async () => overrides.defaultBranch ?? 'main',
    getRemotes: async () => overrides.remotes ?? [ORIGIN, UPSTREAM],
    getBaseRemote: async () => overrides.baseRemote ?? 'origin',
    getSnapshot: async () => ({ refs: { value: { branches } } }),
  } as unknown as GitRepositoryService;
}

const SELECTABLE_MODELS = {
  kind: 'selectable',
  modelOptions: { 'claude-fable-5': { name: 'Fable' }, 'claude-sonnet-5': { name: 'Sonnet' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPlugin.mockReturnValue({
    capabilities: { models: SELECTABLE_MODELS, acp: { kind: 'supported' } },
  });
  mocks.isValidProviderId.mockImplementation((id: string) => id === 'claude' || id === 'codex');
  mocks.listPlugins.mockReturnValue([
    { metadata: { id: 'claude' } },
    { metadata: { id: 'codex' } },
  ]);
});

describe('resolveModel', () => {
  it('accepts an omitted or blank model', () => {
    expect(resolveModel('claude', undefined)).toEqual(ok(undefined));
    expect(resolveModel('claude', '   ')).toEqual(ok(undefined));
  });

  it('accepts a known model id, trimmed', () => {
    expect(resolveModel('claude', ' claude-sonnet-5 ')).toEqual(ok('claude-sonnet-5'));
  });

  it('rejects providers without selectable models', () => {
    mocks.getPlugin.mockReturnValue({ capabilities: { models: { kind: 'none' } } });
    const result = resolveModel('claude', 'claude-sonnet-5');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('does not support model selection');
  });

  it('rejects an unknown model and lists valid ids', () => {
    const result = resolveModel('claude', 'gpt-4');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Unknown model "gpt-4"');
      expect(result.error).toContain('claude-fable-5, claude-sonnet-5');
    }
  });

  it('rejects prototype-chain property names as model ids', () => {
    expect(resolveModel('claude', 'toString').success).toBe(false);
    expect(resolveModel('claude', 'constructor').success).toBe(false);
  });
});

describe('resolveFromBranch', () => {
  it('defaults to the default branch on the base remote', async () => {
    const result = await resolveFromBranch(fakeGitRepository(), undefined);
    expect(result).toEqual(ok({ type: 'remote', branch: 'main', remote: ORIGIN }));
  });

  it('falls back to a local default-branch ref when the base remote is missing', async () => {
    const result = await resolveFromBranch(fakeGitRepository({ remotes: [] }), undefined);
    expect(result).toEqual(ok({ type: 'local', branch: 'main' }));
  });

  it('treats a blank request like the default branch', async () => {
    const result = await resolveFromBranch(fakeGitRepository(), '   ');
    expect(result).toEqual(ok({ type: 'remote', branch: 'main', remote: ORIGIN }));
  });

  it('resolves a local-only branch to a local ref', async () => {
    const result = await resolveFromBranch(fakeGitRepository(), 'local-only');
    expect(result).toEqual(ok({ type: 'local', branch: 'local-only' }));
  });

  it('resolves a branch known only on the base remote to a remote ref', async () => {
    const result = await resolveFromBranch(fakeGitRepository(), 'remote-only');
    expect(result).toEqual(ok({ type: 'remote', branch: 'remote-only', remote: ORIGIN }));
  });

  it('falls back to any remote when the branch is not on the base remote', async () => {
    const result = await resolveFromBranch(fakeGitRepository(), 'upstream-only');
    expect(result).toEqual(ok({ type: 'remote', branch: 'upstream-only', remote: UPSTREAM }));
  });

  it('rejects an unknown branch', async () => {
    const result = await resolveFromBranch(fakeGitRepository(), 'nope');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Branch "nope" not found');
      expect(result.error).not.toContain('remote prefix');
    }
  });

  it('hints when the request looks remote-prefixed', async () => {
    const result = await resolveFromBranch(fakeGitRepository(), 'origin/main');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('without a remote prefix');
  });
});

describe('isValidBranchName', () => {
  it.each(['feat/mcp', 'my-branch', 'a', 'v1.2.3', 'chung/feat-mcp'])('accepts %s', (name) =>
    expect(isValidBranchName(name)).toBe(true)
  );

  it.each([
    '',
    '@',
    'bad name',
    '-leading-dash',
    '/leading-slash',
    'trailing-slash/',
    'trailing-dot.',
    '.hidden',
    'double//slash',
    'dots..dots',
    'at@{brace',
    'ref.lock',
    'seg/.hidden',
    'colon:name',
    'star*name',
    'question?name',
    'tilde~name',
    'caret^name',
    'back\\slash',
    'bracket[name',
  ])('rejects %j', (name) => expect(isValidBranchName(name)).toBe(false));
});

describe('createTaskFromPrompt', () => {
  const INPUT = { projectId: 'p1', prompt: 'do the thing', provider: 'claude' };

  beforeEach(() => {
    mocks.getProject.mockReturnValue({ gitRepository: fakeGitRepository() });
    mocks.generateRandom.mockReturnValue('breezy-otter');
    mocks.generateTaskName.mockReturnValue('breezy-otter-branch');
    mocks.prepareCreateTask.mockResolvedValue(ok({ params: true }));
    mocks.transaction.mockImplementation((fn: (tx: unknown) => void) => fn({}));
    mocks.commitCreateTask.mockReturnValue({ taskRow: { id: 'row' }, convRow: undefined });
    mocks.finalizeCreateTask.mockReturnValue({ task: { id: 'row' } });
    mocks.launch.mockResolvedValue(ok({ workspaceId: 'ws1', path: '/tmp/worktree' }));
    mocks.createConversation.mockResolvedValue(undefined);
    mocks.startSession.mockResolvedValue(ok(undefined));
    mocks.getAcpRuntimeClient.mockResolvedValue({ startSession: mocks.startSession });
    mocks.settingsGet.mockResolvedValue('claude');
  });

  it('creates an idle task without a conversation when no prompt is given', async () => {
    const result = await createTaskFromPrompt({ projectId: 'p1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        conversationType: 'none',
        provider: null,
        model: null,
        workspacePath: '/tmp/worktree',
      });
    }
    // The task and worktree are still created, but no agent is started.
    expect(mocks.prepareCreateTask).toHaveBeenCalled();
    expect(mocks.launch).toHaveBeenCalled();
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only prompt as no prompt', async () => {
    const result = await createTaskFromPrompt({ ...INPUT, prompt: '  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.conversationType).toBe('none');
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it('does not resolve or validate a provider for a promptless task', async () => {
    const result = await createTaskFromPrompt({ projectId: 'p1', provider: 'not-a-provider' });
    // Provider is ignored when there is no prompt, so this does not error.
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.provider).toBe(null);
  });

  it('rejects an unknown project after trying to open it', async () => {
    mocks.getProject.mockReturnValue(undefined);
    mocks.openProject.mockResolvedValue(err({ type: 'not-found' }));
    const result = await createTaskFromPrompt(INPUT);
    expect(result).toEqual(err('Project not found: p1'));
  });

  it('rejects an unknown provider and lists valid ids', async () => {
    const result = await createTaskFromPrompt({ ...INPUT, provider: 'not-a-provider' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('claude, codex');
  });

  it('rejects an invalid explicit branch name before creating anything', async () => {
    const result = await createTaskFromPrompt({ ...INPUT, branchName: 'bad name' });
    expect(result).toEqual(err('Invalid branch name: "bad name"'));
    expect(mocks.prepareCreateTask).not.toHaveBeenCalled();
  });

  it('rejects a task name that derives an unusable branch name', async () => {
    mocks.generateTaskName.mockReturnValue('');
    const result = await createTaskFromPrompt({ ...INPUT, name: '!!!' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('pass branchName explicitly');
    expect(mocks.prepareCreateTask).not.toHaveBeenCalled();
  });

  it('falls back to the default agent when no provider is given', async () => {
    mocks.settingsGet.mockResolvedValue('codex');
    const result = await createTaskFromPrompt({ projectId: 'p1', prompt: 'go' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.provider).toBe('codex');
  });

  it('starts a terminal (pty) conversation by default', async () => {
    const result = await createTaskFromPrompt(INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.conversationType).toBe('pty');
    expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pty', initialPrompt: 'do the thing' })
    );
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it('starts an acp conversation when chatUi is set and the provider supports it', async () => {
    const result = await createTaskFromPrompt({ ...INPUT, chatUi: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.conversationType).toBe('acp');
    expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'acp', initialQueue: [{ text: 'do the thing' }] })
    );
    expect(mocks.startSession).toHaveBeenCalledWith({
      input: expect.objectContaining({ providerId: 'claude', cwd: '/tmp/worktree', model: null }),
    });
  });

  it('falls back to pty when chatUi is set but the provider lacks acp support', async () => {
    mocks.getPlugin.mockReturnValue({
      capabilities: { models: SELECTABLE_MODELS, acp: { kind: 'unsupported' } },
    });
    const result = await createTaskFromPrompt({ ...INPUT, chatUi: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.conversationType).toBe('pty');
  });

  it('passes a validated model through to the conversation', async () => {
    const result = await createTaskFromPrompt({ ...INPUT, model: 'claude-sonnet-5' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.model).toBe('claude-sonnet-5');
    expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5' })
    );
  });

  it('reports a provisioning failure with the task id', async () => {
    mocks.launch.mockResolvedValue(
      err({ type: 'setup-failed', message: 'setup script exploded', stepErrorType: 'script' })
    );
    const result = await createTaskFromPrompt(INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('workspace provisioning failed');
      expect(result.error).toContain('setup script exploded');
    }
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it('returns a structured error when the pty conversation fails to spawn', async () => {
    mocks.createConversation.mockRejectedValue(new Error('spawn ENOENT'));
    const result = await createTaskFromPrompt(INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('agent session failed to start');
      expect(result.error).toContain('spawn ENOENT');
    }
  });

  it('returns a structured error when the acp session fails to start', async () => {
    mocks.startSession.mockResolvedValue(err({ type: 'spawn-failed', message: 'no binary' }));
    const result = await createTaskFromPrompt({ ...INPUT, chatUi: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('no binary');
  });

  it('returns the created task details on success', async () => {
    const result = await createTaskFromPrompt({ ...INPUT, name: 'My Task', branchName: 'my-br' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      taskId: expect.any(String),
      taskName: 'My Task',
      branchName: 'my-br',
      provider: 'claude',
      model: null,
      conversationType: 'pty',
      workspacePath: '/tmp/worktree',
    });
    expect(mocks.notifyTaskCreated).toHaveBeenCalled();
  });

  it('builds the workspace config from the new-worktree preset without pushing', async () => {
    await createTaskFromPrompt(INPUT);
    const params = mocks.prepareCreateTask.mock.calls[0]?.[0];
    expect(params.workspaceConfig).toEqual({
      version: '2',
      git: {
        kind: 'create-branch',
        fromBranch: { type: 'remote', branch: 'main', remote: ORIGIN },
        branchName: 'breezy-otter-branch',
        pushBranch: false,
      },
      workspace: { kind: 'new-worktree' },
    });
  });
});
