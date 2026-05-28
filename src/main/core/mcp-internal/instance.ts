import { randomBytes, randomUUID } from 'node:crypto';

export interface McpInternalInstance {
  instanceId: string;
  token: string;
}

export function makeInstance(): McpInternalInstance {
  return {
    instanceId: randomUUID(),
    token: randomBytes(32).toString('base64url'),
  };
}
