import type { Project, Task } from '../../types/app';

export function getCurrentBranch(selectedProject: Project | null, activeTask: Task | null): string {
  return activeTask?.branch || selectedProject?.gitInfo.branch || '';
}

export function buildWindowTitle(selectedProject: Project | null, activeTask: Task | null): string {
  const projectName = selectedProject?.name?.trim() || '';
  const branchName = getCurrentBranch(selectedProject, activeTask).trim();

  if (!projectName) {
    return 'Emdash';
  }

  if (!branchName) {
    return projectName;
  }

  return `${projectName} • ${branchName}`;
}
