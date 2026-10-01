import { LOCAL_HOST_REF, hostRef, type HostRef } from '@emdash/core/primitives/host/api';
import type { GitBranch } from '@emdash/core/runtimes/git/api';
import { ok } from '@emdash/shared';
import { cell } from '@emdash/wire/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyProviderSettings,
  type ProviderSettingsSnapshot,
} from '@core/features/conversations/api/provider-settings';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import type { CreateTaskParams } from '@core/primitives/tasks/api';
import { createTaskFromPrompt } from './create-task-from-prompt';
import type { McpToolDependencies } from './dependencies';

vi.mock('@core/features/projects/api/node/settings/effective-settings', () => ({
  resolveProjectEffectiveSettings: async () => ({
    baseRemote: { value: 'origin' },
    defaultBranch: { value: { branch: 'main', remote: null } },
  }),
}));

const readProviderSettings = vi.fn();

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

beforeEach(() => {
  readProviderSettings.mockReset();
  readProviderSettings.mockResolvedValue(emptyProviderSettings);
});

function project(host: HostRef = LOCAL_HOST_REF): ProjectProvider {
  const main = { type: 'local', ref: 'refs/heads/main', oid: 'a' } as GitBranch;
  return {
    projectId: 'project-1',
    host,
    repository: { path: '/repo' },
    settings: {},
    repoFacts: {},
    git: {
      repository: {
        model: {
          state: () => ({
            snapshot: async () => ({ data: { branches: [main], tags: [], remoteHeads: [] } }),
          }),
        },
      },
    },
  } as unknown as ProjectProvider;
}

/** Deps for a promptless create_task, which needs no provider or session. */
function dependencies(options: {
  pushOnCreate?: boolean;
  createTask: ReturnType<typeof vi.fn>;
}): McpToolDependencies {
  const attached = project();
  return {
    appVersion: '0.0.0',
    logger,
    projects: {
      track: () => cell({ kind: 'attached' }),
      requireAttached: () => ok(attached),
    },
    tasks: {
      createTask: options.createTask,
      provisionWorkspace: async () => ok({ path: '/worktrees/task-1' }),
    },
    appSettings: {
      get: async (key: string) =>
        key === 'project'
          ? {
              branchPrefix: '',
              appendRandomBranchSuffix: false,
              ...(options.pushOnCreate !== undefined && { pushOnCreate: options.pushOnCreate }),
            }
          : {},
    },
    readProviderSettings,
    telemetry: { capture: () => {} },
    startInitialConversation: async () => ({ started: true }),
  } as unknown as McpToolDependencies;
}

async function createdWorkspaceGit(options: {
  pushOnCreate?: boolean;
}): Promise<Record<string, unknown>> {
  const createTask = vi.fn(async () => ok({}));
  const deps = dependencies({ createTask, ...options });
  const result = await createTaskFromPrompt(deps, {
    projectId: 'project-1',
    name: 'Add MCP support',
    branchName: 'feature/add-mcp',
  });
  expect(result.success).toBe(true);
  const [params] = createTask.mock.calls[0] as unknown as [CreateTaskParams];
  return params.workspaceConfig.git as unknown as Record<string, unknown>;
}

