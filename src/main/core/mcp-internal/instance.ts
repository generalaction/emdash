import crypto from 'node:crypto';

/**
 * Per-launch identity for the MCP loopback server. Regenerated each emdash
 * boot — outstanding tokens from a previous instance are invalidated.
 */
export interface McpInternalInstance {
  instanceId: string;
  token: string;
}

export function makeInstance(): McpInternalInstance {
  return {
    instanceId: crypto.randomUUID(),
    token: crypto.randomUUID(),
  };
}
