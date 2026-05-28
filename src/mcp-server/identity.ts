export type Identity = {
  instanceId: string;
  sessionId: string;
  taskId: string;
  projectId: string;
  statusUrl: string;
  token: string;
};

export class IdentityError extends Error {
  constructor(missing: string[]) {
    super(`emdash-mcp: missing required env vars: ${missing.join(', ')}`);
    this.name = 'IdentityError';
  }
}

export function loadIdentity(env: NodeJS.ProcessEnv = process.env): Identity {
  const required = {
    instanceId: env.EMDASH_INSTANCE_ID,
    sessionId: env.EMDASH_SESSION_ID,
    taskId: env.EMDASH_TASK_ID,
    projectId: env.EMDASH_PROJECT_ID,
    statusUrl: env.EMDASH_STATUS_URL,
    token: env.EMDASH_TOKEN,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => `EMDASH_${key.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()}`);
  if (missing.length > 0) throw new IdentityError(missing);
  return required as Identity;
}
