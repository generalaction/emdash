/**
 * emdash-mcp identity — read EMDASH_* env vars set by emdash at PTY spawn.
 * If any required var is missing, the subprocess refuses to register tools and
 * exits cleanly so the host CLI doesn't hang.
 */

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
    .filter(([, v]) => !v)
    .map(([k]) => `EMDASH_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);
  if (missing.length > 0) {
    throw new IdentityError(missing);
  }
  return required as Identity;
}
