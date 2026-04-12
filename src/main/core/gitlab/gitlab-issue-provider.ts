import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import {
  clampIssueLimit,
  normalizeSearchTerm,
  requireProjectPath,
} from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { gitLabConnectionService, toGitLabErrorMessage } from './gitlab-connection-service';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toIssue(raw: unknown, projectName: string | null): Issue | null {
  const item = asRecord(raw);
  if (!item) return null;

  const iid = readNumber(item.iid);
  if (iid === null) return null;

  const title = readString(item.title) ?? '';
  const description = readString(item.description) ?? undefined;
  const webUrl = readString(item.web_url) ?? readString(item.webUrl) ?? '';
  const state = readString(item.state) ?? undefined;
  const updatedAt = readString(item.updated_at) ?? readString(item.updatedAt) ?? undefined;

  const assigneeRecord =
    asRecord(item.assignee) ?? (Array.isArray(item.assignees) ? asRecord(item.assignees[0]) : null);
  const assigneeName = readString(assigneeRecord?.name) ?? readString(assigneeRecord?.username);
  const assigneeUsername =
    readString(assigneeRecord?.username) ?? readString(assigneeRecord?.name) ?? undefined;
  const assignees =
    assigneeName || assigneeUsername ? [assigneeName ?? assigneeUsername ?? ''] : undefined;

  return {
    provider: 'gitlab',
    identifier: `#${iid}`,
    title,
    url: webUrl,
    description,
    status: state,
    assignees,
    project: projectName ?? undefined,
    updatedAt,
    fetchedAt: new Date().toISOString(),
  };
}

async function listIssues(projectPath: string, limit: number): Promise<IssueListResult> {
  const perPage = clampIssueLimit(limit, 50, 100);

  try {
    const { client, projectId, projectName } =
      await gitLabConnectionService.resolveProject(projectPath);

    const issues = (await client.Issues.all({
      projectId,
      state: 'opened',
      orderBy: 'updated_at',
      sort: 'desc',
      perPage,
      maxPages: 1,
    })) as unknown[];

    return {
      success: true,
      issues: (issues ?? [])
        .map((issue) => toIssue(issue, projectName))
        .filter((issue): issue is Issue => issue !== null),
    };
  } catch (error) {
    return {
      success: false,
      error: toGitLabErrorMessage(error, 'Failed to fetch GitLab issues.'),
    };
  }
}

async function searchIssues(
  projectPath: string,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  const perPage = clampIssueLimit(limit, 20, 100);

  try {
    const { client, projectId, projectName } =
      await gitLabConnectionService.resolveProject(projectPath);

    const issues = (await client.Issues.all({
      projectId,
      state: 'opened',
      search: term,
      in: 'title,description',
      orderBy: 'updated_at',
      sort: 'desc',
      perPage,
      maxPages: 1,
    })) as unknown[];

    return {
      success: true,
      issues: (issues ?? [])
        .map((issue) => toIssue(issue, projectName))
        .filter((issue): issue is Issue => issue !== null),
    };
  } catch (error) {
    return {
      success: false,
      error: toGitLabErrorMessage(error, 'Failed to search GitLab issues.'),
    };
  }
}

export const gitlabIssueProvider: IssueProvider = {
  type: 'gitlab',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.gitlab,

  checkConnection: () => gitLabConnectionService.checkConnection(),

  listIssues: async (opts) => {
    const projectPath = requireProjectPath(opts.projectPath);
    if (!projectPath) {
      return { success: false, error: 'Project path is required.' };
    }

    return listIssues(projectPath, opts.limit ?? 50);
  },

  searchIssues: async (opts) => {
    const projectPath = requireProjectPath(opts.projectPath);
    if (!projectPath) {
      return { success: false, error: 'Project path is required.' };
    }

    return searchIssues(projectPath, opts.searchTerm, opts.limit ?? 20);
  },
};
