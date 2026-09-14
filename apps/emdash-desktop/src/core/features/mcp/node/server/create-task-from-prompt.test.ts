import type { GitBranch } from '@emdash/core/runtimes/git/api';
import { ok } from '@emdash/shared';
import { cell } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
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

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

function project(): ProjectProvider {
  const main = { type: 'local', ref: 'refs/heads/main', oid: 'a' } as GitBranch;
  return {
    projectId: 'project-1',
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
  });
});
