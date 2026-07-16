import type { ProjectSummary, ResourceCategory, ResourceKind, TaskSummary } from './client/types';

export const resourceCategories: Array<{
  id: ResourceCategory;
  label: string;
}> = [
  { id: 'conversations', label: 'Chats' },
  { id: 'terminals', label: 'Terminals' },
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
  { id: 'browser', label: 'Browser' },
];

export function categoryForKind(kind: ResourceKind): ResourceCategory {
  if (kind === 'acp' || kind === 'agent-terminal') return 'conversations';
  if (kind === 'terminal') return 'terminals';
  if (kind === 'file') return 'files';
  if (kind === 'diff') return 'changes';
  return 'browser';
}

export function tasksForProject(tasks: TaskSummary[], projectId: string): TaskSummary[] {
  return tasks.filter((task) => task.projectId === projectId);
}

export function isTaskSelectable(task: Pick<TaskSummary, 'status'>): boolean {
  return task.status === 'ready' || task.status === 'dormant';
}

export function projectForTask(
  projects: ProjectSummary[],
  task: TaskSummary
): ProjectSummary | undefined {
  return projects.find((project) => project.id === task.projectId);
}

export function normalizePairingCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8);
}

export function validPairingCode(value: string): boolean {
  return /^\d{8}$/.test(value);
}

export function validateResourceTitle(value: string): string | null {
  const title = value.trim();
  if (title.length === 0) return 'Enter a name.';
  if (title.length > 100) return 'Names can be at most 100 characters.';
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
