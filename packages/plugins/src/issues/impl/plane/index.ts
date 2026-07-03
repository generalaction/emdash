import { err, ok } from '@emdash/shared';
import {
  getPlaneAuth,
  isRecord,
  PLANE_CLOUD_API_BASE_URL,
  readString,
  toPlaneErrorMessage,
  type PlaneProject,
  type PlaneWorkItem,
} from '../../../integrations/impl/plane/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueDetail } from '../../types';

const SEARCH_MIN_LENGTH = 2;
const MAX_PROJECTS_FOR_LIST = 10;
const WORK_ITEM_PAGE_LIMIT = 50;

function toIssue(
  item: PlaneWorkItem,
  apiBaseUrl: string,
  workspaceSlug: string,
  projectFallback?: PlaneProject
): IssueData {
  const project = readProject(item.project) ?? projectFallback ?? null;
  const projectIdentifier = project?.identifier ?? null;
  const sequenceId = item.sequence_id == null ? null : String(item.sequence_id);
  const identifier =
    projectIdentifier && sequenceId
      ? `${projectIdentifier}-${sequenceId}`
      : (sequenceId ?? item.id);
  const description = item.description_stripped ?? stripHtml(item.description_html) ?? undefined;

  return {
    identifier,
    title: item.name ?? identifier,
    url: buildWorkItemUrl(apiBaseUrl, workspaceSlug, identifier),
    description,
    status: readStateName(item.state) ?? item.priority ?? undefined,
    assignees: readAssignees(item.assignees),
    project: project?.name ?? project?.identifier ?? undefined,
    updatedAt: item.updated_at ?? item.created_at ?? undefined,
  };
}

const plugin = defineIssuesPlugin({ integrationId: 'plane' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    async listIssues(host, opts) {
      const auth = getPlaneAuth(host.credentials);
      const requestedLimit = clampIssueLimit(opts.limit, 50, 100);

      try {
        const projects = await auth.client.listProjects(auth.workspaceSlug, MAX_PROJECTS_FOR_LIST);
        const issues: IssueData[] = [];

        for (const project of projects.slice(0, MAX_PROJECTS_FOR_LIST)) {
          if (issues.length >= requestedLimit) break;

          const remaining = requestedLimit - issues.length;
          const items = await auth.client.listWorkItems(
            auth.workspaceSlug,
            project.id,
            Math.min(remaining, WORK_ITEM_PAGE_LIMIT)
          );
          issues.push(
            ...items.map((item) => toIssue(item, auth.apiBaseUrl, auth.workspaceSlug, project))
          );
        }

        return ok(issues.slice(0, requestedLimit));
      } catch (error) {
        return err(
          issueError('generic', toPlaneErrorMessage(error, 'Failed to fetch Plane work items.'))
        );
      }
    },

    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (term.length < SEARCH_MIN_LENGTH) return ok([]);

      const auth = getPlaneAuth(host.credentials);
      const requestedLimit = clampIssueLimit(opts.limit, 20, 100);

      try {
        const items = await auth.client.searchWorkItems(auth.workspaceSlug, term, requestedLimit);
        return ok(
          items
            .map((item) => toIssue(item, auth.apiBaseUrl, auth.workspaceSlug))
            .slice(0, requestedLimit)
        );
      } catch (error) {
        host.log.error('[Plane] searchWorkItems error', { error });
        return err(
          issueError('generic', toPlaneErrorMessage(error, 'Failed to search Plane work items.'))
        );
      }
    },

    async getIssue(host, opts) {
      const term = normalizeSearchTerm(opts.identifier);
      if (!term) return err(issueError('invalid_input', 'Plane work item identifier is required.'));

      const auth = getPlaneAuth(host.credentials);
      try {
        const item = await auth.client.getWorkItemByIdentifier(auth.workspaceSlug, term);
        return ok({
          ...toIssue(item, auth.apiBaseUrl, auth.workspaceSlug),
          context: formatPlaneContext(item),
        } satisfies IssueDetail);
      } catch (error) {
        return err(
          issueError(
            'generic',
            toPlaneErrorMessage(error, 'Failed to fetch Plane work item context.')
          )
        );
      }
    },
  },
});

function readProject(value: unknown): PlaneProject | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const identifier = readString(value.identifier);
  const name = readString(value.name);
  if (!id && !identifier && !name) return null;
  return {
    id: id ?? identifier ?? name ?? '',
    identifier: identifier ?? undefined,
    name: name ?? undefined,
  };
}

function readStateName(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  return readString(value.name) ?? readString(value.group) ?? undefined;
}

function readAssignees(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const assignees = value
    .map((assignee) => {
      if (typeof assignee === 'string') return assignee;
      if (!isRecord(assignee)) return null;
      return (
        readString(assignee.display_name) ??
        readString(assignee.name) ??
        readString(assignee.email) ??
        null
      );
    })
    .filter((assignee): assignee is string => !!assignee);
  return assignees.length > 0 ? assignees : undefined;
}

function stripHtml(value: string | null | undefined): string | null {
  const stripped = value
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || null;
}

function buildWorkItemUrl(apiBaseUrl: string, workspaceSlug: string, identifier: string): string {
  if (!identifier.includes('-')) return '';

  const apiBase = new URL(apiBaseUrl);
  const basePath = apiBase.pathname.replace(/\/+$/, '');
  const browserBase =
    apiBaseUrl === PLANE_CLOUD_API_BASE_URL
      ? 'https://app.plane.so'
      : `${apiBase.protocol}//${apiBase.host}${basePath}`;

  return `${browserBase}/${encodeURIComponent(workspaceSlug)}/browse/${encodeURIComponent(identifier)}`;
}

function formatPlaneContext(item: PlaneWorkItem): string {
  const lines: string[] = [];
  if (item.priority) lines.push(`Priority: ${item.priority}`);

  const description = item.description_stripped ?? stripHtml(item.description_html);
  if (description) {
    lines.push('');
    lines.push(description);
  }

  return lines.join('\n');
}
