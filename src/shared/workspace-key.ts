export function workspaceKey(taskBranch: string | undefined): string {
  return taskBranch ? `branch:${taskBranch}` : 'root:';
}
