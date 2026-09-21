import type { ClickUpTask } from '../../../integrations/impl/clickup/types';
import type { IssueData, IssueDetail } from '../../types';

export function toIssueData(task: ClickUpTask): IssueData {
  const identifier = task.custom_id || task.id;
  const timestamp = task.date_updated ? Number(task.date_updated) : NaN;
  const date = new Date(timestamp);
  return {
    identifier,
    title: task.name,
    url: `https://app.clickup.com/t/${encodeURIComponent(task.id)}`,
    description: task.markdown_description || task.description || task.text_content || undefined,
    status: task.status?.status,
    assignees: task.assignees?.map((user) => user.username || user.email || String(user.id)),
    project:
      [task.folder?.hidden ? undefined : task.folder?.name, task.list?.name]
        .filter(Boolean)
        .join(' / ') || undefined,
    updatedAt: Number.isNaN(date.getTime()) ? undefined : date.toISOString(),
    branchName: `${identifier}-${task.name}`,
  };
}

export function toIssueDetail(task: ClickUpTask): IssueDetail {
  const issue = toIssueData(task);
  // The host flattens the description summary. Keep the original Markdown in
  // context as well so lists and code blocks reach the agent intact.
  const context: string[] = issue.description ? ['## Description', '', issue.description, ''] : [];
  if (task.priority) context.push(`Priority: ${task.priority.priority}`);
  if (task.parent)
    context.push(`Parent: https://app.clickup.com/t/${encodeURIComponent(task.parent)}`);
  for (const checklist of task.checklists ?? []) {
    context.push('', `### ${checklist.name}`);
    for (const item of checklist.items)
      context.push(`- [${item.resolved ? 'x' : ' '}] ${item.name}`);
  }
  if (task.subtasks?.length) {
    context.push('', '### Subtasks');
    for (const subtask of task.subtasks) {
      context.push(
        `- ${subtask.custom_id || subtask.id}: ${subtask.name} — https://app.clickup.com/t/${encodeURIComponent(subtask.id)}`
      );
    }
  }
  return { ...issue, context: context.length ? context.join('\n') : undefined };
}
