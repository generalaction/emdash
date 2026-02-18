export interface TaskEnvContext {
  taskId: string;
  taskName: string;
  taskPath: string;
  projectPath: string;
  defaultBranch?: string;
  portSeed?: string;
  dbTarget?: string | null;
}

interface DbTargetConfig {
  url?: string;
  name?: string;
  profile?: string;
}

function parseDbTarget(dbTarget: string | null | undefined): DbTargetConfig | null {
  if (!dbTarget) return null;
  
  try {
    const parsed = JSON.parse(dbTarget);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as DbTargetConfig;
    }
  } catch {
    return { url: dbTarget };
  }
  
  return null;
}

export function getTaskEnvVars(ctx: TaskEnvContext): Record<string, string> {
  const taskName = slugify(ctx.taskName) || 'task';
  const portSeed = ctx.portSeed || ctx.taskPath || ctx.taskId;
  const env: Record<string, string> = {
    EMDASH_TASK_ID: ctx.taskId,
    EMDASH_TASK_NAME: taskName,
    EMDASH_TASK_PATH: ctx.taskPath,
    EMDASH_ROOT_PATH: ctx.projectPath,
    EMDASH_DEFAULT_BRANCH: ctx.defaultBranch || 'main',
    EMDASH_PORT: String(getBasePort(portSeed)),
  };

  const dbConfig = parseDbTarget(ctx.dbTarget);
  if (dbConfig) {
    if (dbConfig.url) {
      env.DATABASE_URL = dbConfig.url;
      env.DB_URL = dbConfig.url;
    }
    if (dbConfig.name) {
      env.DB_NAME = dbConfig.name;
      env.DATABASE_NAME = dbConfig.name;
    }
    if (dbConfig.profile) {
      env.DB_PROFILE = dbConfig.profile;
      env.DATABASE_PROFILE = dbConfig.profile;
    }
  }

  return env;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getBasePort(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return 50000 + (Math.abs(hash) % 1000) * 10;
}
