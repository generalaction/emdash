import { randomUUID } from 'node:crypto';
import { err, ok } from '@emdash/shared';
import type { IssueProvider } from '@core/features/issues/api/node/issue-provider';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { resolveProjectEffectiveSettings } from '@core/features/projects/api/node/settings/effective-settings';
import type { ProjectSettingsService } from '@core/features/projects/api/node/settings/project-settings-service';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import { linkedIssueResourcesMatch } from '@core/primitives/linked-issues/api/linked-issue';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import { DEFAULT_JIRA_SYNC_JQL, type JiraSyncResult, type JiraSyncSummary } from '../api/jira-sync';

type Dependencies = {
  provider: IssueProvider;
  projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
  settings: Pick<ProjectSettingsService, 'getProjectSettingsPage'>;
  tasks: Pick<TaskService, 'getTasks' | 'createTask' | 'updateLinkedIssue'>;
  telemetry: Pick<TelemetryService, 'capture'>;
};

/** One in-flight run per Project, shared by all windows and callers. */
export function createJiraSync(dependencies: Dependencies) {
  const pending = new Map<string, Promise<JiraSyncResult>>();
  return (projectId: string): Promise<JiraSyncResult> => {
    const existing = pending.get(projectId);
    if (existing) return existing;
    const run = sync(dependencies, projectId)
      .catch((error: unknown) => err({ type: 'generic' as const, message: errorMessage(error) }))
      .finally(() => pending.delete(projectId));
    pending.set(projectId, run);
    return run;
  };
}

async function sync(deps: Dependencies, projectId: string): Promise<JiraSyncResult> {
  const settings = await deps.settings.getProjectSettingsPage(projectId);
  if (!settings.success)
    return err({ type: 'generic', message: 'Unable to load project settings.' });
  const jql = settings.data.durable.jiraSync?.jql?.trim() || DEFAULT_JIRA_SYNC_JQL;
  const listed = await deps.provider.listIssues({ projectId, jql, limit: 100 });
  if (!listed.success) return listed;
  const getContext = deps.provider.getIssueContext;
  if (!getContext) return err({ type: 'generic', message: 'Jira issue details are unavailable.' });
  const tasks = await deps.tasks.getTasks(projectId);
  const summary: JiraSyncSummary = { created: 0, refreshed: 0, skipped: 0, failures: [] };
  const seen = new Set<string>();
  for (const issue of listed.data) {
    try {
      if (!issue.identifier || !issue.url) throw new Error('Jira issue is missing its key or URL.');
      if (seen.has(issue.url)) {
        summary.skipped++;
        continue;
      }
      seen.add(issue.url);
      const existing = tasks.filter(
        (task) =>
          task.linkedIssue?.provider === 'jira' &&
          linkedIssueResourcesMatch('jira', task.linkedIssue.url, issue.url)
      );
      // Existing archived/agent tasks also count for deduplication. Never resurrect them.
      if (
        existing.length &&
        existing.every((task) => task.archivedAt || Object.keys(task.conversations).length)
      ) {
        summary.skipped++;
        continue;
      }
      const detail = await getContext({
        projectId,
        identifier: issue.identifier,
        accountId: issue.accountId,
        issueUrl: issue.url,
      });
      if (!detail.success) {
        summary.failures.push({ identifier: issue.identifier, message: detail.error.message });
        continue;
      }
      if (existing.length) {
        for (const task of existing) {
          const refreshed = await deps.tasks.updateLinkedIssue(
            task.id,
            detail.data,
            deps.telemetry,
            true
          );
          if (refreshed) summary.refreshed++;
          else summary.skipped++;
        }
      } else {
        const id = randomUUID();
        const workspaceConfig = await workspaceForIssue(deps, projectId, issue.identifier, id);
        const created = await deps.tasks.createTask({
          id,
          projectId,
          workspaceConfig,
          taskConfig: {
            version: '1',
            name: `${detail.data.identifier}: ${detail.data.title}`,
            initialStatus: 'todo',
            linkedIssue: detail.data,
          },
        });
        if (!created.success) {
          summary.failures.push({
            identifier: issue.identifier,
            message:
              'message' in created.error && created.error.message
                ? created.error.message
                : `Task creation failed (${created.error.type}).`,
          });
          continue;
        }
        tasks.push(created.data.task);
        summary.created++;
      }
    } catch (error) {
      summary.failures.push({ identifier: issue.identifier, message: errorMessage(error) });
    }
  }
  return ok(summary);
}

async function workspaceForIssue(
  deps: Dependencies,
  projectId: string,
  key: string,
  id: string
): Promise<WorkspaceConfig> {
  const attached = deps.projects.requireAttached(projectId);
  if (!attached.success)
    throw new Error('Project runtime is unavailable. Reconnect and retry sync.');
  const project = attached.data;
  if (!project.hasRepository && project.project.repositoryWorkspaceId) {
    return {
      version: '2',
      git: { kind: 'none' },
      workspace: {
        kind: 'repository-instance',
        workspaceId: project.project.repositoryWorkspaceId,
      },
    };
  }
  const settings = await resolveProjectEffectiveSettings(project);
  const branch = settings.defaultBranch.value;
  if (!branch)
    throw new Error(
      'No default branch is available. Configure a default branch in project settings.'
    );
  const remote = branch.remote
    ? (
        await project.git.repository.model.state(project.repository, 'remotes').snapshot()
      ).data.remotes.find((entry) => entry.name === branch.remote)
    : undefined;
  if (branch.remote && !remote) throw new Error('The default branch remote is unavailable.');
  return {
    version: '2',
    workspace: { kind: 'new-worktree' },
    git: {
      kind: 'create-branch',
      branchName: `jira/${key.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${id.slice(0, 8)}`,
      fromBranch: remote
        ? { type: 'remote', branch: branch.branch, remote: { name: remote.name, url: remote.url } }
        : { type: 'local', branch: branch.branch },
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Jira sync failed. Please retry.';
}
