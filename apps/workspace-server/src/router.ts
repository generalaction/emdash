import { implement } from '@orpc/server';
import { workspaceContract } from '@emdash/core/workspace-server';

const i = implement(workspaceContract);
const startedAt = Date.now();

export const router = i.router({
  health: i.health.handler(() => ({
    status: 'ok' as const,
    version: process.env['npm_package_version'] ?? '0.0.0',
    uptimeMs: Date.now() - startedAt,
  })),
});
