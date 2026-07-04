import type { Project, User, WorkItem, WorkItemSearchItem } from '@makeplane/plane-node-sdk';
import {
  PLANE_CLOUD_API_BASE_URL,
  type PlaneCredentials,
  type PlaneWorkItemDetail,
} from '../../../integrations/impl/plane/types';
import type { IssueData, IssueDetail } from '../../types';

/**
 * Listed work items reference state and assignees as bare UUIDs, so only
 * fields that are human-readable without expansion are mapped.
 */
export function toIssueData(
  item: WorkItem,
  credentials: PlaneCredentials,
  project: Project
): IssueData {
  const identifier = toIdentifier(project.identifier, item.sequence_id, item.id);

  return {
    ...toBaseIssueData(identifier, item, credentials),
    project: project.name ?? project.identifier,
  };
}

export function toSearchIssueData(
  item: WorkItemSearchItem,
  credentials: PlaneCredentials
): IssueData {
  const identifier = toIdentifier(item.project__identifier, item.sequence_id, item.id);

  return {
    identifier,
    title: item.name,
    url: buildWorkItemUrl(credentials, identifier),
    project: item.project__identifier,
  };
}

export function toIssueDetail(
  item: PlaneWorkItemDetail,
  credentials: PlaneCredentials,
  context: string | undefined
): IssueDetail {
  const identifier = toIdentifier(item.project.identifier, item.sequence_id, item.id);

  return {
    ...toBaseIssueData(identifier, item, credentials),
    status: item.state.name || item.state.group,
    assignees: toAssigneeNames(item.assignees),
    project: item.project.name ?? item.project.identifier,
    context,
  };
}

type BaseWorkItemFields = Pick<
  WorkItem,
  'name' | 'description_stripped' | 'description_html' | 'updated_at' | 'created_at'
>;

function toBaseIssueData(
  identifier: string,
  item: BaseWorkItemFields,
  credentials: PlaneCredentials
): IssueData {
  return {
    identifier,
    title: item.name ?? identifier,
    url: buildWorkItemUrl(credentials, identifier),
    description: item.description_stripped ?? stripHtml(item.description_html) ?? undefined,
    updatedAt: formatPlaneDate(item.updated_at ?? item.created_at),
  };
}

function toAssigneeNames(assignees: User[]): string[] | undefined {
  const names = assignees
    .map(
      (assignee) =>
        assignee.display_name?.trim() ||
        [assignee.first_name?.trim(), assignee.last_name?.trim()].filter(Boolean).join(' ') ||
        assignee.email?.trim()
    )
    .filter((name): name is string => Boolean(name));

  return names.length ? names : undefined;
}

function toIdentifier(
  projectIdentifier: string | undefined,
  sequenceId: number | string | undefined,
  fallback: string
): string {
  const sequence = sequenceId == null ? undefined : String(sequenceId);
  return projectIdentifier && sequence
    ? `${projectIdentifier}-${sequence}`
    : (sequence ?? fallback);
}

export function stripHtml(value: string | null | undefined): string | null {
  const stripped = value
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || null;
}

function buildWorkItemUrl(credentials: PlaneCredentials, identifier: string): string | undefined {
  if (!identifier.includes('-')) return undefined;

  const apiBase = new URL(credentials.apiBaseUrl);
  const basePath = apiBase.pathname.replace(/\/+$/, '');
  const browserBase =
    credentials.apiBaseUrl === PLANE_CLOUD_API_BASE_URL
      ? 'https://app.plane.so'
      : `${apiBase.protocol}//${apiBase.host}${basePath}`;

  return `${browserBase}/${encodeURIComponent(credentials.workspaceSlug)}/browse/${encodeURIComponent(identifier)}`;
}

/** The SDK types timestamps as Date but does not revive them from JSON. */
function formatPlaneDate(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}
