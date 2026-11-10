import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { IssueProvider } from '@core/features/issues/api/node/issue-provider';
import type { ProjectSettingsPage } from '@core/features/projects/api/project-settings-page';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type { CreateTaskParams, Task } from '@core/primitives/tasks/api';
import { DEFAULT_JIRA_SYNC_JQL } from '../api/jira-sync';
import { createJiraSync } from './sync-jira';

vi.mock('@core/features/projects/api/node/settings/effective-settings', () => ({
  resolveProjectEffectiveSettings: vi.fn(async () => ({
    defaultBranch: { value: { remote: null, branch: 'main' } },
  })),
}));

function issue(key: string, site = 'example'): LinkedIssue {
  return {
    provider: 'jira',
    identifier: key,
    title: `Title ${key}`,
    accountId: 'account-1',
    url: `https://${site}.atlassian.net/browse/${key}`,
    description: 'Full description',
    context: '## Comments\n\nAlice: Full comment',
  };
}

function task(id: string, linkedIssue: LinkedIssue): Task {
  return {
    id,
    projectId: 'p1',
    name: linkedIssue.title,
    status: 'todo',
    createdAt: '',
    updatedAt: '',
    statusChangedAt: '',
    isPinned: false,
    prs: [],
    conversations: {},
    type: 'task',
    linkedIssue: { ...linkedIssue },
  };
}

function setup(issues = [issue('ENG-1'), issue('ENG-2')], stored: Task[] = []) {
  const provider: IssueProvider = {
    type: 'jira',
    capabilities: { requiresRepositoryUrl: false, supportsIssueContext: true },
    checkConnection: vi.fn(),
    searchIssues: vi.fn(),
    listIssues: vi.fn(async () => ok(issues)),
    getIssueContext: vi.fn(async (opts) =>
      ok(issues.find((entry) => entry.url === opts.issueUrl)!)
    ),
  };
  const settings = {
    getProjectSettingsPage: vi.fn(async () => ok({ durable: {} } as ProjectSettingsPage)),
  };
  const tasks = {
    getTasks: vi.fn(async (projectId?: string) =>
      stored.filter((entry) => entry.projectId === projectId)
    ),
    createTask: vi.fn(async (params: CreateTaskParams) => {
      const created = {
        ...task(params.id, params.taskConfig.linkedIssue!),
        name: params.taskConfig.name,
        projectId: params.projectId,
      };
      stored.push(created);
      return ok({ task: created });
    }),
    updateLinkedIssue: vi.fn(async () => true),
  };
  const dependencies = {
    provider,
    settings,
    tasks,
    telemetry: { capture: vi.fn() },
    projects: { requireAttached: vi.fn(() => ok({ hasRepository: true } as never)) },
  };
  return { ...dependencies, stored, sync: createJiraSync(dependencies) };
}