describe('createTaskFromPrompt', () => {
  it('pushes the new branch when auto-push on create is enabled', async () => {
    expect(await createdWorkspaceGit({ pushOnCreate: true })).toMatchObject({ pushBranch: true });
  });

  it('leaves the branch unpushed when auto-push on create is disabled', async () => {
    expect(await createdWorkspaceGit({ pushOnCreate: false })).toMatchObject({ pushBranch: false });
  });

  it('pushes when the setting is missing, matching the new-task modal default', async () => {
    expect(await createdWorkspaceGit({})).toMatchObject({ pushBranch: true });
    expect(readProviderSettings).not.toHaveBeenCalled();
  });

  it('uses the saved terminal auto-approve preference on the project host', async () => {
    readProviderSettings.mockResolvedValue({
      ...emptyProviderSettings,
      pty: { version: '1', autoApprove: true },
    });
    const createTask = vi.fn(async () => ok({}));
    const deps = dependencies({ createTask });
    const attached = project(hostRef('remote', 'remote-1'));
    deps.projects.requireAttached = () => ok(attached);
    const result = await createTaskFromPrompt(deps, {
      projectId: 'project-1',
      prompt: 'Fix the bug',
      provider: 'claude',
      branchName: 'feature/fix',
    });
    expect(result).toMatchObject({ success: true, data: { autoApprove: true } });
    expect(readProviderSettings).toHaveBeenCalledWith({
      host: 'remote:remote-1',
      providerId: 'claude',
    });
    const [params] = createTask.mock.calls[0] as unknown as [CreateTaskParams];
    expect(params.taskConfig.initialConversation).toMatchObject({
      type: 'pty',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
    });
  });

  it('lets an explicit terminal auto-approve override the saved preference', async () => {
    readProviderSettings.mockResolvedValue({
      ...emptyProviderSettings,
      pty: { version: '1', autoApprove: true },
    });
    const result = await createTaskFromPrompt(
      dependencies({ createTask: vi.fn(async () => ok({})) }),
      {
        projectId: 'project-1',
        prompt: 'Fix the bug',
        provider: 'claude',
        autoApprove: false,
        branchName: 'feature/fix',
      }
    );
    expect(result).toMatchObject({ success: true, data: { autoApprove: false } });
  });

  it('carries native ACP options without applying terminal auto-approve', async () => {
    readProviderSettings.mockResolvedValue({
      ...emptyProviderSettings,
      acp: { version: '1', options: { 'native-model': 'saved-model', mode: 'ask' } },
      pty: { version: '1', autoApprove: true },
    });
    const createTask = vi.fn(async () => ok({}));
    const result = await createTaskFromPrompt(dependencies({ createTask }), {
      projectId: 'project-1',
      prompt: 'Fix the bug',
      provider: 'claude',
      chatUi: true,
      autoApprove: true,
      branchName: 'feature/fix',
    });
    expect(result).toMatchObject({
      success: true,
      data: { conversationType: 'acp', autoApprove: false },
    });
    const [params] = createTask.mock.calls[0] as unknown as [CreateTaskParams];
    expect(params.taskConfig.initialConversation).toMatchObject({
      options: { 'native-model': 'saved-model', mode: 'ask' },
      initialQueue: [{ text: 'Fix the bug' }],
    });
    expect(params.taskConfig.initialConversation).not.toHaveProperty('autoApprove');
    expect(params.taskConfig.initialConversation).not.toHaveProperty('model');
  });

  it('maps an ACP model override to the discovered provider option id', async () => {
    const settings: ProviderSettingsSnapshot = {
      ...emptyProviderSettings,
      catalogs: [
        [
          {
            id: 'native-model',
            category: 'model',
            type: 'select',
            name: 'Model',
            currentValue: 'default',
            options: [{ name: 'Sonnet', value: 'sonnet' }],
          },
        ],
      ],
    };
    readProviderSettings.mockResolvedValue(settings);
    const createTask = vi.fn(async () => ok({}));
    const result = await createTaskFromPrompt(dependencies({ createTask }), {
      projectId: 'project-1',
      prompt: 'Fix the bug',
      provider: 'claude',
      chatUi: true,
      model: 'sonnet',
      branchName: 'feature/fix',
    });
    expect(result.success).toBe(true);
    const [params] = createTask.mock.calls[0] as unknown as [CreateTaskParams];
    expect(params.taskConfig.initialConversation?.options).toEqual({ 'native-model': 'sonnet' });
  });

  it('rejects an ACP model override before creating a task when its option id is unknown', async () => {
    const createTask = vi.fn(async () => ok({}));
    const result = await createTaskFromPrompt(dependencies({ createTask }), {
      projectId: 'project-1',
      prompt: 'Fix the bug',
      provider: 'claude',
      chatUi: true,
      model: 'sonnet',
      branchName: 'feature/fix',
    });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('not discovered'),
    });
    expect(createTask).not.toHaveBeenCalled();
  });
});
