export interface TaskEnvContext {
  taskId: string;
  taskName: string;
  taskPath: string;
  projectPath: string;
  defaultBranch?: string;
}

export function getTaskEnvVars(ctx: TaskEnvContext): Record<string, string> {
  const taskName = slugify(ctx.taskName) || 'task';
  return {
    EMDASH_TASK_ID: ctx.taskId,
    EMDASH_TASK_NAME: taskName,
    EMDASH_TASK_PATH: ctx.taskPath,
    EMDASH_ROOT_PATH: ctx.projectPath,
    EMDASH_DEFAULT_BRANCH: ctx.defaultBranch || 'main',
    EMDASH_PORT: String(getBasePort(ctx.taskId)),
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getBasePort(taskId: string): number {
  let hash = 0;
  for (let i = 0; i < taskId.length; i += 1) {
    hash = (hash << 5) - hash + taskId.charCodeAt(i);
    hash |= 0;
  }
  return 50000 + (Math.abs(hash) % 1000) * 10;
}
