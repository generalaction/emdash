import type { AsanaTask, RawAsanaTask } from '../../../integrations/impl/asana/types';
import type { IssueData } from '../../types';

export function toAsanaTask(task: RawAsanaTask): AsanaTask | null {
  if (!task.gid) return null;

  return {
    gid: task.gid,
    name: task.name,
    notes: task.notes,
    permalinkUrl: task.permalink_url,
    completed: task.completed,
    modifiedAt: task.modified_at,
    assignee: task.assignee,
    projects: task.projects,
    memberships: task.memberships,
  };
}

export function toIssueData(task: AsanaTask): IssueData {
  const projectName =
    task.projects?.find((project) => !!project.name)?.name ??
    task.memberships?.find((membership) => !!membership.project?.name)?.project?.name;
  const sectionName = task.memberships?.find((membership) => !!membership.section?.name)?.section
    ?.name;

  return {
    identifier: task.gid,
    displayIdentifier: null,
    title: task.name ?? '',
    url: task.permalinkUrl ?? '',
    description: task.notes?.trim() || undefined,
    status: sectionName ?? (task.completed ? 'Completed' : undefined),
    assignees: task.assignee?.name ? [task.assignee.name] : undefined,
    project: projectName,
    updatedAt: task.modifiedAt,
  };
}