describe('assigned Jira issue sync', () => {
  it('imports complete linked issues as To Do tasks with isolated worktrees and no agent', async () => {
    const h = setup();
    expect(await h.sync('p1')).toEqual(ok({ created: 2, refreshed: 0, skipped: 0, failures: [] }));
    expect(h.provider.listIssues).toHaveBeenCalledWith({
      projectId: 'p1',
      jql: DEFAULT_JIRA_SYNC_JQL,
      limit: 100,
    });
    expect(h.tasks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskConfig: {
          version: '1',
          name: 'ENG-1: Title ENG-1',
          initialStatus: 'todo',
          linkedIssue: issue('ENG-1'),
        },
        workspaceConfig: {
          version: '2',
          workspace: { kind: 'new-worktree' },
          git: {
            kind: 'create-branch',
            branchName: expect.stringMatching(/^jira\/eng-1-/),
            fromBranch: { type: 'local', branch: 'main' },
          },
        },
      })
    );
    expect(h.provider.getIssueContext).toHaveBeenCalledWith({
      projectId: 'p1',
      identifier: 'ENG-1',
      accountId: 'account-1',
      issueUrl: issue('ENG-1').url,
    });
  });

  it('refreshes on a second run without creating duplicates, even with a different account on the same site', async () => {
    const h = setup();
    await h.sync('p1');
    h.stored[0]!.linkedIssue!.accountId = 'previous-account';
    expect(await h.sync('p1')).toEqual(ok({ created: 0, refreshed: 2, skipped: 0, failures: [] }));
    expect(h.tasks.createTask).toHaveBeenCalledTimes(2);
    expect(h.tasks.updateLinkedIssue).toHaveBeenCalledWith(
      h.stored[0]!.id,
      issue('ENG-1'),
      h.telemetry,
      true
    );
  });

  it('shares overlapping requests and releases the guard after completion', async () => {
    const h = setup();
    const first = h.sync('p1');
    expect(h.sync('p1')).toBe(first);
    await first;
    await h.sync('p1');
    expect(h.provider.listIssues).toHaveBeenCalledTimes(2);
    expect(h.tasks.createTask).toHaveBeenCalledTimes(2);
  });

  it('deduplicates repeated issues in a search response', async () => {
    const h = setup([issue('ENG-1'), issue('ENG-1')]);
    expect(await h.sync('p1')).toEqual(ok({ created: 1, refreshed: 0, skipped: 1, failures: [] }));
  });

  it('keeps identity scoped to project and Jira site', async () => {
    const h = setup([issue('ENG-1')], [task('old', issue('ENG-1', 'other-site'))]);
    await h.sync('p1');
    await h.sync('p2');
    expect(h.tasks.createTask).toHaveBeenCalledTimes(2);
    expect(h.tasks.updateLinkedIssue).not.toHaveBeenCalled();
  });

  it('leaves running, completed, and archived tasks untouched', async () => {
    const existing = [
      task('running', issue('ENG-1')),
      task('completed', issue('ENG-2')),
      task('archived', issue('ENG-3')),
    ];
    existing[0]!.conversations = { claude: 1 };
    existing[1]!.conversations = { codex: 1 };
    existing[1]!.status = 'done';
    existing[2]!.archivedAt = '2026-01-01';
    const h = setup(
      existing.map((entry) => entry.linkedIssue!),
      existing
    );
    expect(await h.sync('p1')).toEqual(ok({ created: 0, refreshed: 0, skipped: 3, failures: [] }));
    expect(h.provider.getIssueContext).not.toHaveBeenCalled();
    expect(h.tasks.updateLinkedIssue).not.toHaveBeenCalled();
    expect(h.tasks.createTask).not.toHaveBeenCalled();
  });

  it('reports skipped when the atomic refresh refuses a task that gained a conversation', async () => {
    const h = setup([issue('ENG-1')], [task('existing', issue('ENG-1'))]);
    h.tasks.updateLinkedIssue.mockResolvedValue(false);
    expect(await h.sync('p1')).toEqual(ok({ created: 0, refreshed: 0, skipped: 1, failures: [] }));
  });

  it('continues after a detail error and a task creation exception', async () => {
    const h = setup([issue('ENG-1'), issue('ENG-2'), issue('ENG-3')]);
    vi.mocked(h.provider.getIssueContext!).mockResolvedValueOnce(
      err({ type: 'not_found_or_no_access', message: 'Issue no longer accessible' })
    );
    h.tasks.createTask.mockRejectedValueOnce(new Error('Unable to create task'));
    expect(await h.sync('p1')).toEqual(
      ok({
        created: 1,
        refreshed: 0,
        skipped: 0,
        failures: [
          { identifier: 'ENG-1', message: 'Issue no longer accessible' },
          { identifier: 'ENG-2', message: 'Unable to create task' },
        ],
      })
    );
    expect(h.stored[0]?.linkedIssue?.identifier).toBe('ENG-3');
  });

  it.each(['auth_failed', 'host_unreachable'] as const)(
    'surfaces %s without writing tasks',
    async (type) => {
      const h = setup();
      const failure = err({ type, message: 'Jira request failed' });
      vi.mocked(h.provider.listIssues).mockResolvedValueOnce(failure);
      expect(await h.sync('p1')).toEqual(failure);
      expect(h.tasks.createTask).not.toHaveBeenCalled();
      expect((await h.sync('p1')).success).toBe(true);
    }
  );

  it('uses the saved project JQL override', async () => {
    const h = setup([]);
    h.settings.getProjectSettingsPage.mockResolvedValue(
      ok({ durable: { jiraSync: { jql: 'project = ENG' } } } as ProjectSettingsPage)
    );
    await h.sync('p1');
    expect(h.provider.listIssues).toHaveBeenCalledWith(
      expect.objectContaining({ jql: 'project = ENG' })
    );
  });

  it('keeps the previous snapshot on a failed refresh and still imports the next issue', async () => {
    const original = task('existing', { ...issue('ENG-1'), description: 'Saved description' });
    const h = setup([issue('ENG-1'), issue('ENG-2')], [original]);
    vi.mocked(h.provider.getIssueContext!).mockResolvedValueOnce(
      err({ type: 'host_unreachable', message: 'Unable to reach Jira' })
    );
    expect(await h.sync('p1')).toEqual(
      ok({
        created: 1,
        refreshed: 0,
        skipped: 0,
        failures: [{ identifier: 'ENG-1', message: 'Unable to reach Jira' }],
      })
    );
    expect(original.linkedIssue?.description).toBe('Saved description');
    expect(h.tasks.updateLinkedIssue).not.toHaveBeenCalled();
  });
});
